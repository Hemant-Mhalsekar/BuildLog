import type {
  ActivityEvent,
  ActivitySummary,
  Integration,
  ProjectMemory,
  Repository,
  UserProfile,
} from '../types/models';

export interface BuildLogJsonExport {
  exportedAt: string;
  application: 'BuildLog';
  version: '2.0.0';
  user: {
    uid: string;
    displayName: string;
    email: string;
    optInCodeDiff: boolean;
    retentionDays: number;
    createdAt: string;
  } | null;
  counts: {
    integrations: number;
    repositories: number;
    activityEvents: number;
    activitySummaries: number;
    projectMemory: number;
  };
  integrations: Array<Omit<Integration, 'connectedAt' | 'updatedAt' | 'lastWebhookAt'> & {
    connectedAt: string;
    updatedAt: string | null;
    lastWebhookAt: string | null;
  }>;
  repositories: Array<Omit<Repository, 'lastSyncedAt' | 'createdAt' | 'updatedAt'> & {
    lastSyncedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  activity_events: Array<Omit<ActivityEvent, 'occurredAt' | 'createdAt'> & {
    occurredAt: string;
    createdAt: string | null;
  }>;
  activity_summaries: Array<Omit<ActivitySummary, 'generatedAt'> & {
    generatedAt: string;
  }>;
  project_memory: Array<Omit<ProjectMemory, 'lastUpdatedAt'> & {
    lastUpdatedAt: string;
  }>;
}

export function buildPersonalJsonExport(
  userProfile: UserProfile | null,
  integrations: Integration[],
  repositories: Repository[],
  activityEvents: ActivityEvent[],
  activitySummaries: ActivitySummary[],
  projectMemory: ProjectMemory[],
  now: Date = new Date()
): BuildLogJsonExport {
  return {
    exportedAt: now.toISOString(),
    application: 'BuildLog',
    version: '2.0.0',
    user: userProfile
      ? {
          uid: userProfile.uid,
          displayName: userProfile.displayName,
          email: userProfile.email,
          optInCodeDiff: userProfile.optInCodeDiff,
          retentionDays: userProfile.retentionDays,
          createdAt: userProfile.createdAt.toISOString(),
        }
      : null,
    counts: {
      integrations: integrations.length,
      repositories: repositories.length,
      activityEvents: activityEvents.length,
      activitySummaries: activitySummaries.length,
      projectMemory: projectMemory.length,
    },
    integrations: integrations.map((i) => ({
      ...i,
      connectedAt: i.connectedAt.toISOString(),
      updatedAt: i.updatedAt ? i.updatedAt.toISOString() : null,
      lastWebhookAt: i.lastWebhookAt ? i.lastWebhookAt.toISOString() : null,
    })),
    repositories: repositories.map((r) => ({
      ...r,
      lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    })),
    activity_events: activityEvents.map((e) => ({
      ...e,
      occurredAt: e.occurredAt.toISOString(),
      createdAt: e.createdAt ? e.createdAt.toISOString() : null,
    })),
    activity_summaries: activitySummaries.map((s) => ({
      ...s,
      generatedAt: s.generatedAt.toISOString(),
    })),
    project_memory: projectMemory.map((m) => ({
      ...m,
      lastUpdatedAt: m.lastUpdatedAt.toISOString(),
    })),
  };
}

export function slugifyFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'buildlog-export'
  );
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/plain;charset=utf-8'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
