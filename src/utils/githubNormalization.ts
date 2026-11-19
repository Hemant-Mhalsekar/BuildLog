import crypto from 'node:crypto';
import type { GitHubEventType, NormalizedGitHubEventPayload } from '../types/models';

export function verifyGitHubWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!secret || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
      .digest('hex');

  const sigBuf = Buffer.from(signatureHeader, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export interface ParsedWebhookEnvelope {
  supported: boolean;
  eventType?: GitHubEventType;
  installationId: string;
  githubRepositoryId: string;
  repositoryFullName: string;
  events: NormalizedGitHubEventPayload[];
}

function asString(val: unknown, maxLen = 500): string {
  return typeof val === 'string' ? val.trim().slice(0, maxLen) : '';
}

function asStringArray(val: unknown, maxItems = 100): string[] {
  if (!Array.isArray(val)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of val) {
    if (typeof item === 'string' && item.trim()) {
      const cleaned = item.trim().slice(0, 300);
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        out.push(cleaned);
      }
      if (out.length >= maxItems) break;
    }
  }
  return out;
}

export function normalizeGitHubWebhookPayload(
  rawEventType: string,
  deliveryId: string,
  payload: Record<string, unknown>
): ParsedWebhookEnvelope {
  const repoObj = (payload.repository ?? {}) as Record<string, unknown>;
  const installationObj = (payload.installation ?? {}) as Record<string, unknown>;

  const installationId = installationObj.id ? String(installationObj.id) : '';
  const githubRepositoryId = repoObj.id ? String(repoObj.id) : '';
  const repositoryFullName = asString(repoObj.full_name, 200);
  const defaultBranch = asString(repoObj.default_branch, 120) || 'main';
  const repoUrl = asString(repoObj.html_url, 500);

  if (rawEventType === 'push') {
    const ref = asString(payload.ref, 200);
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref || defaultBranch;
    const commits = Array.isArray(payload.commits) ? (payload.commits as Array<Record<string, unknown>>) : [];
    const pusher = (payload.pusher ?? {}) as Record<string, unknown>;
    const headCommit = (payload.head_commit ?? {}) as Record<string, unknown>;
    const compareUrl = asString(payload.compare, 500) || repoUrl;

    if (commits.length === 0) {
      const headSha = asString(payload.after, 80) || asString(headCommit.id, 80);
      if (!headSha || /^0+$/.test(headSha)) {
        return {
          supported: true,
          eventType: 'push',
          installationId,
          githubRepositoryId,
          repositoryFullName,
          events: [],
        };
      }
      const message = asString(headCommit.message, 2000);
      const firstLine = message.split('\n')[0] || `Push to ${branch}`;
      return {
        supported: true,
        eventType: 'push',
        installationId,
        githubRepositoryId,
        repositoryFullName,
        events: [
          {
            eventId: `${deliveryId}:push:${headSha.slice(0, 12)}`,
            eventType: 'push',
            branch,
            commitSha: headSha,
            title: firstLine.slice(0, 300),
            description: message,
            sourceUrl: asString(headCommit.url, 500) || compareUrl,
            changedFiles: asStringArray([
              ...(Array.isArray(headCommit.added) ? headCommit.added : []),
              ...(Array.isArray(headCommit.modified) ? headCommit.modified : []),
              ...(Array.isArray(headCommit.removed) ? headCommit.removed : []),
            ]),
            occurredAt: asString(headCommit.timestamp, 60) || new Date().toISOString(),
            author: asString(pusher.name, 120) || 'unknown',
          },
        ],
      };
    }

    const events: NormalizedGitHubEventPayload[] = commits.slice(0, 20).map((commit, idx) => {
      const sha = asString(commit.id, 80) || `${deliveryId}-${idx}`;
      const message = asString(commit.message, 2000);
      const firstLine = message.split('\n')[0] || `Commit ${sha.slice(0, 7)}`;
      const commitAuthor = (commit.author ?? {}) as Record<string, unknown>;
      const changedFiles = asStringArray([
        ...(Array.isArray(commit.added) ? commit.added : []),
        ...(Array.isArray(commit.modified) ? commit.modified : []),
        ...(Array.isArray(commit.removed) ? commit.removed : []),
      ]);

      return {
        eventId: `push:${sha}`,
        eventType: 'push',
        branch,
        commitSha: sha,
        title: firstLine.slice(0, 300),
        description: message,
        sourceUrl: asString(commit.url, 500) || compareUrl,
        changedFiles,
        occurredAt: asString(commit.timestamp, 60) || new Date().toISOString(),
        author: asString(commitAuthor.username || commitAuthor.name || pusher.name, 120) || 'unknown',
      };
    });

    return {
      supported: true,
      eventType: 'push',
      installationId,
      githubRepositoryId,
      repositoryFullName,
      events,
    };
  }

  if (rawEventType === 'pull_request') {
    const action = asString(payload.action, 40) || 'updated';
    const pr = (payload.pull_request ?? {}) as Record<string, unknown>;
    const head = (pr.head ?? {}) as Record<string, unknown>;
    const user = (pr.user ?? {}) as Record<string, unknown>;
    const number = typeof pr.number === 'number' ? pr.number : Number(payload.number || 0) || null;
    const state = pr.merged ? 'merged' : asString(pr.state, 40) || 'open';
    const prTitle = asString(pr.title, 260) || `Pull request #${number ?? ''}`;

    return {
      supported: true,
      eventType: 'pull_request',
      installationId,
      githubRepositoryId,
      repositoryFullName,
      events: [
        {
          eventId: `pr:${githubRepositoryId}:${number ?? deliveryId}:${action}:${deliveryId}`,
          eventType: 'pull_request',
          branch: asString(head.ref, 200) || defaultBranch,
          commitSha: asString(head.sha, 80),
          title: `[PR #${number ?? '?'} ${action}] ${prTitle}`.slice(0, 300),
          description: asString(pr.body, 4000),
          sourceUrl: asString(pr.html_url, 500) || repoUrl,
          changedFiles: [],
          occurredAt: asString(pr.updated_at || pr.created_at, 60) || new Date().toISOString(),
          author: asString(user.login, 120) || 'unknown',
          prNumber: number,
          prState: state,
        },
      ],
    };
  }

  if (rawEventType === 'issues') {
    const action = asString(payload.action, 40) || 'updated';
    const issue = (payload.issue ?? {}) as Record<string, unknown>;
    const user = (issue.user ?? {}) as Record<string, unknown>;
    const number = typeof issue.number === 'number' ? issue.number : null;
    const state = asString(issue.state, 40) || 'open';
    const issueTitle = asString(issue.title, 260) || `Issue #${number ?? ''}`;

    return {
      supported: true,
      eventType: 'issues',
      installationId,
      githubRepositoryId,
      repositoryFullName,
      events: [
        {
          eventId: `issue:${githubRepositoryId}:${number ?? deliveryId}:${action}:${deliveryId}`,
          eventType: 'issues',
          branch: defaultBranch,
          commitSha: '',
          title: `[Issue #${number ?? '?'} ${action}] ${issueTitle}`.slice(0, 300),
          description: asString(issue.body, 4000),
          sourceUrl: asString(issue.html_url, 500) || repoUrl,
          changedFiles: [],
          occurredAt: asString(issue.updated_at || issue.created_at, 60) || new Date().toISOString(),
          author: asString(user.login, 120) || 'unknown',
          issueNumber: number,
          issueState: state,
        },
      ],
    };
  }

  return {
    supported: false,
    installationId,
    githubRepositoryId,
    repositoryFullName,
    events: [],
  };
}
