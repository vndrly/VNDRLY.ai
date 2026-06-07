# iOS / TestFlight — VNDRLY Field Mobile

Mobile app path: `artifacts/vndrly-mobile`

Production builds talk to **`https://vndrly.ai`** (same Supabase-backed API as the web app). The app does not connect to Postgres directly.

## Preflight (automated checks)

From repo root:

```powershell
pnpm --filter @workspace/vndrly-mobile run typecheck
pnpm --filter @workspace/vndrly-mobile run test
```

Expo account: **`vndrlyadmin`** (display name **VNDRLYAdmin** — subscribe billing here, not the Apple email).

| Name in Expo UI | What it is | Use for |
|---|---|---|
| **VNDRLYAdmin** (`vndrlyadmin`) | EAS project owner | **Paid plan**, builds, credentials — `@vndrlyadmin/vndrly-mobile` |
| **V@VNDRLY.ai** | Login email / separate Expo identity | Sign-in only; not where this app lives |
| `v@vndrly.ai` in `eas.json` | Apple ID for TestFlight submit | App Store Connect only |

EAS project: `@vndrlyadmin/vndrly-mobile`, id `2b63b072-00bc-4330-aac5-fafaaa7f7ff5` (`app.json` → `"owner": "vndrlyadmin"`).

## Build for TestFlight

### First time (or after Apple cert changes) — interactive required

EAS must validate iOS credentials once in an **interactive** terminal (Cursor agent/non-interactive builds will fail with “Distribution Certificate is not validated”):

```powershell
cd C:\Users\JohnElerick\Desktop\vndrly\artifacts\vndrly-mobile
.\node_modules\.bin\eas.cmd login
.\node_modules\.bin\eas.cmd build --platform ios --profile production
```

Follow the prompts to confirm Apple credentials. EAS stores them remotely for later `--non-interactive` builds.

### Repeat builds (script)

```powershell
cd C:\Users\JohnElerick\Desktop\vndrly\artifacts\vndrly-mobile
.\scripts\testflight-build.ps1
```

Add `-Submit` after filling `appleId` and `appleTeamId` in `eas.json` (App Store Connect app id `6771456209` is already set).

### What the production profile sets

- `EXPO_PUBLIC_DOMAIN=https://vndrly.ai`
- Bundle id: `com.vndrly.field`
- EAS auto-increments iOS `buildNumber` (was at **3**, next build → **4**)

## Local dev (simulator / Expo Go)

### Quick dev server (Windows or Mac — Expo Go / dev client over LAN)

```powershell
pnpm --filter @workspace/vndrly-mobile run dev:local
```

Uses `EXPO_PUBLIC_DOMAIN` from repo-root `.env.local` (defaults to `https://vndrly.ai`).

### iOS Simulator — from Windows (EAS cloud build)

Builds a simulator `.app` in the cloud (`eas.json` → `development` profile, `simulator: true`):

```powershell
pnpm run ios:sim:eas
```

When the build finishes, on a **Mac** download the `.tar.gz` from the EAS build page, then:

```powershell
pnpm run ios:sim:install -- C:\path\to\build.tar.gz
```

### iOS Simulator — native on Mac (Xcode)

Requires **macOS + Xcode** (does not run on Windows):

```powershell
pnpm run ios:sim:local
```

Optional device name:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/ios-simulator-local.ps1 -Device "iPhone 16"
```

Point the simulator at your local API by setting in repo-root `.env.local`:

```env
EXPO_PUBLIC_DOMAIN=http://localhost:8080
```

Then run `pnpm run dev:local` (API) and `pnpm run ios:sim:local` (simulator).

See also `docs/database.md` for local DB + API setup.

## Optional env vars

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_DOMAIN` | API base (required for builds — set in `eas.json`) |
| `EXPO_PUBLIC_SENTRY_DSN` | Crash reporting in TestFlight builds (optional) |

## Known good checklist

1. Typecheck passes  
2. `eas whoami` shows `vndrlyadmin`  
3. Interactive `eas build --platform ios --profile production` succeeds  
4. Build uploaded / submitted to TestFlight  
5. Install from TestFlight → app opens → login works against vndrly.ai  

## Current status (local repo)

| Check | Status |
|---|---|
| Typecheck | Pass |
| EAS login | `vndrlyadmin` |
| `EXPO_PUBLIC_DOMAIN` | `https://vndrly.ai` (production profile) |
| Bundle id | `com.vndrly.field` |
| App Store Connect app id | `6771456209` |
| Completed iOS builds on EAS | **None yet** — first build required |
| Remote iOS `buildNumber` | **5** (EAS auto-increment; next build uses this) |
| Non-interactive build | **Blocked** — distribution cert must be validated once interactively |

### Your next step (required — cannot be done from Cursor agent)

Open a normal PowerShell terminal (not agent/non-interactive) and run:

```powershell
cd C:\Users\JohnElerick\Desktop\vndrly\artifacts\vndrly-mobile
.\node_modules\.bin\eas.cmd build --platform ios --profile production
```

When prompted:

1. Sign in with your **Apple Developer** account (the one that owns `com.vndrly.field`).
2. Let EAS create or reuse the **Distribution Certificate** and **provisioning profile**.
3. Wait for the cloud build to finish (~15–25 min). EAS prints a URL to watch progress.

After the build succeeds:

```powershell
# Option A — manual: open the EAS build page → Submit to App Store Connect → TestFlight

# Option B — CLI (fill appleId + appleTeamId in eas.json first):
.\node_modules\.bin\eas.cmd submit --platform ios --latest
```

Then on your iPhone: **TestFlight → VNDRLY Field Mobile → Open**. The app should load and talk to `https://vndrly.ai`.

Repeat builds (after the one-time credential setup):

```powershell
.\scripts\testflight-build.ps1 -NonInteractive
```
