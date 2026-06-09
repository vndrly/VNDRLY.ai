# Machine transfer pack (one-time zip)

Use this when moving VNDRLY development and deploy tooling from one Windows PC to another (USB zip drive, external SSD, etc.).

## On the **old** machine

From repo root:

```powershell
pnpm run pack:machine-transfer
```

Or pick the output path (recommended for USB):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-machine-transfer-pack.ps1 -OutputPath "E:\VNDRLY-machine-transfer.zip"
```

### Before packing — checklist

| Item | Location |
|------|----------|
| Database + API keys | `.env.local` in repo root |
| VPS SSH | `DEV\API Keys and Secrets\GoDaddy.env` (`vps_ip`, `ssh_pass`) |
| Supabase password note | `DEV\API Keys and Secrets\Supabase.env` |
| VPS metadata (optional) | `.local\godaddy-vps.json` |

The pack **includes uncommitted work** (full working tree minus `node_modules`). Production deploy still pulls **`origin/main` on the VPS** — push to GitHub before `deploy:production` if the server must match your latest commits.

**Security:** The zip contains secrets. Use a private drive; delete the zip after setup if you prefer.

## On the **new** machine

### Prerequisites

1. **Node.js 20 LTS** — [nodejs.org](https://nodejs.org/)
2. **Git** (optional but recommended) — [git-scm.com](https://git-scm.com/)
3. **Cursor** or VS Code (optional)

### Setup

1. Copy the zip to the new PC and extract anywhere (e.g. `D:\VNDRLY-transfer\`).
2. Open the extracted folder.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\SETUP-NEW-MACHINE.ps1
```

4. Enter the install path when prompted (default `C:\Dev\VNDRLY.ai`). You can change this anytime later.
5. When finished, start local dev:

```powershell
cd C:\Dev\VNDRLY.ai   # your chosen path
pnpm run dev:local
```

Or double-click `Start-VNDRLY-Dev.ps1` (path is updated by setup).

### Deploy to production

```powershell
pnpm run preflight:deploy
pnpm run deploy:production
```

Full ship (typecheck, commit, push, deploy, TestFlight): `pnpm run save`

## Pack contents

```
VNDRLY-machine-transfer-YYYYMMDD-HHMM/
  SETUP-NEW-MACHINE.ps1      ← run this first
  README-MACHINE-TRANSFER.md
  MANIFEST.json              ← git commit, dirty flag, machine name
  secrets/                   ← GoDaddy.env, Supabase.env, dot-env-local
  VNDRLY.ai/                 ← full repo snapshot (no node_modules)
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pnpm` not found | Run `corepack enable` then `corepack prepare pnpm@9.15.9 --activate` |
| Missing `DATABASE_URL` | Copy `.env.local` from old machine or rebuild from `.env.example` |
| Deploy says missing VPS IP | Add `vps_ip` to `API Keys and Secrets\GoDaddy.env` |
| Deploy says missing SSH | Add `ssh_pass` to `API Keys and Secrets\GoDaddy.env` |
| Uploads fail in production | Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` |

See also: [deploy-godaddy.md](./deploy-godaddy.md), [database.md](./database.md), [production-handoff.md](./production-handoff.md).
