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
Implementation started from a clean main checkout. The user explicitly authorized the full production release on September 16, 2026, including source publication, web/API/database deployment, iOS OTA and TestFlight. Release verification is in progress.

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
- Full API run: 2,972 passed, 53 skipped, 5 failures initially. All identified failures were resolved: managed lifecycle access, stale capture fixture expectations, and AskV conversation-binding fixtures. Final impacted API verification passed all 69 tests across 13 suites, including all seven onboarding cases. Successful unchanged suites were reused; the entire API suite was not rerun after the fixes.
- Public activation boundary: 4 tests passed, including assembled-app anonymous access and protected administrative routes.
- Initial full browser run: 34 passed, 2 failed, 6 skipped. Both identified causes addressed: activation public routing and approval-worker expiry of an old picker fixture. Final combined rerun passed all 15 tests, including all previously skipped picker cases and the complete company/invitation/activation/Gate/Work Hub/role-change/revocation flow. Card screenshot inspected; heading alignment corrected.
- All database tests use `fresh-local` on loopback PostgreSQL, creating unique retained databases with additive schema only. Development and production databases were not changed.

## Resume from another machine

Read this file plus `docs/vendor-managed-subcontractors.md` on branch `codex/vendor-managed-subcontractors`. Full implementation commit `62b412a0` is now published. The prior inline upload-size blocker was resolved with a normal non-force Git push after explicit user authorization. Release fixes and this updated checkpoint will advance main together; inspect GitHub Actions for the exact release commit and individual web, API, OTA and TestFlight results. Preserve this feature work when synchronizing; it is current work, not stale pre-sync leftovers.

## Resolved verification blocker

The revisited-onboarding fixture proposed an action before recording its initial user request, so its confirmation changed from voice-session scope to conversation scope mid-flow. Recording that initial request matches the real voice flow, while preserving a separate later confirmation and durable replay assertions. All seven onboarding tests pass; no production AskV code or confirmation safeguards changed.
