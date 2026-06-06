# Production deploy

## One command from Cursor

```powershell
pnpm run save
```

Commits (if needed), pushes to GitHub, builds, and deploys.

After each save, **local dev is started automatically** if it is not already running (`http://localhost:5173/` with API on `:8080`). Two small PowerShell windows stay open while you work; close them to stop local dev. To start manually without saving: `pnpm run dev:local` or double-click `Start-VNDRLY-Dev.ps1`.

**While GoDaddy account is locked:** same command deploys to a **public live URL** (tunnel from this PC) plus GitHub. URL is in `.local/live-url.txt` after each save.

**When GoDaddy VPS credentials work:** same command switches to GoDaddy VPS and `vndrly.ai` automatically.

## One-time setup files (Desktop, not in git)

`C:\Users\JohnElerick\Desktop\GoDaddy.env`:

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

`C:\Users\JohnElerick\Desktop\Supabase.env` — already used for `DATABASE_URL` password.

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

## DNS cutover

When the VPS serves the app over HTTPS on its IP, point `vndrly.ai` A records to that IP (GoDaddy DNS), or:

```powershell
node scripts/godaddy-update-dns.mjs
```

(requires `api_key` / `api_secret` in `GoDaddy.env`)
