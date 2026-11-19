export type IntegrationProvider = 'github';
export type IntegrationStatus = 'connected' | 'pending' | 'disconnected' | 'error';

export type RepositoryStatus = 'active' | 'paused' | 'disconnected';
export type GitHubEventType = 'push' | 'pull_request' | 'issues';
export type ProcessingStatus = 'pending' | 'summarized' | 'recorded_without_summary' | 'failed';
export type SummaryStatus = 'ready' | 'unavailable' | 'failed';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  optInCodeDiff: boolean;
  retentionDays: number;
  createdAt: Date;
  updatedAt?: Date;
}

export interface Integration {
  id: string;
  ownerId: string;
  provider: IntegrationProvider;
  installationId: string;
  accountName: string;
  status: IntegrationStatus;
  connectedAt: Date;
  updatedAt?: Date;
  lastWebhookAt?: Date | null;
}

export interface Repository {
  id: string;
  ownerId: string;
  integrationId: string;
  githubRepositoryId: string;
  fullName: string;
  description: string;
  defaultBranch: string;
  primaryLanguage: string;
  lastSyncedAt: Date | null;
  status: RepositoryStatus;
  objective?: string;
  htmlUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ActivityEvent {
  id: string;
  ownerId: string;
  repositoryId: string;
  eventId: string;
  eventType: GitHubEventType;
  branch: string;
  commitSha: string;
  title: string;
  description: string;
  sourceUrl: string;
  changedFiles: string[];
  occurredAt: Date;
  processingStatus: ProcessingStatus;
  author?: string;
  prNumber?: number | null;
  prState?: string;
  issueNumber?: number | null;
  issueState?: string;
  errorMessage?: string;
  createdAt?: Date;
}

export interface ActivitySummary {
  id: string;
  ownerId: string;
  repositoryId: string;
  relatedEventIds: string[];
  summary: string;
  evidence: string[];
  inferences: string[];
  suggestedNextSteps: string[];
  areasInvolved: string[];
  model?: string;
  status?: SummaryStatus;
  generatedAt: Date;
}

export interface ProjectMemory {
  id: string;
  ownerId: string;
  repositoryId: string;
  projectOverview: string;
  objective?: string;
  technologies?: string[];
  modifiedCodeAreas?: string[];
  recentChanges: string[];
  openIssues: string[];
  openPullRequests: string[];
  technicalDecisions: string[];
  knownBlockers?: string[];
  suggestedNextSteps: string[];
  supportingEventIds: string[];
  lastUpdatedAt: Date;
}

export interface ActivityCluster {
  clusterId: string;
  repositoryId: string;
  repositoryName: string;
  isInferred: true;
  label: string;
  startAt: Date;
  endAt: Date;
  eventCount: number;
  events: ActivityEvent[];
  branches: string[];
  changedFiles: string[];
}

export interface GitHubAppConfigStatus {
  configured: boolean;
  oauthConfigured: boolean;
  webhookConfigured: boolean;
  geminiConfigured: boolean;
  appSlug: string | null;
  installUrl: string | null;
  webhookPath: string;
  missingEnvVars: string[];
}

export interface NormalizedGitHubEventPayload {
  eventId: string;
  eventType: GitHubEventType;
  branch: string;
  commitSha: string;
  title: string;
  description: string;
  sourceUrl: string;
  changedFiles: string[];
  occurredAt: string;
  author: string;
  prNumber?: number | null;
  prState?: string;
  issueNumber?: number | null;
  issueState?: string;
}

export interface RemoteGitHubRepository {
  githubRepositoryId: string;
  fullName: string;
  description: string;
  defaultBranch: string;
  primaryLanguage: string;
  htmlUrl: string;
  private: boolean;
}

export type PrepareConnectRepositoryResponse =
  | {
      status: 'authorized';
      fullName: string;
      installationId: string;
      accountName: string;
      repository: RemoteGitHubRepository;
      alreadyAuthorized: true;
    }
  | {
      status: 'authorization_required';
      fullName: string;
      authorizeUrl: string;
    };

export type CompleteGitHubAuthResponse =
  | {
      status: 'authorized';
      fullName: string;
      installationId: string;
      accountName: string;
      githubLogin: string;
      repository: RemoteGitHubRepository;
    }
  | {
      status: 'oauth_verification_required';
      fullName: string;
      authorizeUrl: string;
    };

export interface WebhookDeliveryRecord {
  deliveryId: string;
  eventType: string;
  repositoryFullName: string;
  installationId: string;
  receivedAt: string;
  processingStatus: ProcessingStatus | 'duplicate_ignored' | 'unmapped_repository';
  eventCount: number;
  errorMessage?: string;
}
