# Production handoff — what’s done vs what only you can do

## Already done (no action needed)

- Code is on **GitHub `main`** at commit `6e5cc90e9` (Supabase Storage, foreman crews, branding, mobile photo upload fix).
- Local **API** builds successfully.
- **DNS** for `vndrly.ai` → `34.111.179.208` (saved in `.local/godaddy-vps.json` for deploy scripts).
- **Database** URL is set in `.env.local`.
- Switching Cursor accounts did **not** change any of the above.

## Blocked on three secrets (about 5 minutes of your time)

Run from repo root:

```powershell
pnpm run preflight:deploy
```

### 1. Supabase service role key

1. Open [Supabase API settings](https://supabase.com/dashboard/project/bihjmgbdzbhcnsuhzzwo/settings/api).
2. Copy the **`service_role`** key (secret, not `anon`).
3. Add to `.env.local`:

```env
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_STORAGE_BUCKET=vndrly-objects
```

Without this, production uploads fall back to disk on the VPS and won’t match dev.

### 2. GoDaddy VPS SSH

Edit `C:\Users\JohnElerick\Desktop\GoDaddy.env`:

```text
vps_ip 34.111.179.208
ssh_pass YOUR_REAL_VPS_ROOT_PASSWORD
```

(`ssh_pass` must be the real password — not the word `PASSWORD` as a placeholder.)

### 3. Deploy

```powershell
pnpm run deploy:production
```

That pulls `main`, builds web + API on the server, restarts `vndrly-api`, and reloads nginx.

## iOS app

- **No App Store rebuild required** for the storage URL fix if you deploy the API: the server returns **full** `https://vndrly.ai/api/storage/upload/...` URLs.
- Optional OTA (JS-only update for photo finalize in `lib/photos.ts`):

```powershell
cd artifacts\vndrly-mobile
pnpm exec eas login
pnpm exec eas update --branch production --message "Photo upload finalize"
```

- New **App Store** build only when you change native config, icons, or `app.json` version.

## Cursor Ultra billing

Contact Cursor support to move Ultra from **jelerick2** personal to **v@vndrly.ai** — not fixable in this repo.

## After deploy — quick check

Log in as `joe.boggs@winchester.com` / `winchester2` → Foreman → Crews. Co-workers should load (not “server may need an update”).
