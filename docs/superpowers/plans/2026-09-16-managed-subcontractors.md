# Vendor Managed Subcontractors implementation plan

**Approved design:** Vendor administrators create external subcontractor organizations below Partner Approvals, onboard their workers, assign gatekeeper/supervisor roles and sites, and manage their operational access to the vendor Work Hub. Employer remains the subcontractor; workers must not enter the managing vendor payroll. Revocation preserves work history. User approved implementation in this task.

**Architecture:** Extend existing managed subcontractor organizations, sponsorships, and scoped role grants. Reuse account, session, operational membership, and Work Hub mechanisms. No new dependencies or destructive migrations.

## Deliverables
- [x] Backend: vendor-scoped list/create company and add/update/revoke worker endpoints. Validate actual administrator membership, organization ownership, site scope, duplicate identity and role grants. Preserve credentials for existing users.
- [x] Access integration: workers sign in with their own accounts, receive only assigned operational access, participate in permitted Work Hub contexts, and lose access on revocation. Preserve employer and payroll separation.
- [x] Frontend: card immediately below Partner Approvals; company creation, worker onboarding, role/site editing, revoke confirmation, loading/error/empty states, and English/Spanish copy.
- [x] Verification: meaningful endpoint and UI tests, tenant/role denial, stale-session revocation, payroll exclusion, root typecheck and locale parity. Run API/E2E only against newly created loopback databases in fresh-local mode. Broader API blocker is documented below.
- [x] Review: inspect complete patch against approved workflow and resolve findings; report exact validation and deployment state.

## Ownership
Backend implementer owns API/schema changes and access integration; frontend implementer owns web components and locales. Coordinator owns verification setup, cross-component review, documentation and final evidence. No production data or credentials are changed during development.

## Checkpoint
Implementation started from a clean main checkout. No release has been requested in this turn; implementation and validation are the active scope.

## Implementation details

- Uses existing managed organizations, sponsorships, role grants and account invitations; no database migration or external dependency.
- Worker chooses their own password and accepts participation authorization. Password reset alone cannot activate sponsor access. Existing account email addresses return a conflict instead of linking identities silently.
- Administrator selects Gatekeeper/Gate Supervisor and assigned sites; web and mobile expose permitted Gate operations and Work Hub access.
- Role changes invalidate sessions. Revocation also removes operational membership, denies fresh-login access to historical shared tasks/calendars and stops managed event streams; historical records remain.
- Worker records stay outside the managing vendor's payroll employee table.
- Anonymous invitation activation is included in the real application's public route boundary; token paths are redacted from logs and responses are not cached.

## Verification checkpoint — September 16, 2026

- Workspace typecheck passed; final API typecheck passed after public activation fix.
- Web: 1,187 passed, 3 skipped; final focused card, role visibility and managed-access tests passed (12).
- Mobile: 994 passed. Shared library suites and English/Spanish parity passed.
- Full API run: 2,972 passed, 53 skipped, 5 failures. Managed lifecycle failure was fixed and its 4 tests pass. Two stale meeting capture fixture expectations were corrected; all 5 capture tests pass. One stale AskV persistence-test scope was corrected; its focused suite improved to 6 passed, 1 failed. See remaining blocker below. The complete API suite is not claimed green.
- Public activation boundary: 4 tests passed, including assembled-app anonymous access and protected administrative routes.
- Initial full browser run: 34 passed, 2 failed, 6 skipped. Both identified causes addressed: activation public routing and approval-worker expiry of an old picker fixture. Final combined rerun passed all 15 tests, including all previously skipped picker cases and the complete company/invitation/activation/Gate/Work Hub/role-change/revocation flow. Card screenshot inspected; heading alignment corrected.
- All database tests use `fresh-local` on loopback PostgreSQL, creating unique retained databases with additive schema only. Development and production databases were not changed.

## Resume from another machine

Read this file plus `docs/vendor-managed-subcontractors.md` on branch `codex/vendor-managed-subcontractors`. The online branch currently contains the progress documents only: automatic approval review rejected the complete code upload because its payload exceeded the 200,000-byte review limit. The full implementation remains in the local feature branch and must be published before another machine can resume from its source. Do not mistake the online documentation checkpoint for the code implementation. No production deployment, OTA, or TestFlight release is claimed. Preserve the local feature branch when synchronizing; its changes are current work, not stale pre-sync leftovers.

## Remaining release verification blocker

`artifacts/api-server/src/routes/assistantOnboarding.database.test.ts`: "submits new saved edits after revisiting a previously completed wizard through the canonical endpoint" still fails independently in a new isolated database. Its confirmation transcript persists, but `finalize_onboarding` responds `awaiting_user_reply`; no pending confirmation is found under the expected conversation scope. This does not affect the tested subcontractor workflow. Next investigation: compare pending-action conversation binding and transcript binding when revisiting a completed onboarding wizard. No speculative AskV production change was made. Resolve this failure before claiming all mandatory merge/release gates pass.
