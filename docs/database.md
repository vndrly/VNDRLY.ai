# Database — Supabase Postgres

VNDRLY uses **one** Postgres database, hosted on **Supabase**.

| Environment | Where the connection lives | Same database? |
|---|---|---|
| **Your Desktop** (Cursor edits) | Repo root `.env.local` → `DATABASE_URL` | Yes — Supabase |
| **Production** (vndrly.ai on GoDaddy VPS) | `/var/www/vndrly/.env.production` (written by `scripts/godaddy-deploy.mjs`) | Yes — same Supabase URL |
| **Schema / SQL from Cursor** | Supabase MCP plugin, project `bihjmgbdzbhcnsuhzzwo` | Yes — Supabase |

Production `.env.production` is assembled on deploy from repo `.env.local` plus Supabase credentials. Outbound email is not enabled yet; password-reset and notification email require a future paid-tier provider.

## Connection strings

**Production / direct (VPS, Linux, macOS with IPv6):**

```
postgresql://postgres:[PASSWORD]@db.bihjmgbdzbhcnsuhzzwo.supabase.co:5432/postgres
```

**Windows desktop dev (transaction pooler — use this in `.env.local`):**

```
postgresql://postgres.bihjmgbdzbhcnsuhzzwo:[PASSWORD]@aws-1-us-west-2.pooler.supabase.com:6543/postgres
```

- **Project ref:** `bihjmgbdzbhcnsuhzzwo`
- **Region:** us-west-2
- **Dashboard:** https://supabase.com/dashboard/project/bihjmgbdzbhcnsuhzzwo/settings/database
- **Password:** stored locally in `C:\Users\JohnElerick\DEV\API Keys and Secrets\Supabase.env` (not committed to git)

## Web app vs iOS app

| App | How it reaches data |
|---|---|
| **Web** (`artifacts/vndrly`) | Browser → Vite dev server → **api-server** → Supabase via `DATABASE_URL` |
| **API** (`artifacts/api-server`) | Express → `@workspace/db` → Supabase via `DATABASE_URL` |
| **iOS** (`artifacts/vndrly-mobile`) | Expo app → **`EXPO_PUBLIC_DOMAIN`** (default `https://vndrly.ai`) → api-server → Supabase |

The mobile app never connects to Supabase Postgres directly. Production iOS builds use `EXPO_PUBLIC_DOMAIN=https://vndrly.ai` (see `artifacts/vndrly-mobile/eas.json`).

## Local setup

1. Copy `.env.example` → `.env.local`
2. Paste your Supabase password into `DATABASE_URL`
3. On Windows, use the **pooler** URL (`aws-1-us-west-2`, port `6543`) — see `.env.example`
4. Local tools auto-load `.env.local` via `scripts/load-env-local.mjs` when vars are not already set

If your shell already has a stale `DATABASE_URL`, set `VNDRLY_LOAD_ENV_LOCAL=1` so `.env.local` wins:

```powershell
$env:VNDRLY_LOAD_ENV_LOCAL='1'
pnpm --filter @workspace/db run check-schema
```

The `dev:local` scripts set this automatically.

### Local dev commands (Windows desktop)

From repo root, in separate terminals:

```powershell
pnpm --filter @workspace/api-server run dev:local
pnpm --filter @workspace/vndrly run dev:local
pnpm --filter @workspace/vndrly-mobile run dev:local
```

- **API** listens on `http://localhost:8080` (from `.env.local` `PORT`)
- **Web** runs Vite with `BASE_PATH=/` and proxies `/api` to the local API when `VITE_API_PROXY_TARGET` is set
- **Mobile** uses `EXPO_PUBLIC_DOMAIN` from `.env.local` (defaults to production `https://vndrly.ai`)

To point the iOS simulator at your local API instead of production, set in `.env.local`:

```
EXPO_PUBLIC_DOMAIN=http://localhost:8080
```

## Schema changes

- **Source of truth for table definitions:** `lib/db/src/schema/`
- **Apply to Supabase:** `pnpm --filter @workspace/db run push` (uses `DATABASE_URL` from `.env.local`)
- **Verify drift:** `pnpm --filter @workspace/db run check-schema`
- **From Cursor without direct TCP:** Supabase MCP `apply_migration` (see `scripts/supabase-apply-migration.mjs`)

Never run destructive resets against Supabase without explicit approval (`AGENTS.md` hard rule).

## One-time data migration (historical)

Neon → Supabase migration is **done** (May 2026). For reference, the export script was `lib/db/scripts/export-neon-data.mjs`.

## Tests

`pnpm --filter @workspace/api-server test` uses an isolated `*_test` database derived from `DATABASE_URL`. It does not touch production Supabase data during normal test runs.
