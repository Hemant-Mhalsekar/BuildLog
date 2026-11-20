import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { clusterActivityEvents } from './activityClustering';
import { computeDashboardMetrics } from './dashboardStats';
import { buildPersonalJsonExport } from './exportData';
import {
  normalizeGitHubWebhookPayload,
  verifyGitHubWebhookSignature,
} from './githubNormalization';
import {
  buildAutomatedResumeMarkdown,
  extractCodeAreas,
  synthesizeProjectMemoryFromHistory,
} from './projectMemoryBuilder';
import { validateInstallationId, validateObjective } from './validation';
import { parseApiResponseBody } from './apiResponse';
import { parseGitHubRepositoryUrl } from './githubUrl';
import { computeWebhookHealthStatus } from './webhookHealth';
import type {
  ActivityEvent,
  ActivitySummary,
  GitHubAppConfigStatus,
  Integration,
  ProjectMemory,
  Repository,
  UserProfile,
  WebhookDeliveryRecord,
} from '../types/models';

test('verifyGitHubWebhookSignature validates HMAC-SHA256 safely', () => {
  const secret = 'whsec_test_secret_123';
  const body = JSON.stringify({ ref: 'refs/heads/main', after: 'abc123' });
  const digest = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const validHeader = `sha256=${digest}`;

  assert.equal(verifyGitHubWebhookSignature(body, validHeader, secret), true);
  assert.equal(verifyGitHubWebhookSignature(body + ' ', validHeader, secret), false);
  assert.equal(verifyGitHubWebhookSignature(body, 'sha256=deadbeef', secret), false);
  assert.equal(verifyGitHubWebhookSignature(body, undefined, secret), false);
  assert.equal(verifyGitHubWebhookSignature(body, validHeader, ''), false);
});

test('normalizeGitHubWebhookPayload normalizes push, pull_request, issues, and unsupported events', () => {
  const pushEnvelope = normalizeGitHubWebhookPayload('push', 'deliv-1', {
    installation: { id: 9876 },
    repository: {
      id: 42,
      full_name: 'acme/buildlog',
      default_branch: 'main',
      html_url: 'https://github.com/acme/buildlog',
    },
    ref: 'refs/heads/feature/webhook-auth',
    pusher: { name: 'alex' },
    commits: [
      {
        id: '1111111111111111',
        message: 'Verify HMAC signature\n\nAdds timingSafeEqual check.',
        url: 'https://github.com/acme/buildlog/commit/1111111111111111',
        timestamp: '2026-11-19T10:00:00Z',
        added: ['src/server/webhook.ts'],
        modified: ['server.ts', 'src/server/webhook.ts'],
        removed: [],
        author: { username: 'alexdev' },
      },
    ],
  });

  assert.equal(pushEnvelope.supported, true);
  assert.equal(pushEnvelope.installationId, '9876');
  assert.equal(pushEnvelope.events.length, 1);
  assert.equal(pushEnvelope.events[0].branch, 'feature/webhook-auth');
  assert.equal(pushEnvelope.events[0].title, 'Verify HMAC signature');
  assert.deepEqual(pushEnvelope.events[0].changedFiles, ['src/server/webhook.ts', 'server.ts']);
  assert.equal(pushEnvelope.events[0].author, 'alexdev');

  const prEnvelope = normalizeGitHubWebhookPayload('pull_request', 'deliv-2', {
    action: 'closed',
    installation: { id: 9876 },
    repository: { id: 42, full_name: 'acme/buildlog', default_branch: 'main' },
    pull_request: {
      number: 18,
      title: 'Add webhook deduplication',
      body: 'Tracks delivery IDs.',
      state: 'closed',
      merged: true,
      html_url: 'https://github.com/acme/buildlog/pull/18',
      updated_at: '2026-11-19T11:00:00Z',
      head: { ref: 'feature/dedupe', sha: '2222222' },
      user: { login: 'alexdev' },
    },
  });

  assert.equal(prEnvelope.supported, true);
  assert.equal(prEnvelope.events[0].prNumber, 18);
  assert.equal(prEnvelope.events[0].prState, 'merged');

  const issueEnvelope = normalizeGitHubWebhookPayload('issues', 'deliv-3', {
    action: 'opened',
    installation: { id: 9876 },
    repository: { id: 42, full_name: 'acme/buildlog', default_branch: 'main' },
    issue: {
      number: 9,
      title: 'Blocker: Staging webhook secret missing',
      body: 'Needs env var configured.',
      state: 'open',
      html_url: 'https://github.com/acme/buildlog/issues/9',
      updated_at: '2026-11-19T12:00:00Z',
      user: { login: 'alexdev' },
    },
  });

  assert.equal(issueEnvelope.supported, true);
  assert.equal(issueEnvelope.events[0].issueNumber, 9);
  assert.equal(issueEnvelope.events[0].issueState, 'open');

  const unsupported = normalizeGitHubWebhookPayload('star', 'deliv-4', {
    repository: { id: 42, full_name: 'acme/buildlog' },
  });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.events.length, 0);
});

test('clusterActivityEvents groups nearby repository activity and marks clusters inferred', () => {
  const repos: Repository[] = [
    {
      id: 'repo-1',
      ownerId: 'user-1',
      integrationId: 'int-1',
      githubRepositoryId: '42',
      fullName: 'acme/buildlog',
      description: '',
      defaultBranch: 'main',
      primaryLanguage: 'TypeScript',
      lastSyncedAt: null,
      status: 'active',
    },
  ];

  const base = new Date('2026-11-19T10:00:00Z').getTime();
  const events: ActivityEvent[] = [
    {
      id: 'e1',
      ownerId: 'user-1',
      repositoryId: 'repo-1',
      eventId: 'push:1',
      eventType: 'push',
      branch: 'main',
      commitSha: 'aaa111',
      title: 'First commit',
      description: '',
      sourceUrl: 'https://github.com/acme/buildlog/commit/aaa111',
      changedFiles: ['src/a.ts'],
      occurredAt: new Date(base),
      processingStatus: 'summarized',
    },
    {
      id: 'e2',
      ownerId: 'user-1',
      repositoryId: 'repo-1',
      eventId: 'push:2',
      eventType: 'push',
      branch: 'main',
      commitSha: 'bbb222',
      title: 'Second commit 25m later',
      description: '',
      sourceUrl: 'https://github.com/acme/buildlog/commit/bbb222',
      changedFiles: ['src/b.ts'],
      occurredAt: new Date(base + 25 * 60 * 1000),
      processingStatus: 'summarized',
    },
    {
      id: 'e3',
      ownerId: 'user-1',
      repositoryId: 'repo-1',
      eventId: 'push:3',
      eventType: 'push',
      branch: 'feat/ui',
      commitSha: 'ccc333',
      title: 'Later session 3h later',
      description: '',
      sourceUrl: 'https://github.com/acme/buildlog/commit/ccc333',
      changedFiles: ['src/pages/Home.tsx'],
      occurredAt: new Date(base + 180 * 60 * 1000),
      processingStatus: 'recorded_without_summary',
    },
  ];

  const clusters = clusterActivityEvents(events, repos);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].isInferred, true);
  assert.equal(clusters[0].eventCount, 1);
  assert.equal(clusters[1].eventCount, 2);
  assert.deepEqual(clusters[1].changedFiles, ['src/a.ts', 'src/b.ts']);
});

test('synthesizeProjectMemoryFromHistory and buildAutomatedResumeMarkdown stay evidence-grounded', () => {
  const repo: Repository = {
    id: 'repo-1',
    ownerId: 'user-1',
    integrationId: 'int-1',
    githubRepositoryId: '42',
    fullName: 'acme/buildlog',
    description: 'Automated dev memory',
    defaultBranch: 'main',
    primaryLanguage: 'TypeScript',
    lastSyncedAt: new Date('2026-11-19T12:00:00Z'),
    status: 'active',
    objective: 'Ship webhook ingestion cleanly.',
    htmlUrl: 'https://github.com/acme/buildlog',
  };

  const events: ActivityEvent[] = [
    {
      id: 'ev-1',
      ownerId: 'user-1',
      repositoryId: 'repo-1',
      eventId: 'push:111',
      eventType: 'push',
      branch: 'main',
      commitSha: '111aaaa',
      title: 'Add webhook router',
      description: '',
      sourceUrl: 'https://github.com/acme/buildlog/commit/111aaaa',
      changedFiles: ['src/server/webhook.ts', 'src/pages/IntegrationsPage.tsx'],
      occurredAt: new Date('2026-11-19T09:00:00Z'),
      processingStatus: 'summarized',
    },
    {
      id: 'ev-2',
      ownerId: 'user-1',
      repositoryId: 'repo-1',
      eventId: 'issue:5:open',
      eventType: 'issues',
      branch: 'main',
      commitSha: '',
      title: '[Issue #5 opened] Blocker: webhook signature mismatch behind proxy',
      description: 'Raw body parser was mounted after json middleware.',
      sourceUrl: 'https://github.com/acme/buildlog/issues/5',
      changedFiles: [],
      occurredAt: new Date('2026-11-19T10:00:00Z'),
      processingStatus: 'recorded_without_summary',
      issueNumber: 5,
      issueState: 'open',
    },
    {
      id: 'ev-3',
      ownerId: 'user-1',
      repositoryId: 'repo-1',
      eventId: 'pr:12:open',
      eventType: 'pull_request',
      branch: 'fix/raw-body',
      commitSha: '999ffff',
      title: '[PR #12 opened] Mount express.raw before express.json',
      description: '',
      sourceUrl: 'https://github.com/acme/buildlog/pull/12',
      changedFiles: [],
      occurredAt: new Date('2026-11-19T11:00:00Z'),
      processingStatus: 'recorded_without_summary',
      prNumber: 12,
      prState: 'open',
    },
  ];

  const summaries: ActivitySummary[] = [
    {
      id: 'sum-1',
      ownerId: 'user-1',
      repositoryId: 'repo-1',
      relatedEventIds: ['ev-1'],
      summary: 'Added initial webhook router files.',
      evidence: ['Commit 111aaaa touched src/server/webhook.ts'],
      inferences: ['Likely scaffolding GitHub webhook endpoint'],
      suggestedNextSteps: ['Run HMAC signature integration test'],
      areasInvolved: ['src/server'],
      status: 'ready',
      generatedAt: new Date('2026-11-19T09:05:00Z'),
    },
  ];

  assert.deepEqual(extractCodeAreas(['src/server/webhook.ts', 'src/server/auth.ts']), [
    'src/server (2 files)',
  ]);

  const synthesized = synthesizeProjectMemoryFromHistory(repo, events, summaries);
  assert.equal(synthesized.openIssues.length, 1);
  assert.equal(synthesized.openPullRequests.length, 1);
  assert.equal(synthesized.knownBlockers.length, 1);
  assert.match(synthesized.knownBlockers[0], /Issue #5/);

  const report = buildAutomatedResumeMarkdown(
    repo,
    synthesized,
    events,
    summaries,
    new Date('2026-11-19T12:00:00Z')
  );
  assert.equal(report.hasInsufficientHistory, false);
  assert.match(report.markdown, /# Resume Project Context: acme\/buildlog/);
  assert.match(report.markdown, /Ship webhook ingestion cleanly\./);
  assert.match(report.markdown, /Mount express\.raw before express\.json/);
  assert.match(report.markdown, /https:\/\/github\.com\/acme\/buildlog\/pull\/12/);

  const emptyReport = buildAutomatedResumeMarkdown(
    repo,
    synthesizeProjectMemoryFromHistory(repo, [], []),
    [],
    []
  );
  assert.equal(emptyReport.hasInsufficientHistory, true);
  assert.match(emptyReport.markdown, /Minimal Activity History/);
});

test('computeDashboardMetrics, validation, and buildPersonalJsonExport', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const repos: Repository[] = [
    {
      id: 'r1',
      ownerId: 'u1',
      integrationId: 'i1',
      githubRepositoryId: '100',
      fullName: 'acme/app',
      description: '',
      defaultBranch: 'main',
      primaryLanguage: 'TypeScript',
      lastSyncedAt: now,
      status: 'active',
    },
  ];
  const events: ActivityEvent[] = [
    {
      id: 'ev1',
      ownerId: 'u1',
      repositoryId: 'r1',
      eventId: 'push:1',
      eventType: 'push',
      branch: 'main',
      commitSha: '1234567',
      title: 'Init',
      description: '',
      sourceUrl: 'https://github.com/acme/app/commit/1234567',
      changedFiles: ['README.md'],
      occurredAt: now,
      processingStatus: 'summarized',
    },
  ];
  const summaries: ActivitySummary[] = [
    {
      id: 's1',
      ownerId: 'u1',
      repositoryId: 'r1',
      relatedEventIds: ['ev1'],
      summary: 'Initialized repo.',
      evidence: ['Commit 1234567'],
      inferences: [],
      suggestedNextSteps: [],
      areasInvolved: ['README.md'],
      generatedAt: now,
      status: 'ready',
    },
  ];
  const memory: ProjectMemory[] = [
    {
      id: 'r1',
      ownerId: 'u1',
      repositoryId: 'r1',
      projectOverview: 'Overview',
      recentChanges: [],
      openIssues: ['#1: Issue'],
      openPullRequests: ['#2: PR'],
      technicalDecisions: [],
      suggestedNextSteps: [],
      supportingEventIds: ['ev1'],
      lastUpdatedAt: now,
    },
  ];

  const metrics = computeDashboardMetrics(repos, events, summaries, memory, now);
  assert.equal(metrics.activeReposCount, 1);
  assert.equal(metrics.eventsThisWeekCount, 1);
  assert.equal(metrics.aiSummariesCount, 1);
  assert.equal(metrics.openIssuesCount, 1);
  assert.equal(metrics.openPullRequestsCount, 1);
  assert.equal(metrics.weeklyActivity.length, 7);

  assert.equal(validateInstallationId('12345678'), null);
  assert.notEqual(validateInstallationId('bad id!'), null);
  assert.equal(validateObjective('Keep webhooks fast'), null);
  assert.notEqual(validateObjective('x'.repeat(1001)), null);

  const userProfile: UserProfile = {
    uid: 'u1',
    displayName: 'Alex',
    email: 'alex@example.com',
    optInCodeDiff: false,
    retentionDays: 365,
    createdAt: now,
  };
  const integrations: Integration[] = [
    {
      id: 'i1',
      ownerId: 'u1',
      provider: 'github',
      installationId: '999',
      accountName: 'acme',
      status: 'connected',
      connectedAt: now,
    },
  ];

  const exported = buildPersonalJsonExport(
    userProfile,
    integrations,
    repos,
    events,
    summaries,
    memory,
    now
  );
  assert.equal(exported.version, '2.0.0');
  assert.equal(exported.counts.activityEvents, 1);
  assert.equal(exported.counts.projectMemory, 1);
});

test('computeWebhookHealthStatus derives accurate health states and timestamps', () => {
  const readyConfig: GitHubAppConfigStatus = {
    configured: true,
    oauthConfigured: true,
    webhookConfigured: true,
    geminiConfigured: true,
    appSlug: 'buildlog-app',
    installUrl: 'https://github.com/apps/buildlog-app/installations/new',
    webhookPath: '/api/webhooks/github',
    missingEnvVars: [],
  };

  const missingConfig: GitHubAppConfigStatus = {
    configured: false,
    oauthConfigured: false,
    webhookConfigured: false,
    geminiConfigured: false,
    appSlug: null,
    installUrl: null,
    webhookPath: '/api/webhooks/github',
    missingEnvVars: ['GITHUB_APP_ID', 'GITHUB_APP_CLIENT_ID', 'GITHUB_WEBHOOK_SECRET'],
  };

  const connectedIntegration: Integration = {
    id: 'int-1',
    ownerId: 'u1',
    provider: 'github',
    installationId: '777',
    accountName: 'acme-org',
    status: 'connected',
    connectedAt: new Date('2026-11-18T10:00:00Z'),
  };

  const repoOlder: Repository = {
    id: 'r1',
    ownerId: 'u1',
    integrationId: 'int-1',
    githubRepositoryId: '1',
    fullName: 'acme-org/api',
    description: '',
    defaultBranch: 'main',
    primaryLanguage: 'TypeScript',
    lastSyncedAt: new Date('2026-11-19T08:00:00Z'),
    status: 'active',
  };

  const repoNewer: Repository = {
    ...repoOlder,
    id: 'r2',
    githubRepositoryId: '2',
    fullName: 'acme-org/web',
    lastSyncedAt: new Date('2026-11-19T11:30:00Z'),
  };

  // 1. Setup required when env vars missing
  const setupMissing = computeWebhookHealthStatus({
    githubStatus: missingConfig,
    integrations: [connectedIntegration],
    repositories: [repoOlder],
    recentDeliveries: [],
  });
  assert.equal(setupMissing.level, 'setup_required');
  assert.equal(setupMissing.serverReady, false);

  // 2. Setup required when no connected installations
  const setupNoInstall = computeWebhookHealthStatus({
    githubStatus: readyConfig,
    integrations: [],
    repositories: [],
    recentDeliveries: [],
  });
  assert.equal(setupNoInstall.level, 'setup_required');
  assert.equal(setupNoInstall.serverReady, true);

  // 3. Awaiting events when ready + connected but no webhook received yet
  const awaiting = computeWebhookHealthStatus({
    githubStatus: readyConfig,
    integrations: [connectedIntegration],
    repositories: [repoOlder, repoNewer],
    recentDeliveries: [],
  });
  assert.equal(awaiting.level, 'awaiting_events');
  assert.equal(awaiting.latestSyncedAt?.toISOString(), '2026-11-19T11:30:00.000Z');
  assert.equal(awaiting.latestWebhookAt, null);

  // 4. Healthy when recent webhook delivery exists without errors
  const deliveriesHealthy: WebhookDeliveryRecord[] = [
    {
      deliveryId: 'd-1',
      eventType: 'push',
      repositoryFullName: 'acme-org/web',
      installationId: '777',
      receivedAt: '2026-11-19T12:15:00.000Z',
      processingStatus: 'pending',
      eventCount: 1,
    },
  ];
  const healthy = computeWebhookHealthStatus({
    githubStatus: readyConfig,
    integrations: [connectedIntegration],
    repositories: [repoOlder, repoNewer],
    recentDeliveries: deliveriesHealthy,
    lastCheckedAt: new Date('2026-11-19T12:16:00Z'),
  });
  assert.equal(healthy.level, 'healthy');
  assert.equal(healthy.latestWebhookAt?.toISOString(), '2026-11-19T12:15:00.000Z');
  assert.equal(healthy.failedOrUnmappedCount, 0);

  // 5. Degraded when delivery failed or unmapped
  const degraded = computeWebhookHealthStatus({
    githubStatus: readyConfig,
    integrations: [connectedIntegration],
    repositories: [repoOlder],
    recentDeliveries: [
      ...deliveriesHealthy,
      {
        deliveryId: 'd-2',
        eventType: 'pull_request',
        repositoryFullName: 'acme-org/unknown',
        installationId: '777',
        receivedAt: '2026-11-19T12:20:00.000Z',
        processingStatus: 'unmapped_repository',
        eventCount: 0,
      },
    ],
  });
  assert.equal(degraded.level, 'degraded');
  assert.equal(degraded.failedOrUnmappedCount, 1);
});

test('parseGitHubRepositoryUrl parses valid GitHub URLs and rejects invalid targets', () => {
  const standard = parseGitHubRepositoryUrl('https://github.com/acme-org/buildlog-app');
  assert.equal(standard.valid, true);
  if (standard.valid) {
    assert.equal(standard.fullName, 'acme-org/buildlog-app');
    assert.equal(standard.canonicalUrl, 'https://github.com/acme-org/buildlog-app');
  }

  const withGitSuffix = parseGitHubRepositoryUrl('https://github.com/octocat/hello.world.git/');
  assert.equal(withGitSuffix.valid, true);
  if (withGitSuffix.valid) {
    assert.equal(withGitSuffix.fullName, 'octocat/hello.world');
  }

  const withTreePath = parseGitHubRepositoryUrl('github.com/acme/repo/tree/main/src');
  assert.equal(withTreePath.valid, true);
  if (withTreePath.valid) {
    assert.equal(withTreePath.fullName, 'acme/repo');
  }

  const withSsh = parseGitHubRepositoryUrl('git@github.com:acme/ledger.git');
  assert.equal(withSsh.valid, true);
  if (withSsh.valid) {
    assert.equal(withSsh.fullName, 'acme/ledger');
  }

  assert.equal(parseGitHubRepositoryUrl('').valid, false);
  assert.equal(parseGitHubRepositoryUrl('https://gitlab.com/acme/repo').valid, false);
  assert.equal(parseGitHubRepositoryUrl('https://github.com/only-owner').valid, false);
  assert.equal(parseGitHubRepositoryUrl('not a url').valid, false);
});

test('parseApiResponseBody surfaces HTML/empty 200 responses and API errors clearly', () => {
  const okData = parseApiResponseBody<{ status: string }>(
    '/api/github/repositories/prepare-connect',
    200,
    true,
    'application/json',
    JSON.stringify({ status: 'authorization_required' })
  );
  assert.equal(okData.status, 'authorization_required');

  assert.throws(
    () =>
      parseApiResponseBody(
        '/api/github/repositories/prepare-connect',
        503,
        false,
        'application/json',
        JSON.stringify({ error: 'GitHub repository connection is not configured.' })
      ),
    /GitHub repository connection is not configured/
  );

  assert.throws(
    () =>
      parseApiResponseBody(
        '/api/github/repositories/prepare-connect',
        200,
        true,
        'text/html; charset=utf-8',
        '<!doctype html><html><body>SPA Fallback</body></html>'
      ),
    /Server returned HTML instead of JSON/
  );

  assert.throws(
    () =>
      parseApiResponseBody(
        '/api/github/repositories/prepare-connect',
        200,
        true,
        'application/json',
        ''
      ),
    /invalid or empty response/
  );
});
