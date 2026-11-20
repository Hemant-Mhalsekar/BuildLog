import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import {
  createLocalFileBlobStoreAdapter,
  createWebhookStore,
  getActiveBlobStore,
  PREVIEW_BLOB_STORE_NAME,
  PRODUCTION_BLOB_STORE_NAME,
  resolveStorageEnvironment,
  sanitizeGitHubSession,
  setWebhookStoreAdapterForTesting,
} from './webhookStore';

let blobsServer: BlobsServer;
let blobsDir: string;
let serverUrl: string;
const TEST_TOKEN = 'test-blobs-token';
const TEST_SITE_ID = 'site-buildlog-test';

before(async () => {
  blobsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buildlog-blobs-'));
  blobsServer = new BlobsServer({
    directory: blobsDir,
    token: TEST_TOKEN,
    debug: false,
  });

  // @netlify/blobs@11.1.9's local BlobsServer has two emulator gaps vs Netlify's hosted Blobs API:
  // 1) BlobsServer.get() omits the `etag` response header (causing getWithMetadata().etag to be undefined)
  // 2) BlobsServer.put() checks fs.access without a lock and hashes 1ms-resolution mtime for ETag
  // Wrap the local BlobsServer handler in-test to serialize requests and attach ETag on GET 200s
  // while executing all storage, HTTP, and SDK operations through the real @netlify/blobs SDK & BlobsServer.
  const internalServer = blobsServer as unknown as {
    handleRequest: (req: Request) => Promise<Response>;
    getLocalPaths: (u: URL) => { dataPath?: string; key?: string };
  };
  const generateETag = (
    BlobsServer as unknown as { generateETag: (filePath: string) => Promise<string> }
  ).generateETag;
  const rawHandleRequest = internalServer.handleRequest.bind(blobsServer);
  let requestQueue: Promise<unknown> = Promise.resolve();

  internalServer.handleRequest = (req: Request) => {
    const run = async (): Promise<Response> => {
      const res = await rawHandleRequest(req);
      const method = req.method?.toUpperCase();
      if (method === 'GET' && res.status === 200 && !res.headers.has('etag') && req.url) {
        const parsed = new URL(req.url);
        const { dataPath, key } = internalServer.getLocalPaths(parsed);
        if (dataPath && key) {
          const etag = await generateETag(dataPath);
          if (etag) {
            const headers = new Headers(res.headers);
            headers.set('etag', etag);
            return new Response(res.body, { status: res.status, headers });
          }
        }
      }
      if (method === 'PUT' && res.status === 200) {
        // Ensure distinct mtime-based ETag across sub-millisecond writes in BlobsServer
        await new Promise((r) => setTimeout(r, 2));
      }
      return res;
    };

    const next = requestQueue.then(run, run);
    requestQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const addr = await blobsServer.start();
  serverUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  setWebhookStoreAdapterForTesting(null);
  await blobsServer?.stop();
  if (blobsDir) {
    await fs.rm(blobsDir, { recursive: true, force: true });
  }
});

function setNetlifyBlobsContextEnv(deployID = 'deploy001'): void {
  setEnvironmentContext({
    edgeURL: serverUrl,
    uncachedEdgeURL: serverUrl,
    primaryRegion: 'us-east-1',
    siteID: TEST_SITE_ID,
    token: TEST_TOKEN,
    deployID,
  });
}

function makeRealBlobBackedStore(
  context: 'production' | 'deploy-preview',
  deployID = 'deploy001'
) {
  setNetlifyBlobsContextEnv(deployID);
  const env: Record<string, string> = {
    NETLIFY: 'true',
    CONTEXT: context,
    NETLIFY_BLOBS_CONTEXT: '1',
  };
  return createWebhookStore(() => getActiveBlobStore(env));
}

beforeEach(() => {
  setWebhookStoreAdapterForTesting(null);
});

test('resolveStorageEnvironment isolates production vs deploy-preview and preserves local-file fallback', () => {
  assert.deepEqual(resolveStorageEnvironment({}), {
    mode: 'local-file',
    storeName: 'local-file',
    isDeployScoped: false,
  });

  assert.deepEqual(
    resolveStorageEnvironment({ NETLIFY: 'true', CONTEXT: 'production' }),
    {
      mode: 'netlify-production',
      storeName: PRODUCTION_BLOB_STORE_NAME,
      isDeployScoped: false,
    }
  );

  for (const ctx of ['deploy-preview', 'branch-deploy', 'dev', undefined]) {
    assert.deepEqual(
      resolveStorageEnvironment({ NETLIFY: 'true', CONTEXT: ctx }),
      {
        mode: 'netlify-deploy-preview',
        storeName: PREVIEW_BLOB_STORE_NAME,
        isDeployScoped: true,
      }
    );
  }
});

test('Real @netlify/blobs SDK: OAuth state consumption is strictly one-time and rejects concurrent or cross-user attempts', async () => {
  const store = makeRealBlobBackedStore('production', 'auth001');
  const stateToken = await store.createPendingAuthState('uid-alice', 'alice/repo-one');

  // Cross-user attempt must return null AND must not invalidate Alice's active state
  const bobAttempt = await store.consumePendingAuthState('uid-bob', stateToken);
  assert.equal(bobAttempt, null);

  // Two simultaneous callbacks racing to consume Alice's state
  const [r1, r2] = await Promise.all([
    store.consumePendingAuthState('uid-alice', stateToken),
    store.consumePendingAuthState('uid-alice', stateToken),
  ]);

  const winners = [r1, r2].filter(Boolean);
  assert.equal(winners.length, 1);
  assert.equal(winners[0]?.targetFullName, 'alice/repo-one');

  // Replay after consumption must fail
  const replay = await store.consumePendingAuthState('uid-alice', stateToken);
  assert.equal(replay, null);
});

test('Real @netlify/blobs SDK: webhook lease acquisition, renewal, expired recovery, and stale-owner protection', async () => {
  const store = makeRealBlobBackedStore('production', 'lease001');
  const deliveryId = `deliv-${Date.now()}`;
  const t0 = 1_700_000_000_000;

  // 1. Worker 1 acquires initial lease
  const acq1 = await store.acquireWebhookDeliveryLease(deliveryId, {
    leaseDurationMs: 45_000,
    nowMs: t0,
  });
  assert.equal(acq1.status, 'acquired');
  if (acq1.status !== 'acquired') throw new Error('expected acquired');
  assert.equal(acq1.recovered, false);
  assert.equal(acq1.attemptCount, 1);

  // 2. Concurrent duplicate while lease is active gets in_progress (never acquires)
  const dupWhileActive = await store.acquireWebhookDeliveryLease(deliveryId, {
    leaseDurationMs: 45_000,
    nowMs: t0 + 10_000,
  });
  assert.equal(dupWhileActive.status, 'in_progress');

  // 3. Worker 1 can renew while lease is valid; wrong leaseToken cannot renew
  const badRenew = await store.renewWebhookDeliveryLease(deliveryId, 'wrong-token', {
    leaseDurationMs: 45_000,
    nowMs: t0 + 20_000,
  });
  assert.equal(badRenew.renewed, false);

  const goodRenew = await store.renewWebhookDeliveryLease(deliveryId, acq1.leaseToken, {
    leaseDurationMs: 45_000,
    nowMs: t0 + 40_000,
  });
  assert.equal(goodRenew.renewed, true);

  // Simulate Worker 1 partially queueing 1 event before hanging past renewed expiry (t0 + 85_000)
  await store.enqueuePendingWebhookEvents([
    {
      queueId: `${deliveryId}:push:sha-1`,
      ownerId: 'uid-alice',
      repositoryId: 'repo-1',
      githubRepositoryId: '101',
      repositoryFullName: 'alice/app',
      deliveryId,
      receivedAt: new Date(t0).toISOString(),
      payload: {
        eventId: 'push:sha-1',
        eventType: 'push',
        branch: 'main',
        commitSha: 'sha-1',
        title: 'Initial commit',
        description: '',
        sourceUrl: 'https://github.com/alice/app/commit/sha-1',
        changedFiles: ['src/index.ts'],
        occurredAt: new Date(t0).toISOString(),
        author: 'alice',
      },
    },
  ]);

  // 4. After lease expires, Worker 1 cannot renew or complete its stale lease
  const lateTime = t0 + 90_000;
  const expiredRenew = await store.renewWebhookDeliveryLease(deliveryId, acq1.leaseToken, {
    nowMs: lateTime,
  });
  assert.equal(expiredRenew.renewed, false);

  const expiredComplete = await store.completeWebhookDeliveryLease(
    deliveryId,
    acq1.leaseToken,
    'stale-outcome',
    { nowMs: lateTime }
  );
  assert.equal(expiredComplete.completed, false);
  assert.equal(expiredComplete.reason, 'lease_expired');

  // 5. Worker 2 recovers expired lease cleanly
  const acq2 = await store.acquireWebhookDeliveryLease(deliveryId, {
    leaseDurationMs: 45_000,
    nowMs: lateTime,
  });
  assert.equal(acq2.status, 'acquired');
  if (acq2.status !== 'acquired') throw new Error('expected recovered lease');
  assert.equal(acq2.recovered, true);
  assert.equal(acq2.attemptCount, 2);
  assert.notEqual(acq2.leaseToken, acq1.leaseToken);

  // 6. Expired Worker 1 STILL cannot complete or release Worker 2's lease
  const staleCompleteAfterTakeover = await store.completeWebhookDeliveryLease(
    deliveryId,
    acq1.leaseToken,
    'stale-overwrite',
    { nowMs: lateTime + 1_000 }
  );
  assert.equal(staleCompleteAfterTakeover.completed, false);
  assert.equal(staleCompleteAfterTakeover.reason, 'lease_lost');

  const staleRelease = await store.releaseWebhookDeliveryLease(deliveryId, acq1.leaseToken);
  assert.equal(staleRelease, false);

  // 7. Worker 2 replays batch (sha-1 already queued + sha-2 new) without duplicating sha-1
  const newlyQueued = await store.enqueuePendingWebhookEvents([
    {
      queueId: `${deliveryId}:push:sha-1`,
      ownerId: 'uid-alice',
      repositoryId: 'repo-1',
      githubRepositoryId: '101',
      repositoryFullName: 'alice/app',
      deliveryId,
      receivedAt: new Date(t0).toISOString(),
      payload: {
        eventId: 'push:sha-1',
        eventType: 'push',
        branch: 'main',
        commitSha: 'sha-1',
        title: 'Initial commit',
        description: '',
        sourceUrl: 'https://github.com/alice/app/commit/sha-1',
        changedFiles: ['src/index.ts'],
        occurredAt: new Date(t0).toISOString(),
        author: 'alice',
      },
    },
    {
      queueId: `${deliveryId}:push:sha-2`,
      ownerId: 'uid-alice',
      repositoryId: 'repo-1',
      githubRepositoryId: '101',
      repositoryFullName: 'alice/app',
      deliveryId,
      receivedAt: new Date(t0 + 1_000).toISOString(),
      payload: {
        eventId: 'push:sha-2',
        eventType: 'push',
        branch: 'main',
        commitSha: 'sha-2',
        title: 'Second commit',
        description: '',
        sourceUrl: 'https://github.com/alice/app/commit/sha-2',
        changedFiles: ['src/app.ts'],
        occurredAt: new Date(t0 + 1_000).toISOString(),
        author: 'alice',
      },
    },
  ]);
  assert.equal(newlyQueued, 1);

  const worker2Complete = await store.completeWebhookDeliveryLease(
    deliveryId,
    acq2.leaseToken,
    'queued_2',
    { nowMs: lateTime + 2_000 }
  );
  assert.equal(worker2Complete.completed, true);

  // 8. Future retries see already_completed
  const afterDone = await store.acquireWebhookDeliveryLease(deliveryId, {
    nowMs: lateTime + 5_000,
  });
  assert.equal(afterDone.status, 'already_completed');

  const userQueue = await store.getPendingEventsAndDeliveriesForUser('uid-alice');
  assert.equal(userQueue.pendingEvents.length, 2);
});

test('Real @netlify/blobs SDK: concurrent event enqueue and acknowledgement never lose events', async () => {
  const store = makeRealBlobBackedStore('production', 'queue001');
  const ownerId = 'uid-queue-test';
  const makeEvent = (id: string) => ({
    queueId: `d-queue:${id}`,
    ownerId,
    repositoryId: 'repo-q',
    githubRepositoryId: '999',
    repositoryFullName: 'alice/queue-repo',
    deliveryId: 'd-queue',
    receivedAt: '2026-11-19T12:00:00.000Z',
    payload: {
      eventId: id,
      eventType: 'push' as const,
      branch: 'main',
      commitSha: id,
      title: `Commit ${id}`,
      description: '',
      sourceUrl: '',
      changedFiles: [],
      occurredAt: '2026-11-19T12:00:00.000Z',
      author: 'alice',
    },
  });

  await store.enqueuePendingWebhookEvents([makeEvent('ev-1'), makeEvent('ev-2')]);

  // Acknowledge ev-1 & ev-2 concurrently while ev-3 arrives
  const [ackedCount, addedCount] = await Promise.all([
    store.acknowledgePendingEvents(ownerId, ['d-queue:ev-1', 'd-queue:ev-2']),
    store.enqueuePendingWebhookEvents([makeEvent('ev-3')]),
  ]);

  assert.equal(ackedCount, 2);
  assert.equal(addedCount, 1);

  const remaining = await store.getPendingEventsAndDeliveriesForUser(ownerId);
  assert.deepEqual(
    remaining.pendingEvents.map((e) => e.queueId),
    ['d-queue:ev-3']
  );
});

test('Real @netlify/blobs SDK: concurrent installation authorization keeps all verified installations & keeps tokens server-side', async () => {
  const store = makeRealBlobBackedStore('production', 'instauth001');
  const uid = 'uid-concurrent-inst';

  await store.saveUserGitHubSession({
    uid,
    githubUserId: '7001',
    githubLogin: 'alice-gh',
    accessToken: 'ghu_super_secret_token_do_not_expose',
    verifiedInstallationIds: ['inst-100'],
  });

  // Two concurrent authorizations in separate tabs
  await Promise.all([
    store.grantUserVerifiedInstallations(uid, ['inst-200']),
    store.grantUserVerifiedInstallations(uid, ['inst-300']),
  ]);

  const session = await store.getUserGitHubSession(uid);
  assert.ok(session);
  assert.deepEqual(session.verifiedInstallationIds.sort(), ['inst-100', 'inst-200', 'inst-300']);
  assert.equal(await store.userOwnsInstallationOnServer(uid, 'inst-200'), true);
  assert.equal(await store.userOwnsInstallationOnServer(uid, 'inst-300'), true);

  const publicSummary = sanitizeGitHubSession(session);
  assert.equal('accessToken' in publicSummary, false);
});

test('Real @netlify/blobs SDK: repository routing isolates installations and fails closed on ambiguous un-scoped lookup', async () => {
  const store = makeRealBlobBackedStore('production', 'routing001');

  await store.upsertInstallationMapping({
    installationId: 'inst-u1',
    ownerId: 'uid-1',
    integrationId: 'int-1',
    accountName: 'user1',
    repositories: [
      {
        repositoryId: 'doc-repo-1',
        githubRepositoryId: 'gh-shared-555',
        fullName: 'org/shared-repo',
        status: 'active',
      },
    ],
  });

  // Another user cannot hijack inst-u1
  await assert.rejects(
    () =>
      store.upsertInstallationMapping({
        installationId: 'inst-u1',
        ownerId: 'uid-2',
        integrationId: 'int-2',
        accountName: 'user2',
        repositories: [],
      }),
    /already registered to another BuildLog account/
  );

  // User 2 registers their own separate installation pointing to same githubRepositoryId
  await store.upsertInstallationMapping({
    installationId: 'inst-u2',
    ownerId: 'uid-2',
    integrationId: 'int-2',
    accountName: 'user2',
    repositories: [
      {
        repositoryId: 'doc-repo-2',
        githubRepositoryId: 'gh-shared-555',
        fullName: 'org/shared-repo',
        status: 'active',
      },
    ],
  });

  // Scoped webhook routing resolves deterministically to each installation's owner
  const route1 = await store.resolveWebhookTarget('inst-u1', 'gh-shared-555', 'org/shared-repo');
  const route2 = await store.resolveWebhookTarget('inst-u2', 'gh-shared-555', 'org/shared-repo');
  assert.deepEqual(route1, { ownerId: 'uid-1', repositoryId: 'doc-repo-1', status: 'active' });
  assert.deepEqual(route2, { ownerId: 'uid-2', repositoryId: 'doc-repo-2', status: 'active' });

  // Ambiguous webhook without installationId must fail closed (null) instead of routing to wrong user
  const ambiguous = await store.resolveWebhookTarget('', 'gh-shared-555', 'org/shared-repo');
  assert.equal(ambiguous, null);
});

test('Real @netlify/blobs SDK: deploy-preview storage is completely isolated from production and cannot purge production data', async () => {
  const prodStore = makeRealBlobBackedStore('production', 'proddeploy01');
  const uid = 'uid-prod-owner';

  await prodStore.saveUserGitHubSession({
    uid,
    githubUserId: '9001',
    githubLogin: 'prod-user',
    accessToken: 'ghu_prod_secret_token',
    verifiedInstallationIds: ['inst-prod-1'],
  });
  await prodStore.upsertInstallationMapping({
    installationId: 'inst-prod-1',
    ownerId: uid,
    integrationId: 'int-prod-1',
    accountName: 'prod-user',
    repositories: [
      {
        repositoryId: 'repo-prod-1',
        githubRepositoryId: 'gh-prod-1',
        fullName: 'prod/repo',
        status: 'active',
      },
    ],
  });
  await prodStore.enqueuePendingWebhookEvents([
    {
      queueId: 'prod-d1:push:1',
      ownerId: uid,
      repositoryId: 'repo-prod-1',
      githubRepositoryId: 'gh-prod-1',
      repositoryFullName: 'prod/repo',
      deliveryId: 'prod-d1',
      receivedAt: '2026-11-19T12:10:00.000Z',
      payload: {
        eventId: 'push:1',
        eventType: 'push',
        branch: 'main',
        commitSha: '111111',
        title: 'Prod commit',
        description: '',
        sourceUrl: '',
        changedFiles: [],
        occurredAt: '2026-11-19T12:10:00.000Z',
        author: 'prod-user',
      },
    },
  ]);

  // Switch to Deploy Preview context
  const previewStore = makeRealBlobBackedStore('deploy-preview', 'previewdeploy99');

  // Preview must NOT see production session, installations, or pending events
  assert.equal(await previewStore.getUserGitHubSession(uid), null);
  assert.equal(await previewStore.userOwnsInstallationOnServer(uid, 'inst-prod-1'), false);
  const previewQueue = await previewStore.getPendingEventsAndDeliveriesForUser(uid);
  assert.equal(previewQueue.pendingEvents.length, 0);

  // Destructive account purge in preview must NOT affect production
  await previewStore.purgeOwnerServerState(uid);

  const prodSessionAfter = await prodStore.getUserGitHubSession(uid);
  assert.ok(prodSessionAfter);
  assert.equal(prodSessionAfter.githubLogin, 'prod-user');
  const prodQueueAfter = await prodStore.getPendingEventsAndDeliveriesForUser(uid);
  assert.equal(prodQueueAfter.pendingEvents.length, 1);
});

test('Local .data/server-state.json adapter supports concurrent operations and idempotent purge', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buildlog-local-'));
  try {
    const localFile = path.join(tmpDir, 'server-state.json');
    const adapter = createLocalFileBlobStoreAdapter(localFile);
    const store = createWebhookStore(() => adapter);

    const token = await store.createPendingAuthState('uid-local', 'local/repo');
    const [a, b] = await Promise.all([
      store.consumePendingAuthState('uid-local', token),
      store.consumePendingAuthState('uid-local', token),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1);

    await store.saveUserGitHubSession({
      uid: 'uid-local',
      githubUserId: '501',
      githubLogin: 'localdev',
      accessToken: 'ghu_local_secret',
      verifiedInstallationIds: ['inst-local-1'],
    });
    await store.upsertInstallationMapping({
      installationId: 'inst-local-1',
      ownerId: 'uid-local',
      integrationId: 'int-local-1',
      accountName: 'localdev',
      repositories: [
        {
          repositoryId: 'repo-local-1',
          githubRepositoryId: '777',
          fullName: 'local/repo',
          status: 'active',
        },
      ],
    });

    // Idempotent purge can run twice safely
    await store.purgeOwnerServerState('uid-local');
    await store.purgeOwnerServerState('uid-local');
    assert.equal(await store.getUserGitHubSession('uid-local'), null);
    assert.equal(await store.userOwnsInstallationOnServer('uid-local', 'inst-local-1'), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
