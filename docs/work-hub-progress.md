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

## Gate layout correction checkpoint — 2026-09-10

- Independent-review blockers are corrected: Full Gate History is selected-site scoped for display and export and hidden without site context. The On Site Now card keeps its 560px desktop cap and 75/25 internal regions, but now responds to viewport height as well as width so short-wide and landscape screens do not receive the fixed desktop height.
- Natural voice, exact-company driver memory, newest-visit ordering, confident OCR history fill, low-confidence OCR no-guess behavior, and microphone stop/restart/disposal are covered in the existing authorized Gate boundaries. History autofill now requires both plate and state confidence to meet the approved threshold; either low-confidence value prevents identity or company restoration.
- The Gate draft interpreter and Gate voice entry path now answer contextual duration questions from an allowlisted snapshot of the visible selected site and form fields without submitting or mutating the draft. Missing duration or site context requests clarification. Spoken host selection applies only when one visible, currently authorized option matches unambiguously; missing or ambiguous matches never guess. Context changes invalidate pending results, duplicate callbacks for one recognition delivery do not double-apply, and a distinct utterance or later microphone capture may legitimately repeat the same request. The listening session remains active across recognized utterances and recoverable no-speech errors until an explicit stop/lifecycle boundary, while the shared microphone coordinator prevents parallel global and Gate listeners.
- Spoken-driver parsing now treats `state` as a field boundary. The regression phrase `check in Bob Villa state Oklahoma plate ABC123 for two hours` resolves Bob / Villa / OK / ABC123 / 120 minutes without treating the duration as purpose text.
- Focused Gate verification: 6 files / 82 tests passed. Complete Gate suite: 25 files / 183 tests passed. The most recent broad web baseline before the final delivery-scoping correction was 169 files / 1114 passed, 1 skipped; it was not rerun in this correction. Web typecheck and locale parity passed (mobile 1855/1855; web 4426/4426). Diff check passed with only repository line-ending notices.

## Encrypted iOS offline queue checkpoint — 2026-09-11

- Work Hub mutations are stored per authenticated user and active vendor/partner context; context switches never adopt another account or organization's operations. The legacy global queue is deliberately not auto-adopted.
- Queue metadata and command bodies use a SQLCipher database whose random 256-bit key is stored in the device secure store. Upload bytes are copied to the application's private document directory and are removed only after confirmed server receipt.
- Operation identifiers remain stable across retries. The queue serializes concurrent enqueue/drain work, enforces count and size bounds, preserves dependency order, respects retry delay headers, retains conflicts and permanent failures for resolution, and revokes a scope after an authorization failure.
- The production bridge covers core Work Hub creates, task completion, channel and meeting messages, and meeting file uploads. Queued work drains when Work Hub loads and whenever a meeting refreshes.
- Failing-first queue, encryption-adapter, runtime-bridge, and corrupt-data preservation tests were observed. Final focused verification passed 5 files / 77 tests; the complete mobile suite passed 120 files / 935 tests. Mobile typecheck and English/Spanish parity passed (mobile 1909/1909; web 4565/4565). Expo configuration inspection confirmed the SQLCipher native build property.

## Encrypted iOS offline queue checkpoint — 2026-09-11

- Work Hub mutations are stored per authenticated user and active vendor/partner context; context switches never adopt another account or organization's operations. The legacy global queue is deliberately not auto-adopted.
- Queue metadata and command bodies use a SQLCipher database whose random 256-bit key is stored in the device secure store. Upload bytes are copied to the application's private document directory and are removed only after confirmed server receipt.
- Operation identifiers remain stable across retries. The queue serializes concurrent enqueue/drain work, enforces count and size bounds, preserves dependency order, respects retry delay headers, retains conflicts and permanent failures for resolution, and revokes a scope after an authorization failure.
- The production bridge covers core Work Hub creates, task completion, channel and meeting messages, and meeting file uploads. Queued work drains when Work Hub loads and whenever a meeting refreshes.
- Failing-first queue, encryption-adapter, runtime-bridge, and corrupt-data preservation tests were observed. Final focused verification passed 5 files / 77 tests; the complete mobile suite passed 120 files / 935 tests. Mobile typecheck and English/Spanish parity passed (mobile 1909/1909; web 4565/4565). Expo configuration inspection confirmed the SQLCipher native build property.
