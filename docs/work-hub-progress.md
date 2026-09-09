# Work Hub implementation and release checkpoint

Updated September 9, 2026 (America/Chicago).

## Release state

The expansion is implemented locally on `codex/work-hub-expansion`, with implementation and required verification complete. Original baseline: `931b7e5f127feaac3b31ccf6128f868813e25133`. The non-overlapping release guard fix through `d6f854b1ceed67827e7cc5f5b088b36e5cb4dbba` was fast-forwarded without replacing local work. Publication and live verification remain pending. Passing source tests are not a production release.

The separate `codex/work-hub-handoff-20260909` documentation branch carries cross-machine progress; it does not contain application source. Later release evidence must identify the exact main commit, workflow runs, Expo update and TestFlight build/submission.

## Implemented scope

See the [approved design](superpowers/specs/2026-09-09-work-hub-expansion.md) and [implementation plan](superpowers/plans/2026-09-09-work-hub-expansion.md).

- Persistent Crews, Channels, invitations, chats, activity, preferences, conversation actions, notes and existing task/form workflows in a branded workspace.
- Calendar and authenticated Meetings scheduling with personal/shared meeting types, availability and conflict protection.
- Internal WebRTC Calls and meetings, acceptance boundaries, private voicemail, and host-controlled meeting recording with participant consent. VNDRLY-hosted TURN provisioning is included; no external calling provider is introduced.
- Personal/shared files, versions, integrity verification, favorites, recycle/restore and expiring revocable public links; authorized existing uploads remain available.
- Invoice drafts, issue/email/print/export, outside payments, guarded refunds and platform fee policy. Payroll preparation/approval requires explicit payroll grants; administration alone never grants payroll data access.
- CSV preview/mapping/confirmation/import history and authorized exports, plus existing accounting connection entry points. Microsoft remains import-only and unavailable without configuration.
- Phone/tablet daily collaboration and native audio using existing dependencies. Full financial execution, refund and bulk import controls remain web-only.

Screenshot business data and source screenshots are excluded from application code, fixtures and documents.

## Verification before publication

- Full workspace typecheck and English/Spanish locale parity passed.
- Shared library tests: 57 passed.
- Web: 956 passed and 3 skipped in the broad run; affected Work Hub and three worker-startup failures were covered by focused retries. Final recording-flush regression passed after correcting its test timer selection.
- Mobile: all 104 files / 681 tests covered by passing runs and unchanged retries for Windows startup/import timeouts.
- API: broad fresh-local run passed 2,359 tests; focused retries covered every affected file, including storage ownership, capture consent and the isolated database-role fixture. No production database was used.
- All 36 browser workflows passed across the broad run and focused retries, including the persisted Work Hub flow and real audio.
- Real two-browser internal audio passed: acceptance, both actual audio-room interfaces, bidirectional RTP packets and recording denied for Calls. Only microphone hardware was synthetic; signaling and media were real.
- Production web/API bundles built. Newly fetched mobile release guard checks passed 15/15. Relay/workflow checks passed; actual relay allocation awaits deployment.

Logs and synthetic browser artifacts remain local in `artifacts/work-hub-verification/`, excluded from release. Final scope corrections also passed: announcement authorization 3 tests, command consumers 16 tests, finance API 6 tests, mobile document checks 6 tests, focused web 11 tests, and API/web/mobile typechecks. Announcements now reach authorized recipients with acknowledgement and urgent priority; personal issued payroll documents are recipient-only; gross payroll drafts export to CSV.

## Explicit live limitations

Card/ACH collections, payroll direct deposit, taxes/filings and secure provider-managed bank/tax onboarding require provider configuration. Unavailable execution never simulates a payment, deposit, filing or net-pay calculation. Microsoft connection/import requires credentials. Transcription depends on the existing configured transcription service; live audio itself does not.

The relay must be verified from outside the VPS after deployment; a listener check alone is insufficient. Physical iOS microphone/headset behavior remains a device acceptance check. Automated native tests and TestFlight submission do not prove physical hardware behavior.

## Remaining release work

1. Freeze the verified source and preserve its exact tree identity.
2. Recheck remote main and publish scoped source non-force, preserving unrelated work.
3. Verify web Publish, API Deploy/additive migrations, authenticated Work Hub and external TURN allocation.
4. Dispatch/verify production OTA eligibility/update and exact native TestFlight build/submission. Never bypass an incompatible-runtime OTA guard.
5. Record concrete evidence on the handoff branch. Full ship remains incomplete until required tracks have terminal proof.

## Safe resume

Inspect branch, remotes, status and latest checkpoint. Preserve pre-existing deleted button shortcut and untracked `artifacts/list-one-verification/`. Exclude verification helpers/logs. Never force-push, rotate credentials, wipe/reset data or run destructive schema push. API/E2E use new loopback databases in `fresh-local` mode. Never reset source work to match a documentation-only branch.
