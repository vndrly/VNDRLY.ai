# Work Hub batch reconciliation

Date: 2026-09-09

## Outcome

The September 8 Work Hub implementation and follow-up batches are present on `codex/work-hub`. The main implementation plan was not updated as its commits landed, so its unchecked boxes overstate the remaining engineering work. This reconciliation uses code, commit history, focused review, and fresh repository gates as the source of truth.

## Implemented and verified

| Area | Evidence | Status |
| --- | --- | --- |
| Shared contracts and guarded flags | Work Hub schemas, false-default platform flags, additive migrations, migration scripts/tests | Implemented |
| Tenant/context access and audit | Capability service, audit records, owner predicates, opaque denial behavior | Implemented; post-review scope fixes included |
| Channels and messaging | Channel/message APIs, command replay, SSE, channel selection UX, soft deletion | Implemented; delete replay fixed |
| Files and notes | Private reservation/finalization, notes, Work Hub file UI | Implemented; channel-owner binding fixed |
| Home and notifications | Work Hub Home aggregation, notification categories/preferences, deep links | Implemented |
| Web Work Hub | Home, Channels, Tasks, Calendar, Meetings, Files/Notes, Search, Settings | Implemented operational slice |
| Mobile Work Hub | Navigation, read surfaces, quick creation, durable command queue, task completion | Implemented operational slice |
| Tasks, forms, approvals, announcements | Tables, APIs, administrator builders, participant actions | Implemented; mutation targets now owner-validated |
| Shifts and calendar | Shift publishing, open shifts, requests, swaps, calendar UI | Implemented; Gate scope and single-winner claim fixed |
| Search and AskV | Authorized search plus confirmed Work Hub assistant actions | Implemented behind Work Hub access controls |
| Adjacent batch | 1099 onboarding removal, AskV state/sign-out, shared modal treatment, employee actions, branded actions | Implemented |

## Intentionally incomplete or externally blocked

| Area | Remaining requirement | Why it is not silently enabled |
| --- | --- | --- |
| Live audio meetings | Provider approval, credentials, data-processing review, signed webhooks, recording/transcription adapter, physical iPhone/iPad audio-route tests | The approved decision explicitly requires a stop before provider-specific implementation. The disabled adapter fails closed. |
| Microsoft 365 | Azure registration, OAuth credentials/callback, encrypted production token flow, provider mapping, physical import/sync validation | The staged one-way import model exists, but production connection remains safe-disabled. |
| Full mobile parity | Physical iPhone/iPad acceptance for all adaptive, offline, accessibility, interruption, and background cases | Automated mobile tests pass; device acceptance cannot be inferred from unit tests. |
| Governance and operations | Full legal-hold/export/retention telemetry, alert thresholds, representative load tests, support runbooks | Foundation exists, but the complete design-level operational evidence is not recorded. |
| General availability | Production migrations, staff/cohort flag enablement, observation window, public rollout | Requires the explicit release sequence and live monitoring. |

## Fresh validation

- Locale parity: web 4,399/4,399 and mobile 1,751/1,751.
- Whole-tree typecheck: pass.
- Shared-library tests: pass.
- Web: 966 passed, 1 skipped.
- Mobile: 677 passed.
- API: 2,287 passed, 98 skipped; 278 files passed, 10 skipped.
- Chromium E2E: 34/34 passed.
- Mandatory aggregate `pnpm test`: pass.
- API production bundle: pass.

All database-backed validation used the isolated `postgres_test` database. No production or development database was reset or destructively changed.

## Release state

The reviewed Work Hub correction is commit `d05d64f1127177bc7a71a90a503711cdabb730b2`. The branch remains ahead of `origin/codex/work-hub`; this reconciliation does not claim a production release. Web/API/Supabase/OTA/TestFlight fields remain open until an explicit full-ship command is executed and observed through completion.
