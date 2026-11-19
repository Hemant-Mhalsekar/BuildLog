import type {
  ActivityCluster,
  ActivityEvent,
  ActivitySummary,
  ProjectMemory,
  Repository,
} from '../types/models';
import { clusterActivityEvents } from './activityClustering';

export interface WeeklyActivityBucket {
  dateKey: string;
  label: string;
  pushCount: number;
  prIssueCount: number;
  totalCount: number;
}

export interface EnrichedRecentEvent extends ActivityEvent {
  repositoryName: string;
}

export interface DashboardMetrics {
  activeReposCount: number;
  totalReposCount: number;
  totalEventsCount: number;
  eventsThisWeekCount: number;
  aiSummariesCount: number;
  pendingEventsCount: number;
  openPullRequestsCount: number;
  openIssuesCount: number;
  weeklyActivity: WeeklyActivityBucket[];
  recentClusters: ActivityCluster[];
  recentEvents: EnrichedRecentEvent[];
}

function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function computeDashboardMetrics(
  repositories: Repository[],
  activityEvents: ActivityEvent[],
  activitySummaries: ActivitySummary[],
  projectMemory: ProjectMemory[],
  now: Date = new Date()
): DashboardMetrics {
  const repoMap = new Map(repositories.map((r) => [r.id, r]));

  const activeReposCount = repositories.filter((r) => r.status === 'active').length;
  const totalReposCount = repositories.length;
  const totalEventsCount = activityEvents.length;
  const aiSummariesCount = activitySummaries.filter((s) => s.status !== 'failed').length;
  const pendingEventsCount = activityEvents.filter((e) => e.processingStatus === 'pending').length;

  const openPullRequestsCount = projectMemory.reduce(
    (sum, m) => sum + m.openPullRequests.length,
    0
  );
  const openIssuesCount = projectMemory.reduce((sum, m) => sum + m.openIssues.length, 0);

  const weeklyMap = new Map<string, WeeklyActivityBucket>();
  const orderedKeys: string[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const key = toDayKey(d);
    orderedKeys.push(key);
    weeklyMap.set(key, {
      dateKey: key,
      label: DAY_LABELS[d.getDay()],
      pushCount: 0,
      prIssueCount: 0,
      totalCount: 0,
    });
  }

  let eventsThisWeekCount = 0;
  for (const ev of activityEvents) {
    const key = toDayKey(ev.occurredAt);
    const bucket = weeklyMap.get(key);
    if (bucket) {
      if (ev.eventType === 'push') {
        bucket.pushCount += 1;
      } else {
        bucket.prIssueCount += 1;
      }
      bucket.totalCount += 1;
      eventsThisWeekCount += 1;
    }
  }

  const weeklyActivity = orderedKeys.map((k) => weeklyMap.get(k)!);
  const recentClusters = clusterActivityEvents(activityEvents, repositories).slice(0, 5);

  const recentEvents: EnrichedRecentEvent[] = [...activityEvents]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 8)
    .map((ev) => ({
      ...ev,
      repositoryName: repoMap.get(ev.repositoryId)?.fullName ?? 'Connected repository',
    }));

  return {
    activeReposCount,
    totalReposCount,
    totalEventsCount,
    eventsThisWeekCount,
    aiSummariesCount,
    pendingEventsCount,
    openPullRequestsCount,
    openIssuesCount,
    weeklyActivity,
    recentClusters,
    recentEvents,
  };
}
