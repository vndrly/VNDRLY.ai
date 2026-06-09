# Database — Supabase Postgres

VNDRLY uses **one** Postgres database, hosted on **Supabase**. There is no separate “local database” and no Replit-hosted Postgres anymore.

| Environment | Where the connection lives | Same database? |
|---|---|---|
| **Your Desktop** (Cursor edits) | Repo root `.env.local` → `DATABASE_URL` | Yes — Supabase |
| **Production** (vndrly.ai on GoDaddy VPS) | `/var/www/vndrly/.env.production` (written by `scripts/godaddy-deploy.mjs`) | Yes — same Supabase URL |

Production `.env.production` is assembled on deploy from repo `.env.local` plus Supabase credentials. Include `SENDGRID_API_KEY` and optional `SENDGRID_FROM_EMAIL` in `.env.local` so password-reset and notification email work on the VPS (Replit SendGrid connector is not available there).
| **Schema / SQL from Cursor** | Supabase MCP plugin, project `bihjmgbdzbhcnsuhzzwo` | Yes — Supabase |

## Connection strings

**Replit / production (direct):**

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

Replit **Secret name** must be exactly `DATABASE_URL` with the **direct** connection string (not the pooler URL).

## Web app vs iOS app

| App | How it reaches data |
|---|---|
| **Web** (`artifacts/vndrly`) | Browser → Vite dev server or Replit → **api-server** → Supabase via `DATABASE_URL` |
| **API** (`artifacts/api-server`) | Express → `@workspace/db` → Supabase via `DATABASE_URL` |
| **iOS** (`artifacts/vndrly-mobile`) | Expo app → **`EXPO_PUBLIC_DOMAIN`** (default `https://vndrly.ai`) → api-server → Supabase |

The mobile app never connects to Supabase Postgres directly. Production iOS builds use `EXPO_PUBLIC_DOMAIN=https://vndrly.ai` (see `artifacts/vndrly-mobile/eas.json`).

## What is *not* the database anymore

The old Neon / Replit-hosted Postgres is **deprecated**. Do not point `DATABASE_URL` at any Replit `*.replit.dev` or Neon URL.

**Data migration status:** Complete (May 2026). Production data was exported from Neon and imported into Supabase (~144 site locations, ~49 users, ~187 tickets). The one-time scripts remain in `scripts/` for reference only.

## Local setup

1. Copy `.env.example` → `.env.local`
2. Paste your Supabase password into `DATABASE_URL`
3. On Windows, use the **pooler** URL (`aws-1-us-west-2`, port `6543`) — see `.env.example`
4. Local tools auto-load `.env.local` via `scripts/load-env-local.mjs` when vars are not already set

If your shell already has a stale `DATABASE_URL` (e.g. old direct Supabase host), set `VNDRLY_LOAD_ENV_LOCAL=1` so `.env.local` wins:

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

Never run destructive resets against Supabase without explicit approval (`replit.md` hard rule).

## One-time data migration (historical)

Neon → Supabase migration is **done**. For reference, the scripts were:

- `lib/db/scripts/export-neon-data.mjs` — export from old Neon DB
- `scripts/replit-one-shot-migrate.sh` — Replit Shell one-shot (if ever needed again)

## Tests

`pnpm --filter @workspace/api-server test` uses an isolated `*_test` database derived from `DATABASE_URL`. It does not touch production Supabase data during normal test runs.
