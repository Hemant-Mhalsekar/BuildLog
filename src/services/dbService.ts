import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  ActivityEvent,
  ActivitySummary,
  Integration,
  IntegrationStatus,
  NormalizedGitHubEventPayload,
  ProcessingStatus,
  ProjectMemory,
  RemoteGitHubRepository,
  Repository,
  RepositoryStatus,
  UserProfile,
} from '../types/models';
import { toDate } from '../utils/dateUtils';
import { sanitizeStringList, SCHEMA_LIMITS } from '../utils/validation';
import type { SynthesizedMemoryPayload } from '../utils/projectMemoryBuilder';

function stableEventDocId(repositoryId: string, eventId: string): string {
  // Deterministic Firestore-safe doc ID (matches ^[a-zA-Z0-9_-]+$) to avoid duplicates
  let hash = 2166136261;
  for (let i = 0; i < eventId.length; i += 1) {
    hash ^= eventId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  const safeSlug = eventId
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40);
  return `${repositoryId.slice(0, 24)}_${safeSlug}_${hex}`.slice(0, 120);
}

// --- Subscriptions ---

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        uid: String(d.uid ?? snap.id),
        displayName: String(d.displayName ?? ''),
        email: String(d.email ?? ''),
        optInCodeDiff: Boolean(d.optInCodeDiff ?? false),
        retentionDays: typeof d.retentionDays === 'number' ? d.retentionDays : 365,
        createdAt: toDate(d.createdAt),
        updatedAt: d.updatedAt ? toDate(d.updatedAt) : undefined,
      });
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeIntegrations(
  uid: string,
  onData: (integrations: Integration[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = 'integrations';
  const q = query(collection(db, 'integrations'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Integration[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ''),
          provider: 'github',
          installationId: String(data.installationId ?? ''),
          accountName: String(data.accountName ?? ''),
          status: (data.status as IntegrationStatus) ?? 'connected',
          connectedAt: toDate(data.connectedAt),
          updatedAt: data.updatedAt ? toDate(data.updatedAt) : undefined,
          lastWebhookAt: data.lastWebhookAt ? toDate(data.lastWebhookAt) : null,
        };
      });
      items.sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime());
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeRepositories(
  uid: string,
  onData: (repositories: Repository[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = 'repositories';
  const q = query(collection(db, 'repositories'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Repository[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ''),
          integrationId: String(data.integrationId ?? ''),
          githubRepositoryId: String(data.githubRepositoryId ?? ''),
          fullName: String(data.fullName ?? ''),
          description: String(data.description ?? ''),
          defaultBranch: String(data.defaultBranch ?? 'main'),
          primaryLanguage: String(data.primaryLanguage ?? ''),
          lastSyncedAt: data.lastSyncedAt ? toDate(data.lastSyncedAt) : null,
          status: (data.status as RepositoryStatus) ?? 'active',
          objective: data.objective ? String(data.objective) : '',
          htmlUrl: data.htmlUrl ? String(data.htmlUrl) : '',
          createdAt: data.createdAt ? toDate(data.createdAt) : undefined,
          updatedAt: data.updatedAt ? toDate(data.updatedAt) : undefined,
        };
      });
      items.sort((a, b) => {
        const aTime = a.lastSyncedAt?.getTime() ?? a.updatedAt?.getTime() ?? 0;
        const bTime = b.lastSyncedAt?.getTime() ?? b.updatedAt?.getTime() ?? 0;
        return bTime - aTime;
      });
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeActivityEvents(
  uid: string,
  onData: (events: ActivityEvent[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = 'activity_events';
  const q = query(collection(db, 'activity_events'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ActivityEvent[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ''),
          repositoryId: String(data.repositoryId ?? ''),
          eventId: String(data.eventId ?? ''),
          eventType: (data.eventType as ActivityEvent['eventType']) ?? 'push',
          branch: String(data.branch ?? ''),
          commitSha: String(data.commitSha ?? ''),
          title: String(data.title ?? ''),
          description: String(data.description ?? ''),
          sourceUrl: String(data.sourceUrl ?? ''),
          changedFiles: Array.isArray(data.changedFiles) ? data.changedFiles.map(String) : [],
          occurredAt: toDate(data.occurredAt),
          processingStatus: (data.processingStatus as ProcessingStatus) ?? 'pending',
          author: data.author ? String(data.author) : '',
          prNumber: typeof data.prNumber === 'number' ? data.prNumber : null,
          prState: data.prState ? String(data.prState) : '',
          issueNumber: typeof data.issueNumber === 'number' ? data.issueNumber : null,
          issueState: data.issueState ? String(data.issueState) : '',
          errorMessage: data.errorMessage ? String(data.errorMessage) : '',
          createdAt: data.createdAt ? toDate(data.createdAt) : undefined,
        };
      });
      items.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeActivitySummaries(
  uid: string,
  onData: (summaries: ActivitySummary[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = 'activity_summaries';
  const q = query(collection(db, 'activity_summaries'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ActivitySummary[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ''),
          repositoryId: String(data.repositoryId ?? ''),
          relatedEventIds: Array.isArray(data.relatedEventIds)
            ? data.relatedEventIds.map(String)
            : [],
          summary: String(data.summary ?? ''),
          evidence: Array.isArray(data.evidence) ? data.evidence.map(String) : [],
          inferences: Array.isArray(data.inferences) ? data.inferences.map(String) : [],
          suggestedNextSteps: Array.isArray(data.suggestedNextSteps)
            ? data.suggestedNextSteps.map(String)
            : [],
          areasInvolved: Array.isArray(data.areasInvolved) ? data.areasInvolved.map(String) : [],
          model: data.model ? String(data.model) : undefined,
          status: (data.status as ActivitySummary['status']) ?? 'ready',
          generatedAt: toDate(data.generatedAt),
        };
      });
      items.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeProjectMemory(
  uid: string,
  onData: (memories: ProjectMemory[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = 'project_memory';
  const q = query(collection(db, 'project_memory'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ProjectMemory[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ''),
          repositoryId: String(data.repositoryId ?? ''),
          projectOverview: String(data.projectOverview ?? ''),
          objective: data.objective ? String(data.objective) : '',
          technologies: Array.isArray(data.technologies) ? data.technologies.map(String) : [],
          modifiedCodeAreas: Array.isArray(data.modifiedCodeAreas)
            ? data.modifiedCodeAreas.map(String)
            : [],
          recentChanges: Array.isArray(data.recentChanges) ? data.recentChanges.map(String) : [],
          openIssues: Array.isArray(data.openIssues) ? data.openIssues.map(String) : [],
          openPullRequests: Array.isArray(data.openPullRequests)
            ? data.openPullRequests.map(String)
            : [],
          technicalDecisions: Array.isArray(data.technicalDecisions)
            ? data.technicalDecisions.map(String)
            : [],
          knownBlockers: Array.isArray(data.knownBlockers) ? data.knownBlockers.map(String) : [],
          suggestedNextSteps: Array.isArray(data.suggestedNextSteps)
            ? data.suggestedNextSteps.map(String)
            : [],
          supportingEventIds: Array.isArray(data.supportingEventIds)
            ? data.supportingEventIds.map(String)
            : [],
          lastUpdatedAt: toDate(data.lastUpdatedAt),
        };
      });
      items.sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

// --- Integrations & Repositories ---

export async function saveGitHubIntegration(
  uid: string,
  installationId: string,
  accountName: string,
  existingIntegrationId?: string
): Promise<string> {
  const cleanInstId = installationId.trim().slice(0, SCHEMA_LIMITS.INSTALLATION_ID_MAX);
  const cleanAccount = (accountName.trim() || 'github').slice(0, SCHEMA_LIMITS.ACCOUNT_NAME_MAX);

  if (existingIntegrationId) {
    const path = `integrations/${existingIntegrationId}`;
    try {
      await updateDoc(doc(db, 'integrations', existingIntegrationId), {
        installationId: cleanInstId,
        accountName: cleanAccount,
        status: 'connected',
        updatedAt: serverTimestamp(),
      });
      return existingIntegrationId;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const path = 'integrations';
  try {
    const ref = await addDoc(collection(db, 'integrations'), {
      ownerId: uid,
      provider: 'github',
      installationId: cleanInstId,
      accountName: cleanAccount,
      status: 'connected',
      connectedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastWebhookAt: null,
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function upsertConnectedRepository(
  uid: string,
  integrationId: string,
  remoteRepo: RemoteGitHubRepository,
  existingRepo?: Repository
): Promise<string> {
  if (existingRepo) {
    const path = `repositories/${existingRepo.id}`;
    try {
      await updateDoc(doc(db, 'repositories', existingRepo.id), {
        description: remoteRepo.description.slice(0, SCHEMA_LIMITS.REPO_DESC_MAX),
        defaultBranch: remoteRepo.defaultBranch.slice(0, 120) || 'main',
        primaryLanguage: remoteRepo.primaryLanguage.slice(0, 60),
        htmlUrl: remoteRepo.htmlUrl.slice(0, 500),
        status: 'active',
        lastSyncedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return existingRepo.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const path = 'repositories';
  try {
    const ref = await addDoc(collection(db, 'repositories'), {
      ownerId: uid,
      integrationId,
      githubRepositoryId: remoteRepo.githubRepositoryId.slice(0, 64),
      fullName: remoteRepo.fullName.slice(0, SCHEMA_LIMITS.REPO_FULL_NAME_MAX),
      description: remoteRepo.description.slice(0, SCHEMA_LIMITS.REPO_DESC_MAX),
      defaultBranch: remoteRepo.defaultBranch.slice(0, 120) || 'main',
      primaryLanguage: remoteRepo.primaryLanguage.slice(0, 60),
      htmlUrl: remoteRepo.htmlUrl.slice(0, 500),
      objective: '',
      status: 'active',
      lastSyncedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateRepositoryStatus(
  repositoryId: string,
  status: RepositoryStatus
): Promise<void> {
  const path = `repositories/${repositoryId}`;
  try {
    await updateDoc(doc(db, 'repositories', repositoryId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateRepositoryObjective(
  repositoryId: string,
  objective: string
): Promise<void> {
  const path = `repositories/${repositoryId}`;
  try {
    await updateDoc(doc(db, 'repositories', repositoryId), {
      objective: objective.trim().slice(0, SCHEMA_LIMITS.REPO_OBJECTIVE_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markRepositorySynced(repositoryId: string): Promise<void> {
  const path = `repositories/${repositoryId}`;
  try {
    await updateDoc(doc(db, 'repositories', repositoryId), {
      lastSyncedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function disconnectIntegrationAndRepos(
  integrationId: string,
  linkedRepositories: Repository[]
): Promise<void> {
  const path = `integrations/${integrationId}`;
  try {
    await updateDoc(doc(db, 'integrations', integrationId), {
      status: 'disconnected',
      updatedAt: serverTimestamp(),
    });
    for (const repo of linkedRepositories) {
      await updateDoc(doc(db, 'repositories', repo.id), {
        status: 'disconnected',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Activity Events, Summaries & Project Memory ---

export async function ingestNormalizedEventsToFirestore(
  uid: string,
  repositoryId: string,
  payloads: NormalizedGitHubEventPayload[]
): Promise<string[]> {
  const insertedIds: string[] = [];

  for (const item of payloads) {
    const docId = stableEventDocId(repositoryId, item.eventId);
    const ref = doc(db, 'activity_events', docId);
    const path = `activity_events/${docId}`;

    try {
      const existing = await getDoc(ref);
      if (existing.exists()) {
        continue;
      }

      const occurredDate = new Date(item.occurredAt);
      const safeDate = Number.isNaN(occurredDate.getTime()) ? new Date() : occurredDate;

      await setDoc(ref, {
        ownerId: uid,
        repositoryId,
        eventId: item.eventId.slice(0, 160),
        eventType: item.eventType,
        branch: (item.branch || 'main').slice(0, 200),
        commitSha: (item.commitSha || '').slice(0, 80),
        title: (item.title || 'GitHub activity').slice(0, SCHEMA_LIMITS.EVENT_TITLE_MAX),
        description: (item.description || '').slice(0, SCHEMA_LIMITS.EVENT_DESC_MAX),
        sourceUrl: (item.sourceUrl || '').slice(0, 500),
        changedFiles: sanitizeStringList(item.changedFiles ?? [], SCHEMA_LIMITS.EVENT_FILES_MAX, 300),
        occurredAt: Timestamp.fromDate(safeDate),
        processingStatus: 'pending',
        author: (item.author || 'unknown').slice(0, 120),
        prNumber: typeof item.prNumber === 'number' ? item.prNumber : null,
        prState: (item.prState || '').slice(0, 40),
        issueNumber: typeof item.issueNumber === 'number' ? item.issueNumber : null,
        issueState: (item.issueState || '').slice(0, 40),
        errorMessage: '',
        createdAt: serverTimestamp(),
      });
      insertedIds.push(docId);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  if (insertedIds.length > 0) {
    await markRepositorySynced(repositoryId).catch(() => {});
  }

  return insertedIds;
}

export async function updateActivityEventStatus(
  eventDocId: string,
  processingStatus: ProcessingStatus,
  errorMessage = ''
): Promise<void> {
  const path = `activity_events/${eventDocId}`;
  try {
    await updateDoc(doc(db, 'activity_events', eventDocId), {
      processingStatus,
      errorMessage: errorMessage.slice(0, 500),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createActivitySummaryRecord(
  uid: string,
  repositoryId: string,
  data: {
    relatedEventIds: string[];
    summary: string;
    evidence: string[];
    inferences: string[];
    suggestedNextSteps: string[];
    areasInvolved: string[];
    model?: string;
    status: ActivitySummary['status'];
  }
): Promise<string> {
  const path = 'activity_summaries';
  try {
    const ref = await addDoc(collection(db, 'activity_summaries'), {
      ownerId: uid,
      repositoryId,
      relatedEventIds: sanitizeStringList(data.relatedEventIds, 50, 160),
      summary: data.summary.trim().slice(0, SCHEMA_LIMITS.SUMMARY_TEXT_MAX),
      evidence: sanitizeStringList(data.evidence, 40, 300),
      inferences: sanitizeStringList(data.inferences, 30, 300),
      suggestedNextSteps: sanitizeStringList(data.suggestedNextSteps, 30, 300),
      areasInvolved: sanitizeStringList(data.areasInvolved, 30, 200),
      model: (data.model || 'gemini-4-hydrogen').slice(0, 80),
      status: data.status || 'ready',
      generatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveProjectMemoryRecord(
  uid: string,
  repositoryId: string,
  memory: SynthesizedMemoryPayload
): Promise<void> {
  const path = `project_memory/${repositoryId}`;
  const ref = doc(db, 'project_memory', repositoryId);

  const payload = {
    ownerId: uid,
    repositoryId,
    projectOverview: memory.projectOverview.slice(0, SCHEMA_LIMITS.SUMMARY_TEXT_MAX),
    objective: memory.objective.slice(0, SCHEMA_LIMITS.REPO_OBJECTIVE_MAX),
    technologies: sanitizeStringList(memory.technologies, 30, 120),
    modifiedCodeAreas: sanitizeStringList(memory.modifiedCodeAreas, 50, 200),
    recentChanges: sanitizeStringList(memory.recentChanges, 50, 300),
    openIssues: sanitizeStringList(memory.openIssues, 50, 300),
    openPullRequests: sanitizeStringList(memory.openPullRequests, 50, 300),
    technicalDecisions: sanitizeStringList(memory.technicalDecisions, 50, 300),
    knownBlockers: sanitizeStringList(memory.knownBlockers, 50, 300),
    suggestedNextSteps: sanitizeStringList(memory.suggestedNextSteps, 30, 300),
    supportingEventIds: sanitizeStringList(memory.supportingEventIds, 100, 160),
    lastUpdatedAt: serverTimestamp(),
  };

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, payload);
    } else {
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteAllUserBuildLogData(uid: string): Promise<void> {
  const collectionNames = [
    'activity_events',
    'activity_summaries',
    'project_memory',
    'repositories',
    'integrations',
  ] as const;

  for (const name of collectionNames) {
    const q = query(collection(db, name), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(doc(db, name, d.id));
    }
  }
}
