# BuildLog

**Your development history, on autopilot.** BuildLog connects to your GitHub repositories, records pushes, pull requests and issues as they happen, summarises the activity with Gemini, and keeps a per-repository **Project Memory**: what the project is, what changed recently, open work, technical decisions and suggested next steps.

Live: https://buildlog-manage.netlify.app

---

## Features

- **GitHub App integration** – connect any repository you can install apps on; recent history is imported immediately.
- **Webhook ingestion** – push, pull request and issue events arrive in real time, verified with HMAC-SHA256 and de-duplicated with delivery leases.
- **AI summaries** – server-side Gemini summarisation of activity (optional; raw activity is still recorded without it).
- **Project Memory** – deterministic per-repo memory built from history, plus a Markdown "resume" export.
- **Dashboard & timeline** – activity metrics, clustered timeline, repository detail pages.
- **Privacy controls** – per-user data isolation enforced by Firestore security rules, JSON export and full account data deletion.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, React Router 7, Motion |
| Backend | Express (TypeScript), run as a Netlify Function |
| Auth & data | Firebase Authentication (email/password, Google), Cloud Firestore |
| Server state | Netlify Blobs (webhook queue, delivery leases, GitHub sessions) – local JSON file in development |
| AI | Google Gemini via `@google/genai` |
| Hosting | Netlify |

## How it works

```
GitHub ──webhook──▶ /api/webhooks/github ──verify HMAC──▶ lease + queue (Netlify Blobs)
                                                               │
Browser (signed in) ◀── poll /api/ingestion/pending ◀─────────┘
   │  writes events to Firestore, acks queue
   └─▶ /api/summarize (Gemini) ──▶ activity summaries + Project Memory in Firestore
```

1. The user pastes a repository URL; the server checks authorisation and, if needed, sends them through the GitHub App install + OAuth flow.
2. Recent commits, PRs and issues are imported and saved to Firestore.
3. New GitHub webhooks are verified, de-duplicated and queued server-side.
4. While the app is open, the browser pulls queued events into Firestore and requests summaries.

> **Note:** step 4 runs in the browser, so new webhook events are only moved into your timeline while a BuildLog tab is open. They wait safely in the queue until then.

## Project structure

```
├── server.ts                    # Local dev/production server (Express + Vite middleware)
├── netlify.toml                 # Netlify build & function config
├── netlify/
│   ├── functions/api.mjs        # Netlify Function entry (routes /api/*)
│   └── server/handler.ts        # Request ↔ Express adapter (bundled at build time)
├── firestore.rules              # Firestore security rules (deploy manually – see below)
├── security_spec.md             # Security invariants the rules enforce
├── firebase-applet-config.json  # Firebase web config (public by design)
└── src/
    ├── server/                  # Express app, GitHub App client, webhook store, Gemini, auth
    ├── pages/                   # Landing, Auth, Dashboard, Projects, Timeline, Integrations, …
    ├── components/              # UI, layout, integrations
    ├── contexts/                # Auth, workspace, toast state
    ├── services/                # Firestore, API client, auth helpers
    └── utils/                   # Normalisation, clustering, memory builder, validation, export
```

## Getting started (local development)

### Prerequisites

- Node.js 20+ (22 recommended)
- A Firebase project with **Authentication** (Email/Password + Google) and **Firestore** enabled
- A GitHub App (see [GitHub App setup](#github-app-setup))
- Optional: a Gemini API key from [Google AI Studio](https://aistudio.google.com)

### Install and run

```bash
git clone https://github.com/snehashisroy-cognicorpus/BuildLog.git
cd BuildLog
npm install            # .npmrc enables legacy-peer-deps
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:3000
```

Check configuration at `http://localhost:3000/api/health`: `missingEnvVars` should be empty.

GitHub can't deliver webhooks to `localhost`. To test webhooks locally, expose the server with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) and use that URL as `APP_URL` and in the GitHub App settings.

### Using your own Firebase project

Replace the values in `firebase-applet-config.json` with your Firebase web app config (set `firestoreDatabaseId` to `(default)` or your database name), add your domains under **Authentication → Settings → Authorized domains**, and publish `firestore.rules`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | Yes | Public URL of the app, e.g. `https://buildlog-manage.netlify.app` (no trailing slash) |
| `GITHUB_APP_ID` | Yes | Numeric GitHub App ID |
| `GITHUB_APP_SLUG` | Yes | App slug from `github.com/apps/<slug>` |
| `GITHUB_APP_CLIENT_ID` | Yes | GitHub App Client ID |
| `GITHUB_APP_CLIENT_SECRET` | Yes (secret) | GitHub App client secret |
| `GITHUB_APP_PRIVATE_KEY` | Yes (secret) | Full contents of the App's `.pem` private key (multi-line, `\n`-escaped or base64 are all accepted) |
| `GITHUB_WEBHOOK_SECRET` | Yes (secret) | Webhook secret configured on the GitHub App |
| `GEMINI_API_KEY` | No (secret) | Enables AI summaries |
| `FIREBASE_PROJECT_ID` | Netlify | Firebase project ID used to verify ID tokens server-side |
| `BUILDLOG_CONTEXT` | Netlify | Set to `production` on the production deploy context |

Never commit real secrets. `.env*` files (except `.env.example`) are git-ignored.

## GitHub App setup

Create an app at **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**:

| Setting | Value |
|---|---|
| Homepage URL | `APP_URL` |
| Callback URL | `APP_URL/integrations` |
| Setup URL | `APP_URL/integrations` (tick *Redirect on update*) |
| Request user authorization during installation | **Off** (BuildLog runs OAuth itself) |
| Webhook URL | `APP_URL/api/webhooks/github` (active, with a secret) |
| Repository permissions | Read-only: **Contents, Metadata, Pull requests, Issues** |
| Subscribe to events | **Push, Pull request, Issues** |
| Where can it be installed | *Any account* if others will connect their own repos |

Then copy the App ID, slug, Client ID, a new client secret and a generated private key into your environment variables.

## Deploying to Netlify

1. **Import the repo** in Netlify (*Add new site → Import an existing project → GitHub*). Build settings come from `netlify.toml`:
   - Build command: `npm run build && npm run build:functions`
   - Publish directory: `dist`
   - Functions: `netlify/functions`
2. **Add environment variables** (see table above) under *Site configuration → Environment variables*. Put production values in the **Live app** context.
3. **Trigger a deploy.** New environment variables only take effect after a redeploy.
4. **Firebase:** add your Netlify domain to *Authentication → Settings → Authorized domains*.
5. **Verify:** `https://<your-site>/api/health` should report `configured: true` with no missing variables.

### Why the function is pre-bundled

`npm run build:functions` uses esbuild to bundle `netlify/server/handler.ts` and all its dependencies into `netlify/.build/server.mjs`, which `netlify/functions/api.mjs` re-exports. This is required because:

- Netlify Blobs strong-consistency reads (used for webhook leases and auth state) only work in **v2** functions, and
- v2 functions are shipped with raw `node_modules`, where ESM-only dependencies (e.g. `jose`, via `firebase-admin`) fail to load on Netlify's Node 18 function runtime.

`SECRETS_SCAN_OMIT_KEYS` in `netlify.toml` lists environment variables whose values are public identifiers (e.g. the Firebase project ID) so Netlify's secrets scanner doesn't flag them; real secrets are still scanned.

## Firestore security rules

Rules live in `firestore.rules` and are **not deployed by Netlify**. After changing them, publish them in the Firebase console (*Firestore → select the app's database → Rules → Publish*) or with the Firebase CLI. The rules enforce:

- authentication on every read/write, with strict per-user ownership (`ownerId == request.auth.uid`)
- immutable ownership fields, allow-listed fields and bounded sizes
- referential checks (repositories must belong to your integration, events to your repository)

See `security_spec.md` for the full list of invariants.

> The Firebase **web API key** in `firebase-applet-config.json` is public by design (it ships in the browser bundle). Protect it with Firestore rules and by restricting the key to your domains and Firebase APIs in Google Cloud Console.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Express + Vite dev server on port 3000 |
| `npm run build` | Build the frontend into `dist/` |
| `npm run build:functions` | Bundle the Netlify API function into `netlify/.build/` |
| `npm start` | Run the production server locally (after `npm run build`) |
| `npm run lint` | Type-check with `tsc --noEmit` |

### Tests

Tests use Node's built-in test runner:

```bash
npx tsx --test src/utils/logic.test.ts src/server/app.test.ts src/server/webhookStore.integration.test.ts
```

## Known limitations

- Ingestion of queued webhook events into Firestore happens in the browser, so a BuildLog tab must be open.
- Netlify synchronous functions time out after 10 seconds; very large summaries may not complete (raw activity is still saved).
- The Gemini rate limit is kept in memory per function instance.
- GitHub user access tokens are stored in Netlify Blobs without additional encryption.

## Contributing

Work happens on a feature branch and is merged into `main` through pull requests; Netlify deploys `main` automatically.
