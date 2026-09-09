# Work Hub release evidence

Date: 2026-09-09

## Included

- Guarded additive Work Hub flags and collaboration, work, schedule, meeting, connector, search, notification, retention, and audit schema.
- Context-capability authorization, opaque cross-tenant failures, idempotent commands, version conflicts, private files, SSE events, notification preferences, search, and personal Home aggregation.
- Developed web destinations for Channels, Calendar, Files & Notes, Tasks & Forms, Meetings, Search, and Settings, including administrator creation/assignment, reusable templates, announcements, acknowledgements, ordered approvals, monitoring, and participant completion/submission views.
- iOS Work Hub reads the same tenant-safe records, supports quick creation for core operational records and replay-safe task completion, and retains a reliable return to the main VNDRLY experience.
- One shared web/iOS AskV Work Hub toolbox; consequential writes use the existing confirmation and audit path.
- Public commercial homepage and a separate curated public AskV boundary with no authenticated tools or history.
- API deployment runs all Work Hub migrations in order.
- Post-review hardening scopes Gate Supervisor task/shift management to assigned gate/site contexts, validates every mutation target against the owning organization, serializes open-shift claims, preserves channel-delete idempotency, and binds file reservations to the authorized channel owner.

## Verification on the release tree

- `pnpm lint:i18n`: pass (web 4,399 keys per locale; mobile 1,751 keys per locale).
- `pnpm run typecheck`: pass.
- `pnpm test`: pass on the exact implementation tree: web 144 files / 954 passed / 1 skipped; mobile 101 files / 675 passed; API 270 files passed / 16 skipped and 2,268 tests passed / 108 skipped; Chromium 34/34.
- API and browser suites ran against isolated `postgres_test` with a non-routable test AI endpoint.
- Production web build: pass.
- Flags, core, domains, and notification migrations each passed two consecutive applications against `postgres_test`; the additive Microsoft import migration also passed twice.

## 2026-09-09 batch reconciliation verification

- `pnpm lint:i18n`: pass (web 4,399 keys per locale; mobile 1,751 keys per locale).
- `pnpm run typecheck`: pass across libraries, API, web, mobile, commercial, desktop, sandbox, and scripts.
- Shared-library tests: pass (57 tests across AskV wake, API contracts, 1099, Gate, Majik, and plate-state packages).
- Web: 146 files passed; 966 tests passed and 1 skipped.
- Mobile: 102 files passed; 677 tests passed.
- API: 278 files passed and 10 skipped; 2,287 tests passed and 98 skipped against the isolated `postgres_test` database.
- Chromium E2E: 34/34 passed against the isolated `postgres_test` database.
- Mandatory aggregate `pnpm test`: pass across the complete library, web, mobile, isolated API, and Chromium chain.
- API production typecheck and bundle: pass.
- Review fix commit: `d05d64f1127177bc7a71a90a503711cdabb730b2`.
- Detailed implementation-versus-design status: `docs/work-hub-batch-reconciliation.md`.

## Controlled rollout and known external work

- Work Hub remains false-default and can be rolled back by flag without reverting schema.
- Audio meetings are safe-disabled. Provider approval, credentials, data-processing review, signed webhooks, and physical iPhone/iPad audio-route testing remain before recording or transcription can be enabled. See `docs/decisions/work-hub-audio-provider.md`.
- Microsoft 365 is a one-way, staged migration source by contract and remains safe-disabled. Import batches/items preserve provenance, external IDs and versions, permission/conflict snapshots, progress, activation targets, and errors. Azure registration, OAuth credentials, callback verification, provider category mapping, and physical import validation remain before enablement. VNDRLY never writes back to Microsoft.

## Production completion fields

- Release commit:
- GitHub main:
- Web Publish:
- API Deploy and `/api/healthz`:
- Supabase migrations/storage:
- Expo OTA update group:
- TestFlight build/submission:
- Commit-to-public-web elapsed time:
