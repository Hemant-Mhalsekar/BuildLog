import { auth } from '../lib/firebase';
import { parseApiResponseBody } from '../utils/apiResponse';
import type {
  CompleteGitHubAuthResponse,
  GitHubAppConfigStatus,
  NormalizedGitHubEventPayload,
  PrepareConnectRepositoryResponse,
  RepositoryStatus,
  WebhookDeliveryRecord,
} from '../types/models';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to perform this action.');
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers ?? {}),
    },
  });

  const rawText = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  return parseApiResponseBody<T>(url, res.status, res.ok, contentType, rawText);
}

export async function fetchGitHubAppStatus(): Promise<GitHubAppConfigStatus> {
  return apiJson<GitHubAppConfigStatus>('/api/github/status');
}

export async function prepareRepositoryConnect(
  repositoryUrl: string
): Promise<PrepareConnectRepositoryResponse> {
  return apiJson<PrepareConnectRepositoryResponse>('/api/github/repositories/prepare-connect', {
    method: 'POST',
    body: JSON.stringify({ repositoryUrl }),
  });
}

export async function completeGitHubAuthorization(payload: {
  state: string;
  code?: string;
  installationId?: string;
  redirectUri?: string;
}): Promise<CompleteGitHubAuthResponse> {
  return apiJson<CompleteGitHubAuthResponse>('/api/github/repositories/complete-authorization', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function syncInstallationMappingToServer(payload: {
  installationId: string;
  integrationId: string;
  accountName: string;
  repositories: Array<{
    repositoryId: string;
    githubRepositoryId: string;
    fullName: string;
    status: RepositoryStatus;
  }>;
}): Promise<void> {
  await apiJson('/api/github/installations/sync-mapping', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function importRepositoryHistoryFromGitHub(payload: {
  installationId: string;
  fullName: string;
  defaultBranch: string;
}): Promise<{ events: NormalizedGitHubEventPayload[] }> {
  return apiJson('/api/github/repositories/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function disconnectInstallationOnServer(installationId: string): Promise<void> {
  await apiJson(`/api/github/installations/${encodeURIComponent(installationId)}`, {
    method: 'DELETE',
  });
}

export interface PendingQueueItem {
  queueId: string;
  ownerId: string;
  repositoryId: string;
  githubRepositoryId: string;
  repositoryFullName: string;
  deliveryId: string;
  payload: NormalizedGitHubEventPayload;
  receivedAt: string;
}

export async function fetchPendingWebhookIngestion(): Promise<{
  pendingEvents: PendingQueueItem[];
  recentDeliveries: WebhookDeliveryRecord[];
}> {
  return apiJson('/api/ingestion/pending');
}

export async function acknowledgePendingWebhookEvents(queueIds: string[]): Promise<void> {
  if (queueIds.length === 0) return;
  await apiJson('/api/ingestion/ack', {
    method: 'POST',
    body: JSON.stringify({ queueIds }),
  });
}

export async function requestActivitySummarization(payload: {
  repositoryFullName: string;
  events: Array<{
    id: string;
    eventType: string;
    branch: string;
    commitSha: string;
    title: string;
    description: string;
    changedFiles: string[];
    occurredAt: string;
    sourceUrl: string;
    author?: string;
  }>;
}): Promise<{
  ok: boolean;
  status: 'ready' | 'unavailable' | 'failed';
  summary?: string;
  evidence?: string[];
  inferences?: string[];
  suggestedNextSteps?: string[];
  areasInvolved?: string[];
  model?: string;
  reason?: string;
}> {
  return apiJson('/api/summarize', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function purgeServerAccountData(): Promise<void> {
  await apiJson('/api/account/data', {
    method: 'DELETE',
  });
}
