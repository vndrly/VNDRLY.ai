# Production deploy

## One command from Cursor

```powershell
pnpm run save
```

Commits (if needed), pushes to GitHub, builds, and deploys.

After each save, **local dev is started automatically** if it is not already running (`http://localhost:5173/` with API on `:8080`). Two small PowerShell windows stay open while you work; close them to stop local dev. To start manually without saving: `pnpm run dev:local` or double-click `Start-VNDRLY-Dev.ps1`.

**While GoDaddy account is locked:** same command deploys to a **public live URL** (tunnel from this PC) plus GitHub. URL is in `.local/live-url.txt` after each save.

**When GoDaddy VPS credentials work:** same command switches to GoDaddy VPS and `vndrly.ai` automatically.

## One-time setup files (API Keys and Secrets, not in git)

`C:\Users\john\Dev\API Keys and Secrets\GoDaddy.env`:

```
user your@email.com
pass your-godaddy-account-password
vps_ip 0.0.0.0
ssh_pass your-vps-root-or-admin-password
```

Optional for automatic DNS cutover:

```
api_key ...
api_secret ...
```

`C:\Users\john\Dev\API Keys and Secrets\Supabase.env` — already used for `DATABASE_URL` password.

Use standard environment entries in that private file: `SUPABASE_URL` plus
`SUPABASE_SECRET_KEY` (preferred) or the legacy
`SUPABASE_SERVICE_ROLE_KEY`. The deployment reads these directly and keeps
them server-only.

For OpenAI-powered server features such as gate plate OCR, store
`OPENAI_API_KEY` in `OpenAI API Key v2.env` inside the local
`API Keys and Secrets` folder. VNDRLY also checks
`%USERPROFILE%\DEV\API Keys and Secrets` and never exposes this server-only
value to the web or mobile client. Set `OPENAI_ENV` to an absolute file path
when a machine uses a different location.

## One-time VPS discovery

```powershell
pnpm run setup:vps
```

Opens Chrome once and waits — it does **not** refresh or auto-type. Sign in yourself, then it reads the VPS IP and writes `vps_ip` into `GoDaddy.env`.

Or paste `vps_ip` and `ssh_pass` from the GoDaddy VPS welcome email.

## First production deploy

```powershell
pnpm run deploy:production
```

Bootstraps the server (Node, nginx, clone repo), builds web + API, enables HTTPS.

### Plate-state deployment preflight

Normal GoDaddy deployment now runs the API's `migrate:plate-state` step after
the build and before the service restart. That step reads only
`lib/db/drizzle/chunk_391_site_visit_plate_state.sql`, permits exactly these
two idempotent additive changes, and rejects any additional SQL:

- nullable text `guest_sessions.plate_state`
- nullable text `site_visits.plate_state`

It then verifies both columns through `information_schema`. A missing/wrong
column or migration error stops the deployment before `vndrly-api` restarts.
This path does not run Drizzle push, backfill data, change defaults, or execute
a migration directory/glob.

### Staged state requirement

The server accepts legacy installed clients that send a plate without state
while `VNDRLY_REQUIRE_PLATE_STATE` is absent or not `1`; the stored state is
`null`. Invalid supplied values are still rejected. After installed mobile
adoption is confirmed, add this server environment entry and deploy normally:

```text
VNDRLY_REQUIRE_PLATE_STATE=1
```

Web and current mobile clients already require state locally. Remove or set
the variable to any value other than `1` to return to compatibility mode.

## DNS cutover

When the VPS serves the app over HTTPS on its IP, point `vndrly.ai` A records to that IP (GoDaddy DNS), or:

```powershell
node scripts/godaddy-update-dns.mjs
```

(requires `api_key` / `api_secret` in `GoDaddy.env`)
