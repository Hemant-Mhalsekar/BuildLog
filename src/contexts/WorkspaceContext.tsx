import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  createActivitySummaryRecord,
  ingestNormalizedEventsToFirestore,
  saveProjectMemoryRecord,
  subscribeActivityEvents,
  subscribeActivitySummaries,
  subscribeIntegrations,
  subscribeProjectMemory,
  subscribeRepositories,
  updateActivityEventStatus,
} from '../services/dbService';
import {
  acknowledgePendingWebhookEvents,
  fetchGitHubAppStatus,
  fetchPendingWebhookIngestion,
  importRepositoryHistoryFromGitHub,
  requestActivitySummarization,
  syncInstallationMappingToServer,
} from '../services/apiClient';
import { parseFriendlyFirestoreError } from '../lib/firebase';
import { synthesizeProjectMemoryFromHistory } from '../utils/projectMemoryBuilder';
import type {
  ActivityEvent,
  ActivitySummary,
  GitHubAppConfigStatus,
  Integration,
  ProjectMemory,
  Repository,
  WebhookDeliveryRecord,
} from '../types/models';

interface WorkspaceContextValue {
  integrations: Integration[];
  repositories: Repository[];
  activityEvents: ActivityEvent[];
  activitySummaries: ActivitySummary[];
  projectMemory: ProjectMemory[];
  recentDeliveries: WebhookDeliveryRecord[];
  githubStatus: GitHubAppConfigStatus | null;
  loading: boolean;
  error: string | null;
  syncingRepoId: string | null;
  summarizingRepoId: string | null;
  lastWebhookCheckedAt: Date | null;
  checkingWebhookHealth: boolean;
  refreshPendingWebhooks: () => Promise<void>;
  refreshGitHubStatusAndHealth: () => Promise<void>;
  syncRepositoryHistory: (repository: Repository) => Promise<{ insertedCount: number }>;
  summarizeRepositoryPendingEvents: (
    repository: Repository,
    eventsToSummarize?: ActivityEvent[]
  ) => Promise<{ summarizedCount: number; status: string; message?: string }>;
  refreshProjectMemory: (repository: Repository, extraEvents?: ActivityEvent[]) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, authReady } = useAuth();

  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activitySummaries, setActivitySummaries] = useState<ActivitySummary[]>([]);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory[]>([]);
  const [recentDeliveries, setRecentDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [githubStatus, setGithubStatus] = useState<GitHubAppConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const [summarizingRepoId, setSummarizingRepoId] = useState<string | null>(null);
  const [lastWebhookCheckedAt, setLastWebhookCheckedAt] = useState<Date | null>(null);
  const [checkingWebhookHealth, setCheckingWebhookHealth] = useState(false);

  const pollingLockRef = useRef(false);

  useEffect(() => {
    if (!authReady) return;

    if (!user) {
      setIntegrations([]);
      setRepositories([]);
      setActivityEvents([]);
      setActivitySummaries([]);
      setProjectMemory([]);
      setRecentDeliveries([]);
      setGithubStatus(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const loaded = {
      integrations: false,
      repositories: false,
      events: false,
      summaries: false,
      memory: false,
    };

    const markLoaded = () => {
      if (
        loaded.integrations &&
        loaded.repositories &&
        loaded.events &&
        loaded.summaries &&
        loaded.memory
      ) {
        setLoading(false);
      }
    };

    const handleSubError = (err: unknown) => {
      setError(parseFriendlyFirestoreError(err, 'Unable to load BuildLog workspace data.'));
      setLoading(false);
    };

    const unsubIntegrations = subscribeIntegrations(
      user.uid,
      (data) => {
        setIntegrations(data);
        loaded.integrations = true;
        markLoaded();
      },
      handleSubError
    );

    const unsubRepositories = subscribeRepositories(
      user.uid,
      (data) => {
        setRepositories(data);
        loaded.repositories = true;
        markLoaded();
      },
      handleSubError
    );

    const unsubEvents = subscribeActivityEvents(
      user.uid,
      (data) => {
        setActivityEvents(data);
        loaded.events = true;
        markLoaded();
      },
      handleSubError
    );

    const unsubSummaries = subscribeActivitySummaries(
      user.uid,
      (data) => {
        setActivitySummaries(data);
        loaded.summaries = true;
        markLoaded();
      },
      handleSubError
    );

    const unsubMemory = subscribeProjectMemory(
      user.uid,
      (data) => {
        setProjectMemory(data);
        loaded.memory = true;
        markLoaded();
      },
      handleSubError
    );

    void fetchGitHubAppStatus()
      .then((status) => setGithubStatus(status))
      .catch(() => {
        // Keep null if backend unreachable
      });

    return () => {
      unsubIntegrations();
      unsubRepositories();
      unsubEvents();
      unsubSummaries();
      unsubMemory();
    };
  }, [user, authReady]);

  // Keep server-side installation/repo routing mapping synchronized for incoming webhooks
  useEffect(() => {
    if (!user || loading) return;
    for (const integration of integrations) {
      if (integration.status !== 'connected') continue;
      const linkedRepos = repositories
        .filter((r) => r.integrationId === integration.id)
        .map((r) => ({
          repositoryId: r.id,
          githubRepositoryId: r.githubRepositoryId,
          fullName: r.fullName,
          status: r.status,
        }));

      void syncInstallationMappingToServer({
        installationId: integration.installationId,
        integrationId: integration.id,
        accountName: integration.accountName,
        repositories: linkedRepos,
      }).catch(() => {
        // Silent background mapping sync
      });
    }
  }, [user, loading, integrations, repositories]);

  const refreshPendingWebhooks = useCallback(async () => {
    if (!user || pollingLockRef.current) return;
    pollingLockRef.current = true;
    try {
      const { pendingEvents, recentDeliveries: deliveries } = await fetchPendingWebhookIngestion();
      setRecentDeliveries(deliveries);

      if (pendingEvents.length > 0) {
        const byRepo = new Map<string, typeof pendingEvents>();
        for (const item of pendingEvents) {
          const list = byRepo.get(item.repositoryId) ?? [];
          list.push(item);
          byRepo.set(item.repositoryId, list);
        }

        const ackIds: string[] = [];
        for (const [repoId, items] of byRepo.entries()) {
          await ingestNormalizedEventsToFirestore(
            user.uid,
            repoId,
            items.map((i) => i.payload)
          );
          ackIds.push(...items.map((i) => i.queueId));
        }

        await acknowledgePendingWebhookEvents(ackIds);
      }
      setLastWebhookCheckedAt(new Date());
    } catch {
      // Non-fatal background polling
    } finally {
      pollingLockRef.current = false;
    }
  }, [user]);

  const refreshGitHubStatusAndHealth = useCallback(async () => {
    if (!user) return;
    setCheckingWebhookHealth(true);
    try {
      const [status] = await Promise.all([
        fetchGitHubAppStatus().catch(() => null),
        refreshPendingWebhooks(),
      ]);
      if (status) {
        setGithubStatus(status);
      }
      setLastWebhookCheckedAt(new Date());
    } finally {
      setCheckingWebhookHealth(false);
    }
  }, [user, refreshPendingWebhooks]);

  useEffect(() => {
    if (!user || loading) return;
    void refreshPendingWebhooks();
    const timer = window.setInterval(() => {
      void refreshPendingWebhooks();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [user, loading, refreshPendingWebhooks]);

  const refreshProjectMemory = useCallback(
    async (repository: Repository, extraEvents?: ActivityEvent[]) => {
      if (!user) return;
      const existingEvents = activityEvents.filter((e) => e.repositoryId === repository.id);
      const mergedMap = new Map<string, ActivityEvent>();
      for (const ev of existingEvents) {
        mergedMap.set(ev.eventId || ev.id, ev);
      }
      if (extraEvents) {
        for (const ev of extraEvents) {
          mergedMap.set(ev.eventId || ev.id, ev);
        }
      }
      const repoEvents = Array.from(mergedMap.values());
      const repoSummaries = activitySummaries.filter((s) => s.repositoryId === repository.id);
      const existing = projectMemory.find((m) => m.repositoryId === repository.id) ?? null;

      const synthesized = synthesizeProjectMemoryFromHistory(
        repository,
        repoEvents,
        repoSummaries,
        existing
      );
      await saveProjectMemoryRecord(user.uid, repository.id, synthesized);
    },
    [user, activityEvents, activitySummaries, projectMemory]
  );

  const summarizeRepositoryPendingEvents = useCallback(
    async (
      repository: Repository,
      eventsToSummarize?: ActivityEvent[]
    ): Promise<{ summarizedCount: number; status: string; message?: string }> => {
      if (!user) {
        return { summarizedCount: 0, status: 'failed', message: 'Not authenticated.' };
      }

      const targets =
        eventsToSummarize ??
        activityEvents
          .filter(
            (e) =>
              e.repositoryId === repository.id &&
              (e.processingStatus === 'pending' ||
                e.processingStatus === 'recorded_without_summary' ||
                e.processingStatus === 'failed')
          )
          .slice(0, 12);

      if (targets.length === 0) {
        return {
          summarizedCount: 0,
          status: 'idle',
          message: 'No pending events to summarize for this repository.',
        };
      }

      setSummarizingRepoId(repository.id);
      try {
        const result = await requestActivitySummarization({
          repositoryFullName: repository.fullName,
          events: targets.map((e) => ({
            id: e.id,
            eventType: e.eventType,
            branch: e.branch,
            commitSha: e.commitSha,
            title: e.title,
            description: e.description,
            changedFiles: e.changedFiles,
            occurredAt: e.occurredAt.toISOString(),
            sourceUrl: e.sourceUrl,
            author: e.author,
          })),
        });

        if (result.ok && result.summary) {
          await createActivitySummaryRecord(user.uid, repository.id, {
            relatedEventIds: targets.map((e) => e.id),
            summary: result.summary,
            evidence: result.evidence ?? [],
            inferences: result.inferences ?? [],
            suggestedNextSteps: result.suggestedNextSteps ?? [],
            areasInvolved: result.areasInvolved ?? [],
            model: result.model,
            status: 'ready',
          });

          for (const ev of targets) {
            await updateActivityEventStatus(ev.id, 'summarized');
          }

          await refreshProjectMemory(repository);
          return {
            summarizedCount: targets.length,
            status: 'ready',
          };
        }

        const nextStatus: ActivityEvent['processingStatus'] =
          result.status === 'unavailable' ? 'recorded_without_summary' : 'failed';
        for (const ev of targets) {
          await updateActivityEventStatus(ev.id, nextStatus, result.reason || '');
        }
        await refreshProjectMemory(repository);

        return {
          summarizedCount: 0,
          status: result.status,
          message:
            result.reason ||
            'Gemini summarizer unavailable. Raw GitHub activity was safely recorded.',
        };
      } finally {
        setSummarizingRepoId(null);
      }
    },
    [user, activityEvents, refreshProjectMemory]
  );

  const syncRepositoryHistory = useCallback(
    async (repository: Repository): Promise<{ insertedCount: number }> => {
      if (!user) throw new Error('Sign in required.');
      const integration = integrations.find((i) => i.id === repository.integrationId);
      if (!integration || integration.status !== 'connected') {
        throw new Error('GitHub integration for this repository is not connected.');
      }

      setSyncingRepoId(repository.id);
      try {
        const { events } = await importRepositoryHistoryFromGitHub({
          installationId: integration.installationId,
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
        });

        const insertedIds = await ingestNormalizedEventsToFirestore(
          user.uid,
          repository.id,
          events
        );

        const syntheticEvents: ActivityEvent[] = events.map((ev, index) => ({
          id: insertedIds[index] ?? ev.eventId,
          ownerId: user.uid,
          repositoryId: repository.id,
          eventId: ev.eventId,
          eventType: ev.eventType,
          branch: ev.branch,
          commitSha: ev.commitSha,
          title: ev.title,
          description: ev.description,
          sourceUrl: ev.sourceUrl,
          changedFiles: ev.changedFiles,
          occurredAt: new Date(ev.occurredAt),
          processingStatus: 'pending',
          author: ev.author,
          prNumber: ev.prNumber ?? null,
          prState: ev.prState ?? '',
          issueNumber: ev.issueNumber ?? null,
          issueState: ev.issueState ?? '',
        }));

        await refreshProjectMemory(repository, syntheticEvents);
        return { insertedCount: insertedIds.length };
      } finally {
        setSyncingRepoId(null);
      }
    },
    [user, integrations, refreshProjectMemory]
  );

  return (
    <WorkspaceContext.Provider
      value={{
        integrations,
        repositories,
        activityEvents,
        activitySummaries,
        projectMemory,
        recentDeliveries,
        githubStatus,
        loading,
        error,
        syncingRepoId,
        summarizingRepoId,
        lastWebhookCheckedAt,
        checkingWebhookHealth,
        refreshPendingWebhooks,
        refreshGitHubStatusAndHealth,
        syncRepositoryHistory,
        summarizeRepositoryPendingEvents,
        refreshProjectMemory,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
}
