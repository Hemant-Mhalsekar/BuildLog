import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { requireFirebaseAuth, type AuthenticatedRequest } from './src/server/firebaseAuth';
import {
  acknowledgePendingEvents,
  consumePendingAuthState,
  createPendingAuthState,
  enqueuePendingWebhookEvents,
  getPendingEventsAndDeliveriesForUser,
  getUserGitHubSession,
  hasWebhookDelivery,
  purgeOwnerServerState,
  recordWebhookDelivery,
  removeInstallationMapping,
  replaceUserVerifiedInstallationIds,
  resolveWebhookTarget,
  saveUserGitHubSession,
  upsertInstallationMapping,
  userOwnsInstallationOnServer,
  type ServerRepositoryMapping,
} from './src/server/webhookStore';
import {
  buildGitHubAppInstallUrl,
  buildGitHubOAuthAuthorizeUrl,
  exchangeGitHubOAuthCode,
  fetchAuthorizedGitHubUserAndInstallations,
  fetchRepositoryRecentHistory,
  getGitHubAppConfigStatus,
  verifyInstallationContainsRepository,
} from './src/server/githubApp';
import {
  summarizeRepositoryActivity,
  type SummarizerEventInput,
} from './src/server/geminiSummarizer';
import {
  normalizeGitHubWebhookPayload,
  verifyGitHubWebhookSignature,
} from './src/utils/githubNormalization';
import { parseGitHubRepositoryUrl } from './src/utils/githubUrl';

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

async function startServer(): Promise<void> {
  const app = express();

  // 1. GitHub Webhook Endpoint MUST read raw body BEFORE express.json() for HMAC-SHA256 verification
  app.post(
    '/api/webhooks/github',
    express.raw({ type: 'application/json', limit: '2mb' }),
    (req: Request, res: Response) => {
      const webhookSecret = (process.env.GITHUB_WEBHOOK_SECRET ?? '').trim();
      const signature = req.header('x-hub-signature-256');
      const deliveryId = req.header('x-github-delivery') || '';
      const eventType = req.header('x-github-event') || '';

      if (!webhookSecret) {
        res.status(503).json({
          error: 'GITHUB_WEBHOOK_SECRET is not configured on the server.',
        });
        return;
      }

      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

      if (!verifyGitHubWebhookSignature(rawBody, signature, webhookSecret)) {
        res.status(401).json({ error: 'Invalid GitHub webhook signature.' });
        return;
      }

      if (deliveryId && hasWebhookDelivery(deliveryId)) {
        res.status(200).json({ ok: true, status: 'duplicate_ignored', deliveryId });
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      } catch {
        res.status(400).json({ error: 'Malformed JSON webhook payload.' });
        return;
      }

      if (eventType === 'ping') {
        recordWebhookDelivery({
          deliveryId: deliveryId || `ping-${Date.now()}`,
          eventType: 'ping',
          repositoryFullName: String((payload.repository as { full_name?: string })?.full_name ?? ''),
          installationId: String((payload.installation as { id?: number })?.id ?? ''),
          receivedAt: new Date().toISOString(),
          processingStatus: 'recorded_without_summary',
          eventCount: 0,
        });
        res.status(200).json({ ok: true, status: 'pong' });
        return;
      }

      const normalized = normalizeGitHubWebhookPayload(
        eventType,
        deliveryId || crypto.randomUUID(),
        payload
      );

      if (!normalized.supported) {
        res.status(202).json({
          ok: true,
          status: 'ignored_unsupported_event',
          eventType,
        });
        return;
      }

      const target = resolveWebhookTarget(
        normalized.installationId,
        normalized.githubRepositoryId,
        normalized.repositoryFullName
      );

      if (!target) {
        recordWebhookDelivery({
          deliveryId: deliveryId || crypto.randomUUID(),
          eventType,
          repositoryFullName: normalized.repositoryFullName,
          installationId: normalized.installationId,
          receivedAt: new Date().toISOString(),
          processingStatus: 'unmapped_repository',
          eventCount: normalized.events.length,
          errorMessage: 'Repository is not linked to an active BuildLog workspace.',
        });
        res.status(202).json({
          ok: true,
          status: 'unmapped_repository',
          repository: normalized.repositoryFullName,
        });
        return;
      }

      if (target.status !== 'active') {
        recordWebhookDelivery({
          deliveryId: deliveryId || crypto.randomUUID(),
          eventType,
          repositoryFullName: normalized.repositoryFullName,
          installationId: normalized.installationId,
          receivedAt: new Date().toISOString(),
          processingStatus: 'duplicate_ignored',
          eventCount: 0,
          errorMessage: `Repository tracking status is ${target.status}.`,
        });
        res.status(200).json({
          ok: true,
          status: 'repository_not_active',
        });
        return;
      }

      const nowIso = new Date().toISOString();
      enqueuePendingWebhookEvents(
        normalized.events.map((ev) => ({
          queueId: `${deliveryId || crypto.randomUUID()}:${ev.eventId}`,
          ownerId: target.ownerId,
          repositoryId: target.repositoryId,
          githubRepositoryId: normalized.githubRepositoryId,
          repositoryFullName: normalized.repositoryFullName,
          deliveryId: deliveryId || 'manual',
          payload: ev,
          receivedAt: nowIso,
        }))
      );

      recordWebhookDelivery({
        deliveryId: deliveryId || crypto.randomUUID(),
        eventType,
        repositoryFullName: normalized.repositoryFullName,
        installationId: normalized.installationId,
        receivedAt: nowIso,
        processingStatus: 'pending',
        eventCount: normalized.events.length,
      });

      res.status(202).json({
        ok: true,
        status: 'queued',
        eventCount: normalized.events.length,
      });
    }
  );

  // 2. Standard JSON middleware for all authenticated API routes
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      github: getGitHubAppConfigStatus(),
    });
  });

  app.get(
    '/api/github/status',
    requireFirebaseAuth,
    (_req: AuthenticatedRequest, res: Response) => {
      res.json(getGitHubAppConfigStatus());
    }
  );

  app.post(
    '/api/github/repositories/prepare-connect',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const repositoryUrl = String(req.body?.repositoryUrl ?? '');
      const parsed = parseGitHubRepositoryUrl(repositoryUrl);

      if (!parsed.valid) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const config = getGitHubAppConfigStatus();
      if (!config.configured || !config.oauthConfigured || !config.webhookConfigured) {
        res.status(503).json({
          error:
            'GitHub repository connection is not configured on this server yet. Expand Advanced Diagnostics for details.',
          missingEnvVars: config.missingEnvVars,
        });
        return;
      }

      try {
        // Check ONLY installations verified for the currently authorized GitHub user of this BuildLog account
        const session = getUserGitHubSession(uid);
        if (session?.accessToken) {
          try {
            const liveUser = await fetchAuthorizedGitHubUserAndInstallations(session.accessToken);
            replaceUserVerifiedInstallationIds(uid, liveUser.installationIds);

            for (const instId of liveUser.installationIds) {
              const check = await verifyInstallationContainsRepository(
                instId,
                parsed.fullName
              ).catch(() => null);

              if (check && check.found) {
                res.json({
                  status: 'authorized',
                  fullName: check.repository.fullName,
                  installationId: check.installationId,
                  accountName: check.accountName,
                  repository: check.repository,
                  alreadyAuthorized: true,
                });
                return;
              }
            }
          } catch {
            // Stored user token expired or revoked; fall through to fresh GitHub authorization
          }
        }

        const stateToken = createPendingAuthState(uid, parsed.fullName);
        const authorizeUrl = buildGitHubAppInstallUrl(stateToken);
        res.json({
          status: 'authorization_required',
          fullName: parsed.fullName,
          authorizeUrl,
        });
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to check GitHub repository authorization.',
        });
      }
    }
  );

  app.post(
    '/api/github/repositories/complete-authorization',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const stateToken = String(req.body?.state ?? '').trim();
      const code = String(req.body?.code ?? '').trim();
      const rawInstallationId = String(req.body?.installationId ?? '').trim();
      const redirectUri = String(req.body?.redirectUri ?? '').trim();

      const pending = consumePendingAuthState(uid, stateToken);
      if (!pending) {
        res.status(400).json({
          error:
            'GitHub authorization session expired or did not match your account. Paste the repository URL and try again.',
        });
        return;
      }

      const targetInstallationId = rawInstallationId || pending.pendingInstallationId || '';
      if (targetInstallationId && !/^[a-zA-Z0-9_-]{1,64}$/.test(targetInstallationId)) {
        res.status(400).json({ error: 'Invalid GitHub installation parameter returned.' });
        return;
      }

      const config = getGitHubAppConfigStatus();
      if (!config.configured || !config.oauthConfigured) {
        res.status(503).json({
          error: 'GitHub App authorization credentials are not configured on this server.',
          missingEnvVars: config.missingEnvVars,
        });
        return;
      }

      try {
        let verifiedUser: {
          githubUserId: string;
          githubLogin: string;
          installationIds: string[];
        } | null = null;

        if (code) {
          const accessToken = await exchangeGitHubOAuthCode(code, redirectUri || undefined);
          verifiedUser = await fetchAuthorizedGitHubUserAndInstallations(accessToken);
          saveUserGitHubSession({
            uid,
            githubUserId: verifiedUser.githubUserId,
            githubLogin: verifiedUser.githubLogin,
            accessToken,
            verifiedInstallationIds: verifiedUser.installationIds,
          });
        } else {
          const existingSession = getUserGitHubSession(uid);
          if (existingSession?.accessToken) {
            try {
              verifiedUser = await fetchAuthorizedGitHubUserAndInstallations(
                existingSession.accessToken
              );
              replaceUserVerifiedInstallationIds(uid, verifiedUser.installationIds);
            } catch {
              verifiedUser = null;
            }
          }
        }

        // If we do not yet have a verified GitHub user identity, request OAuth identity verification
        if (!verifiedUser) {
          const nextState = createPendingAuthState(
            uid,
            pending.targetFullName,
            targetInstallationId || undefined
          );
          const fallbackRedirect =
            redirectUri ||
            (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/integrations` : '');
          res.json({
            status: 'oauth_verification_required',
            fullName: pending.targetFullName,
            authorizeUrl: buildGitHubOAuthAuthorizeUrl(nextState, fallbackRedirect),
          });
          return;
        }

        if (targetInstallationId) {
          if (!verifiedUser.installationIds.includes(targetInstallationId)) {
            res.status(403).json({
              error: `That GitHub installation does not belong to your authorized GitHub account (@${verifiedUser.githubLogin}).`,
            });
            return;
          }

          const check = await verifyInstallationContainsRepository(
            targetInstallationId,
            pending.targetFullName
          );

          if (!check.found) {
            res.status(403).json({
              error: `Authorized as @${verifiedUser.githubLogin} on ${check.accountName}, but "${pending.targetFullName}" was not granted access. Click Continue with GitHub and select that repository.`,
            });
            return;
          }

          res.json({
            status: 'authorized',
            fullName: check.repository.fullName,
            installationId: check.installationId,
            accountName: check.accountName,
            githubLogin: verifiedUser.githubLogin,
            repository: check.repository,
          });
          return;
        }

        for (const instId of verifiedUser.installationIds) {
          const check = await verifyInstallationContainsRepository(
            instId,
            pending.targetFullName
          ).catch(() => null);
          if (check && check.found) {
            res.json({
              status: 'authorized',
              fullName: check.repository.fullName,
              installationId: check.installationId,
              accountName: check.accountName,
              githubLogin: verifiedUser.githubLogin,
              repository: check.repository,
            });
            return;
          }
        }

        res.status(403).json({
          error: `@${verifiedUser.githubLogin} does not have BuildLog installed with access to "${pending.targetFullName}". Click Continue with GitHub and select that repository.`,
        });
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to verify GitHub authorization on the server.',
        });
      }
    }
  );

  app.post(
    '/api/github/installations/sync-mapping',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const installationId = String(req.body?.installationId ?? '').trim();
      const integrationId = String(req.body?.integrationId ?? '').trim();
      const accountName = String(req.body?.accountName ?? '').trim() || 'github';
      const repositories = Array.isArray(req.body?.repositories)
        ? (req.body.repositories as ServerRepositoryMapping[])
        : [];

      if (!installationId || !integrationId) {
        res.status(400).json({ error: 'installationId and integrationId are required.' });
        return;
      }

      if (!userOwnsInstallationOnServer(uid, installationId)) {
        res.status(403).json({
          error: 'You are not authorized to register webhooks for this GitHub installation.',
        });
        return;
      }

      upsertInstallationMapping({
        installationId,
        ownerId: uid,
        integrationId,
        accountName,
        repositories,
      });

      res.json({ ok: true });
    }
  );

  app.post(
    '/api/github/repositories/import',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const installationId = String(req.body?.installationId ?? '').trim();
      const fullName = String(req.body?.fullName ?? '').trim();
      const defaultBranch = String(req.body?.defaultBranch ?? 'main').trim() || 'main';

      if (!installationId || !fullName) {
        res.status(400).json({ error: 'installationId and fullName are required.' });
        return;
      }

      if (!userOwnsInstallationOnServer(uid, installationId)) {
        res.status(403).json({
          error: 'You are not authorized to import activity from this GitHub installation.',
        });
        return;
      }

      const config = getGitHubAppConfigStatus();
      if (!config.configured) {
        res.status(503).json({
          error: 'GitHub App credentials are missing on the server.',
        });
        return;
      }

      try {
        const events = await fetchRepositoryRecentHistory(
          installationId,
          fullName,
          defaultBranch
        );
        res.json({ events });
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to fetch recent repository history from GitHub.',
        });
      }
    }
  );

  app.delete(
    '/api/github/installations/:installationId',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const installationId = String(req.params.installationId ?? '').trim();
      if (installationId) {
        removeInstallationMapping(uid, installationId);
      }
      res.json({ ok: true });
    }
  );

  app.get(
    '/api/ingestion/pending',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const result = getPendingEventsAndDeliveriesForUser(uid);
      res.json(result);
    }
  );

  app.post(
    '/api/ingestion/ack',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const queueIds = Array.isArray(req.body?.queueIds)
        ? req.body.queueIds.map(String)
        : [];
      const acknowledged = acknowledgePendingEvents(uid, queueIds);
      res.json({ ok: true, acknowledged });
    }
  );

  app.post(
    '/api/summarize',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const repositoryFullName = String(req.body?.repositoryFullName ?? '').trim();
      const events = Array.isArray(req.body?.events)
        ? (req.body.events as SummarizerEventInput[])
        : [];

      if (!repositoryFullName || events.length === 0) {
        res.status(400).json({ error: 'repositoryFullName and events array are required.' });
        return;
      }

      const result = await summarizeRepositoryActivity(uid, repositoryFullName, events);
      res.json(result);
    }
  );

  app.delete(
    '/api/account/data',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      purgeOwnerServerState(uid);
      res.json({ ok: true });
    }
  );

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // 3. Vite dev middleware or production static assets
  if (!IS_PRODUCTION) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BuildLog server running on http://0.0.0.0:${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
  });
}

void startServer();
