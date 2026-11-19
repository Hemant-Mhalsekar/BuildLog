import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  NormalizedGitHubEventPayload,
  RepositoryStatus,
  WebhookDeliveryRecord,
} from '../types/models';

export interface ServerRepositoryMapping {
  repositoryId: string;
  githubRepositoryId: string;
  fullName: string;
  status: RepositoryStatus;
}

export interface ServerInstallationMapping {
  installationId: string;
  ownerId: string;
  integrationId: string;
  accountName: string;
  repositories: Record<string, ServerRepositoryMapping>;
  updatedAt: string;
}

export interface ServerUserGitHubSession {
  uid: string;
  githubUserId: string;
  githubLogin: string;
  accessToken: string;
  verifiedInstallationIds: string[];
  updatedAt: string;
}

export interface PendingGitHubAuthState {
  stateToken: string;
  uid: string;
  targetFullName: string;
  pendingInstallationId?: string;
  createdAt: string;
}

export interface PendingWebhookEvent {
  queueId: string;
  ownerId: string;
  repositoryId: string;
  githubRepositoryId: string;
  repositoryFullName: string;
  deliveryId: string;
  payload: NormalizedGitHubEventPayload;
  receivedAt: string;
}

interface PersistedServerState {
  deliveries: WebhookDeliveryRecord[];
  installations: Record<string, ServerInstallationMapping>;
  pendingEvents: PendingWebhookEvent[];
  userOAuth: Record<string, ServerUserGitHubSession>;
  pendingAuthStates: Record<string, PendingGitHubAuthState>;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'server-state.json');
const AUTH_STATE_TTL_MS = 30 * 60 * 1000;

const DEFAULT_STATE: PersistedServerState = {
  deliveries: [],
  installations: {},
  pendingEvents: [],
  userOAuth: {},
  pendingAuthStates: {},
};

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readState(): PersistedServerState {
  ensureDir();
  if (!fs.existsSync(STATE_FILE)) {
    return {
      deliveries: [],
      installations: {},
      pendingEvents: [],
      userOAuth: {},
      pendingAuthStates: {},
    };
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedServerState>;
    return {
      deliveries: Array.isArray(parsed.deliveries) ? parsed.deliveries : [],
      installations:
        parsed.installations && typeof parsed.installations === 'object'
          ? parsed.installations
          : {},
      pendingEvents: Array.isArray(parsed.pendingEvents) ? parsed.pendingEvents : [],
      userOAuth:
        parsed.userOAuth && typeof parsed.userOAuth === 'object' ? parsed.userOAuth : {},
      pendingAuthStates:
        parsed.pendingAuthStates && typeof parsed.pendingAuthStates === 'object'
          ? parsed.pendingAuthStates
          : {},
    };
  } catch (error) {
    console.error('Failed to read server-state.json, resetting clean state:', error);
    return { ...DEFAULT_STATE };
  }
}

function writeState(state: PersistedServerState): void {
  ensureDir();
  const tmpFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, STATE_FILE);
}

function pruneExpiredAuthStates(state: PersistedServerState): void {
  const cutoff = Date.now() - AUTH_STATE_TTL_MS;
  for (const [token, item] of Object.entries(state.pendingAuthStates)) {
    const ts = new Date(item.createdAt).getTime();
    if (Number.isNaN(ts) || ts < cutoff) {
      delete state.pendingAuthStates[token];
    }
  }
}

export function createPendingAuthState(
  uid: string,
  targetFullName: string,
  pendingInstallationId?: string
): string {
  const state = readState();
  pruneExpiredAuthStates(state);
  const stateToken = crypto.randomBytes(24).toString('hex');
  state.pendingAuthStates[stateToken] = {
    stateToken,
    uid,
    targetFullName,
    pendingInstallationId,
    createdAt: new Date().toISOString(),
  };
  writeState(state);
  return stateToken;
}

export function consumePendingAuthState(
  uid: string,
  stateToken: string
): PendingGitHubAuthState | null {
  if (!stateToken) return null;
  const state = readState();
  pruneExpiredAuthStates(state);
  const record = state.pendingAuthStates[stateToken];
  if (!record || record.uid !== uid) {
    writeState(state);
    return null;
  }
  delete state.pendingAuthStates[stateToken];
  writeState(state);
  return record;
}

export function saveUserGitHubSession(session: {
  uid: string;
  githubUserId: string;
  githubLogin: string;
  accessToken: string;
  verifiedInstallationIds: string[];
}): void {
  const state = readState();
  const existingIds = state.userOAuth[session.uid]?.verifiedInstallationIds ?? [];
  const mergedIds = Array.from(
    new Set([...existingIds, ...session.verifiedInstallationIds])
  );
  state.userOAuth[session.uid] = {
    uid: session.uid,
    githubUserId: session.githubUserId,
    githubLogin: session.githubLogin,
    accessToken: session.accessToken,
    verifiedInstallationIds: mergedIds,
    updatedAt: new Date().toISOString(),
  };
  writeState(state);
}

export function replaceUserVerifiedInstallationIds(
  uid: string,
  verifiedInstallationIds: string[]
): void {
  const state = readState();
  const current = state.userOAuth[uid];
  if (!current) return;
  current.verifiedInstallationIds = Array.from(new Set(verifiedInstallationIds));
  current.updatedAt = new Date().toISOString();
  writeState(state);
}

export function getUserGitHubSession(uid: string): ServerUserGitHubSession | null {
  const state = readState();
  return state.userOAuth[uid] ?? null;
}

export function getUserOwnedInstallationIds(uid: string): string[] {
  const state = readState();
  const fromMappings = Object.values(state.installations)
    .filter((inst) => inst.ownerId === uid)
    .map((inst) => inst.installationId);
  const fromOAuth = state.userOAuth[uid]?.verifiedInstallationIds ?? [];
  return Array.from(new Set([...fromMappings, ...fromOAuth]));
}

export function userOwnsInstallationOnServer(uid: string, installationId: string): boolean {
  const state = readState();
  const mapping = state.installations[installationId];
  if (mapping && mapping.ownerId === uid) {
    return true;
  }
  const session = state.userOAuth[uid];
  if (session && session.verifiedInstallationIds.includes(installationId)) {
    return true;
  }
  return false;
}

export function hasWebhookDelivery(deliveryId: string): boolean {
  if (!deliveryId) return false;
  const state = readState();
  return state.deliveries.some((d) => d.deliveryId === deliveryId);
}

export function recordWebhookDelivery(record: WebhookDeliveryRecord): void {
  const state = readState();
  const filtered = state.deliveries.filter((d) => d.deliveryId !== record.deliveryId);
  filtered.unshift(record);
  state.deliveries = filtered.slice(0, 400);
  writeState(state);
}

export function upsertInstallationMapping(mapping: {
  installationId: string;
  ownerId: string;
  integrationId: string;
  accountName: string;
  repositories: ServerRepositoryMapping[];
}): void {
  const state = readState();
  const repoMap: Record<string, ServerRepositoryMapping> = {};
  for (const repo of mapping.repositories) {
    repoMap[repo.githubRepositoryId] = repo;
  }
  state.installations[mapping.installationId] = {
    installationId: mapping.installationId,
    ownerId: mapping.ownerId,
    integrationId: mapping.integrationId,
    accountName: mapping.accountName,
    repositories: repoMap,
    updatedAt: new Date().toISOString(),
  };
  writeState(state);
}

export function resolveWebhookTarget(
  installationId: string,
  githubRepositoryId: string,
  repositoryFullName: string
): { ownerId: string; repositoryId: string; status: RepositoryStatus } | null {
  const state = readState();
  const candidates =
    installationId && state.installations[installationId]
      ? [state.installations[installationId]]
      : Object.values(state.installations);

  for (const inst of candidates) {
    if (githubRepositoryId && inst.repositories[githubRepositoryId]) {
      const repo = inst.repositories[githubRepositoryId];
      return {
        ownerId: inst.ownerId,
        repositoryId: repo.repositoryId,
        status: repo.status,
      };
    }
    const matchedByName = Object.values(inst.repositories).find(
      (r) => r.fullName.toLowerCase() === repositoryFullName.toLowerCase()
    );
    if (matchedByName) {
      return {
        ownerId: inst.ownerId,
        repositoryId: matchedByName.repositoryId,
        status: matchedByName.status,
      };
    }
  }
  return null;
}

export function enqueuePendingWebhookEvents(events: PendingWebhookEvent[]): void {
  if (events.length === 0) return;
  const state = readState();
  const existingKeys = new Set(
    state.pendingEvents.map((e) => `${e.ownerId}:${e.repositoryId}:${e.payload.eventId}`)
  );
  for (const item of events) {
    const key = `${item.ownerId}:${item.repositoryId}:${item.payload.eventId}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      state.pendingEvents.push(item);
    }
  }
  if (state.pendingEvents.length > 1000) {
    state.pendingEvents = state.pendingEvents.slice(-1000);
  }
  writeState(state);
}

export function getPendingEventsAndDeliveriesForUser(ownerId: string): {
  pendingEvents: PendingWebhookEvent[];
  recentDeliveries: WebhookDeliveryRecord[];
} {
  const state = readState();
  const userInstallations = Object.values(state.installations).filter(
    (inst) => inst.ownerId === ownerId
  );
  const instIds = new Set(userInstallations.map((i) => i.installationId));
  const repoNames = new Set(
    userInstallations.flatMap((i) =>
      Object.values(i.repositories).map((r) => r.fullName.toLowerCase())
    )
  );

  const pendingEvents = state.pendingEvents.filter((e) => e.ownerId === ownerId);
  const recentDeliveries = state.deliveries
    .filter(
      (d) =>
        (d.installationId && instIds.has(d.installationId)) ||
        (d.repositoryFullName && repoNames.has(d.repositoryFullName.toLowerCase()))
    )
    .slice(0, 30);

  return { pendingEvents, recentDeliveries };
}

export function acknowledgePendingEvents(ownerId: string, queueIds: string[]): number {
  if (queueIds.length === 0) return 0;
  const ackSet = new Set(queueIds);
  const state = readState();
  const before = state.pendingEvents.length;
  state.pendingEvents = state.pendingEvents.filter(
    (item) => !(item.ownerId === ownerId && ackSet.has(item.queueId))
  );
  writeState(state);
  return before - state.pendingEvents.length;
}

export function removeInstallationMapping(ownerId: string, installationId: string): void {
  const state = readState();
  const existing = state.installations[installationId];
  if (existing && existing.ownerId === ownerId) {
    const repoIds = new Set(Object.values(existing.repositories).map((r) => r.repositoryId));
    delete state.installations[installationId];
    state.pendingEvents = state.pendingEvents.filter(
      (ev) => !(ev.ownerId === ownerId && repoIds.has(ev.repositoryId))
    );
    writeState(state);
  }
}

export function purgeOwnerServerState(ownerId: string): void {
  const state = readState();
  const userInstIds = new Set(
    Object.values(state.installations)
      .filter((inst) => inst.ownerId === ownerId)
      .map((inst) => inst.installationId)
  );
  for (const id of userInstIds) {
    delete state.installations[id];
  }
  delete state.userOAuth[ownerId];
  for (const [token, item] of Object.entries(state.pendingAuthStates)) {
    if (item.uid === ownerId) {
      delete state.pendingAuthStates[token];
    }
  }
  state.pendingEvents = state.pendingEvents.filter((ev) => ev.ownerId !== ownerId);
  state.deliveries = state.deliveries.filter((d) => !userInstIds.has(d.installationId));
  writeState(state);
}
