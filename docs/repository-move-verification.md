# Repository move verification — 2026-10-23

Repository: `C:\Users\john\Dev\VNDRLY.ai`.
Baseline: `bd08504b`, `main` tracking `origin/main` at `https://github.com/vndrly/VNDRLY.ai.git`.

## Verified

- PASS: fetch/prune completed during update; baseline is 0 ahead / 0 behind. One worktree, no submodules. Repository is not a junction. Current uncommitted changes are the repairs listed below.
- PASS: Node 24.19.0 and pnpm 9.15.9. Frozen-lockfile installation completed for 28 workspace projects; lockfile unchanged. Install scripts were suppressed; the actual web/API builds verify the required installed build tools.
- PASS: Expo online dependency compatibility check reports dependencies up to date.
- PASS: 41 workspace links resolve within this checkout; no missing workspace or local-path dependencies found.
- PASS: production web build and API build completed. Web emitted sourcemap and large-chunk warnings.
- PASS: locale parity (mobile 3449 keys per language; web 5630 keys per language).
- PASS: five focused local-secret parser/isolation tests; changed JavaScript syntax checks; PowerShell syntax checks; whitespace check.
- PASS: all 24 files in `C:\Users\john\Dev\API Keys and Secrets` are readable. Required application configuration loads with that directory selected. Expo token loads from the existing file. Values were not displayed or changed.
- PASS: the sibling secrets directory is outside any Git worktree. No tracked secret-like env/signing files. A bounded comparison of recognizable credential values from 15 secret files against tracked text found no matches. This is not a full Git-history secret audit.
- PASS: Git exclusions cover env variants, env credential files, private signing material, and accidental copies of the secrets directory. Mobile-upload exclusions cover the same material and preserve all package manifests.

## Repairs

- `Start-VNDRLY-Dev.ps1`, `scripts/start-api-dev.ps1`, `scripts/start-vite-dev.ps1`, `scripts/ensure-local-dev.ps1`: use the checkout and its `.local/tools` instead of another user's machine path.
- Current setup paths corrected in `docs/database.md`, `docs/deploy-godaddy.md`, and `docs/production-handoff.md`. Historical design notes remain unchanged.
- `scripts/setup-from-transfer-pack.ps1`, `scripts/smoke-prod-api.ps1`: portable install/output paths.
- Thirteen deployment/inspection/backfill scripts: resolve their `.local` input/output paths from the script location. These scripts were syntax-checked, not executed.
- `scripts/ship-common.ps1`, `scripts/eas-mobile-common.ps1`: prefer checkout-local tooling; EAS helper reads the existing Expo PAT without copying or logging it.
- `scripts/load-env-local.mjs`, `scripts/parse-local-secret.mjs`, `scripts/tests/local-secret-loading.test.mjs`: parse env quoting/comments and legacy Supabase notes; choose only a matching-project service-role JWT; prevent raw secret fallback reads in fresh-local test mode.
- `.gitignore`, `.easignore`: credential exclusions; preserve workspace packages in the mobile archive.
- User-level `VNDRLY_SECRETS_DIR`: corrected to `C:\Users\john\Dev\API Keys and Secrets`. Existing app processes retain their inherited old value until restarted; validation commands explicitly selected the corrected directory.

## Additional verification and limits

- PASS: shared-library type checking plus all eight application/scripts packages. Application checks ran sequentially with `NODE_OPTIONS=--max-old-space-size=6144` after the default 2 GB limit was insufficient.
- PASS: AskV iOS engine v1.12.29 restored with the existing pinned preparation script; archive and installed device/simulator framework hashes verified. Used the existing bundled Python 3.12.14 through ASKV_PYTHON. Generated libraries are ignored by Git.
- PASS: iOS JavaScript/Hermes export completed (4500 modules, 128 assets, 16.3 MB Hermes bundle) in `artifacts/vndrly-mobile/.expo-smoke-export`, using one worker and a 4 GB Node heap. Sentry organization/project metadata was not configured; uploads were disabled for validation.
- WARN: `C:\Users\john\Dev\API Keys and Secrets\Massive-API-Key.env` is absent. This optional market-data integration was not provisioned or substituted.
- PASS: native iOS compilation/signing subsequently verified through EAS; see the signed-build record below. No TestFlight submission, deployment, database operation, or live message send was performed.
- Historical docs and explicit legacy secret-directory fallback candidates remain; they are not active checkout paths. `/api/users/...` search matches are API routes, not filesystem paths.
- Existing ACLs grant John, Administrators, and SYSTEM control plus inherited Codex sandbox access. Permissions were inspected, not changed.
- Full application/database test suites were not run as part of this move/build audit.

This report records validation of the repairs before commit. No credentials were rewritten, rotated, or copied into the repository. Restart existing Codex/terminal sessions to inherit the corrected user-level secrets-folder setting.

## Signed EAS build verification

- PASS: production iOS device build **1.0.4 (252)**, STORE distribution, status **FINISHED**.
- Built repair commit: `7493df09c66fdb2cab111798d18739c690eb7ed6`.
- [EAS build 544a02f5-59a0-4a35-8c1f-0a172de00cd2](https://expo.dev/accounts/vndrlyadmin/projects/vndrly-mobile/builds/544a02f5-59a0-4a35-8c1f-0a172de00cd2).
- Xcode logs confirm `ARCHIVE SUCCEEDED` and signing operations; EAS completed archive upload and credential cleanup.
- IPA artifact availability verified with HTTP 200; artifact size 74,492,348 bytes. Signed download URLs and log-access URLs are not recorded here.
- Existing remote signing credentials used for the main app and WorkActivity extension. Build ran with `--non-interactive --freeze-credentials`, `EXPO_NO_CAPABILITY_SYNC=1`, and no auto-submit flag. No secret files, signing keys, or provisioning profiles were changed.
- EAS build record: created 2026-10-24 04:45:33 UTC, completed 04:54:56 UTC (2026-10-23 in America/Chicago).
- EAS reported monthly included build credits exhausted; pay-as-you-go billing applies.
- Repair commit remains local; no GitHub push or TestFlight submission was requested.
