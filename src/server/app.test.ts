import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';
import { createApp } from './app';
import {
  acquireWebhookDeliveryLease,
  createLocalFileBlobStoreAdapter,
  getPendingEventsAndDeliveriesForUser,
  setWebhookStoreAdapterForTesting,
  upsertInstallationMapping,
  type BlobStoreAdapter,
} from './webhookStore';

let server: http.Server;
let baseUrl: string;
let tmpDir: string;
let baseAdapter: BlobStoreAdapter;
let failPendingWriteOnce = false;
const originalWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const TEST_WEBHOOK_SECRET = 'stage2-test-webhook-secret';

function signPayload(rawBody: string, secret = TEST_WEBHOOK_SECRET): string {
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

before(async () => {
  process.env.GITHUB_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'buildlog-app-test-'));
  baseAdapter = createLocalFileBlobStoreAdapter(path.join(tmpDir, 'server-state.json'));

  const wrapperAdapter: BlobStoreAdapter = {
    getWithMetadata: (key) => baseAdapter.getWithMetadata(key),
    async setJSON(key, data, options) {
      if (failPendingWriteOnce && key.startsWith('pending/')) {
        failPendingWriteOnce = false;
        throw new Error('Simulated transient storage failure during enqueue');
      }
      return baseAdapter.setJSON(key, data, options);
    },
    delete: (key) => baseAdapter.delete(key),
    listAll: (prefix) => baseAdapter.listAll(prefix),
  };

  setWebhookStoreAdapterForTesting(wrapperAdapter);

  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind test HTTP server');
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

beforeEach(async () => {
  failPendingWriteOnce = false;
  await fs.rm(path.join(tmpDir, 'server-state.json'), { force: true });
});

after(async () => {
  setWebhookStoreAdapterForTesting(null);
  if (originalWebhookSecret === undefined) {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  } else {
    process.env.GITHUB_WEBHOOK_SECRET = originalWebhookSecret;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('GET /api/health returns 200 and protected routes reject missing auth with 401', async () => {
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthJson = (await healthRes.json()) as { ok: boolean };
  assert.equal(healthJson.ok, true);

  const pendingRes = await fetch(`${baseUrl}/api/ingestion/pending`);
  assert.equal(pendingRes.status, 401);

  const unknownApiRes = await fetch(`${baseUrl}/api/nonexistent-endpoint`);
  assert.equal(unknownApiRes.status, 404);
});

test('POST /api/webhooks/github verifies raw HMAC before claiming delivery lease and deduplicates after completion', async () => {
  await upsertInstallationMapping({
    installationId: '1',
    ownerId: 'uid-alice',
    integrationId: 'int-1',
    accountName: 'alice',
    repositories: [
      {
        repositoryId: 'repo-doc-1',
        githubRepositoryId: '4242',
        fullName: 'alice/buildlog-demo',
        status: 'active',
      },
    ],
  });

  // Deliberately non-compact formatting to verify HMAC uses exact raw bytes
  const rawBody = `{
  "installation": { "id": 1 },
  "repository": { "id": 4242, "full_name": "alice/buildlog-demo" },
  "ref": "refs/heads/main",
  "commits": [
    {
      "id": "abc1234567890",
      "message": "feat: preserve raw body verification",
      "url": "https://github.com/alice/buildlog-demo/commit/abc1234567890",
      "timestamp": "2026-11-19T12:00:00Z",
      "author": { "username": "alice" },
      "added": ["src/server/app.ts"],
      "modified": [],
      "removed": []
    }
  ]
}`;

  const deliveryId = 'delivery-raw-hmac-1';

  // 1. Invalid signature must fail 401 and MUST NOT claim the deliveryId lease
  const badSigRes = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
    },
    body: rawBody,
  });
  assert.equal(badSigRes.status, 401);

  // 2. Valid signature with the SAME deliveryId must succeed (not marked duplicate by the bad attempt)
  const validRes = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signPayload(rawBody),
    },
    body: rawBody,
  });
  assert.equal(validRes.status, 202);
  const validJson = (await validRes.json()) as { ok: boolean; status: string; eventCount: number };
  assert.equal(validJson.ok, true);
  assert.equal(validJson.status, 'queued');
  assert.equal(validJson.eventCount, 1);

  // 3. Replay after completion returns 200 duplicate_ignored without duplicating queued event
  const replayRes = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signPayload(rawBody),
    },
    body: rawBody,
  });
  assert.equal(replayRes.status, 200);
  const replayJson = (await replayRes.json()) as { status: string };
  assert.equal(replayJson.status, 'duplicate_ignored');

  const userState = await getPendingEventsAndDeliveriesForUser('uid-alice');
  assert.equal(userState.pendingEvents.length, 1);
  assert.equal(userState.pendingEvents[0]?.payload.commitSha, 'abc1234567890');
});

test('POST /api/webhooks/github releases lease if event queuing fails so retry recovers cleanly', async () => {
  await upsertInstallationMapping({
    installationId: '2',
    ownerId: 'uid-bob',
    integrationId: 'int-2',
    accountName: 'bob',
    repositories: [
      {
        repositoryId: 'repo-doc-2',
        githubRepositoryId: '5252',
        fullName: 'bob/retry-demo',
        status: 'active',
      },
    ],
  });

  const rawBody = JSON.stringify({
    installation: { id: 2 },
    repository: { id: 5252, full_name: 'bob/retry-demo' },
    ref: 'refs/heads/main',
    commits: [
      {
        id: 'def9876543210',
        message: 'fix: recover failed enqueue',
        url: 'https://github.com/bob/retry-demo/commit/def9876543210',
        timestamp: '2026-11-19T12:05:00Z',
        author: { username: 'bob' },
        added: [],
        modified: ['server.ts'],
        removed: [],
      },
    ],
  });

  const deliveryId = 'delivery-retry-recovery-1';
  failPendingWriteOnce = true;

  // First attempt fails during pending event write
  const failRes = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signPayload(rawBody),
    },
    body: rawBody,
  });
  assert.equal(failRes.status, 500);

  // Delivery must NOT have been marked completed; retry recovers immediately
  const retryRes = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signPayload(rawBody),
    },
    body: rawBody,
  });
  assert.equal(retryRes.status, 202);
  const retryJson = (await retryRes.json()) as { status: string; eventCount: number };
  assert.equal(retryJson.status, 'queued');
  assert.equal(retryJson.eventCount, 1);

  const bobState = await getPendingEventsAndDeliveriesForUser('uid-bob');
  assert.equal(bobState.pendingEvents.length, 1);
});

test('POST /api/webhooks/github returns 409 when delivery lease is actively held by another worker', async () => {
  const deliveryId = 'delivery-in-progress-1';
  const acq = await acquireWebhookDeliveryLease(deliveryId, { leaseDurationMs: 45_000 });
  assert.equal(acq.status, 'acquired');

  const rawBody = JSON.stringify({ zen: 'Responsive is better than fast.' });
  const res = await fetch(`${baseUrl}/api/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signPayload(rawBody),
    },
    body: rawBody,
  });
  assert.equal(res.status, 409);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, 'in_progress');
});
