import type {
  GitHubAppConfigStatus,
  Integration,
  Repository,
  WebhookDeliveryRecord,
} from '../types/models';

export type WebhookHealthLevel =
  | 'healthy'
  | 'awaiting_events'
  | 'degraded'
  | 'setup_required';

export interface WebhookHealthSummary {
  level: WebhookHealthLevel;
  headline: string;
  description: string;
  serverReady: boolean;
  connectedInstallationsCount: number;
  activeReposCount: number;
  latestSyncedAt: Date | null;
  latestWebhookAt: Date | null;
  deliveryCount: number;
  failedOrUnmappedCount: number;
  lastCheckedAt: Date | null;
}

export interface ComputeWebhookHealthInput {
  githubStatus: GitHubAppConfigStatus | null;
  integrations: Integration[];
  repositories: Repository[];
  recentDeliveries: WebhookDeliveryRecord[];
  lastCheckedAt?: Date | null;
}

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const d of dates) {
    if (!d || Number.isNaN(d.getTime())) continue;
    if (!latest || d.getTime() > latest.getTime()) {
      latest = d;
    }
  }
  return latest;
}

export function computeWebhookHealthStatus({
  githubStatus,
  integrations,
  repositories,
  recentDeliveries,
  lastCheckedAt = null,
}: ComputeWebhookHealthInput): WebhookHealthSummary {
  const connectedInstallations = integrations.filter((i) => i.status === 'connected');
  const erroredInstallations = integrations.filter((i) => i.status === 'error');
  const activeReposCount = repositories.filter((r) => r.status === 'active').length;

  const latestSyncedAt = maxDate(repositories.map((r) => r.lastSyncedAt));

  const deliveryDates = recentDeliveries
    .map((d) => new Date(d.receivedAt))
    .filter((d) => !Number.isNaN(d.getTime()));
  const integrationWebhookDates = integrations.map((i) => i.lastWebhookAt);
  const latestWebhookAt = maxDate([...deliveryDates, ...integrationWebhookDates]);

  const failedOrUnmappedCount = recentDeliveries.filter(
    (d) => d.processingStatus === 'failed' || d.processingStatus === 'unmapped_repository'
  ).length;

  const serverReady = Boolean(
    githubStatus?.configured && githubStatus?.oauthConfigured && githubStatus?.webhookConfigured
  );

  let level: WebhookHealthLevel;
  let headline: string;
  let description: string;

  if (!githubStatus) {
    if (connectedInstallations.length === 0) {
      level = 'setup_required';
      headline = 'Not Connected';
      description =
        'Connect a GitHub repository to import recent activity and start automatic webhook tracking.';
    } else if (erroredInstallations.length > 0 || failedOrUnmappedCount > 0) {
      level = 'degraded';
      headline = 'Attention Needed';
      description =
        'Some recent webhook deliveries need review. Check Advanced Diagnostics on Integrations.';
    } else if (latestWebhookAt) {
      level = 'healthy';
      headline = 'Healthy · Live Webhooks';
      description =
        'Verified webhook deliveries are flowing into your workspace and updating project memory.';
    } else {
      level = 'awaiting_events';
      headline = 'Ready · Awaiting Events';
      description =
        'Repositories are connected. Push a commit, open a PR, or create an issue to confirm live webhook delivery.';
    }
  } else if (!serverReady || connectedInstallations.length === 0) {
    level = 'setup_required';
    headline = serverReady ? 'Ready to Connect' : 'Server Setup Required';
    if (!serverReady) {
      description =
        'GitHub integration requires server configuration by your workspace host. Expand Advanced Diagnostics on Integrations for details.';
    } else {
      description =
        'Connect a GitHub repository URL to authorize access and begin automatic webhook tracking.';
    }
  } else if (erroredInstallations.length > 0 || failedOrUnmappedCount > 0) {
    level = 'degraded';
    headline = 'Attention Needed';
    description =
      failedOrUnmappedCount > 0
        ? `${failedOrUnmappedCount} recent webhook ${failedOrUnmappedCount === 1 ? 'delivery requires' : 'deliveries require'} attention. Open Advanced Diagnostics for details.`
        : 'One or more connected GitHub accounts reported an authorization issue.';
  } else if (latestWebhookAt) {
    level = 'healthy';
    headline = 'Healthy · Live Webhooks';
    description =
      'Automatic webhook tracking is active and real-time GitHub events have been received.';
  } else {
    level = 'awaiting_events';
    headline = 'Ready · Awaiting Events';
    description =
      'Webhook tracking is armed for your connected repositories. Waiting for your first push, pull request, or issue event.';
  }

  return {
    level,
    headline,
    description,
    serverReady,
    connectedInstallationsCount: connectedInstallations.length,
    activeReposCount,
    latestSyncedAt,
    latestWebhookAt,
    deliveryCount: recentDeliveries.length,
    failedOrUnmappedCount,
    lastCheckedAt,
  };
}
