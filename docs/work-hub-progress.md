# Work Hub progress and safe resume

Updated: 2026-09-09 07:48 CDT (America/Chicago). Progress supplied by the active implementation task and checked against the saved workspace; historical tests are identified below.

## Release state
- GitHub repository: vndrly/VNDRLY.ai.
- Local implementation branch: codex/work-hub-expansion, baseline 931b7e5f127feaac3b31ccf6128f868813e25133.
- This checkpoint publishes documentation only on codex/work-hub-handoff-20260909. It does not publish application source, advance main, or deploy.
- The expanded Work Hub has NOT been fully implemented, verified, or shipped. Source changes described below are local, uncommitted, and not available by cloning this documentation branch.

## Approved scope
See [design](superpowers/specs/2026-09-09-work-hub-expansion.md) and [implementation plan](superpowers/plans/2026-09-09-work-hub-expansion.md). The user authorized unattended implementation and full ship. Latest audio instruction: extend the already developed internal WebRTC solution, not an external calling API. Payment/payroll external execution must remain truthful and unavailable until configured; it must never simulate successful transactions.

## Actual progress
| Area | Status | Evidence / remaining work |
|---|---|---|
| Interview and scope | Written | Approved decisions saved in design and plan; no screenshot business data copied |
| Crews, chats, invitations, preferences | Partial local implementation | Dedicated schema/routes/access helpers exist; completing permission review, migration, registration and tests |
| Workspace navigation | Partial local implementation | Rail/navigation files changed; expanded page integration and tests in progress |
| Billing/payroll | Partial local implementation | Dedicated schema, policy helpers and tests; API/UI integration and verification in progress |
| Internal audio | Partial local implementation | Host-controlled consent/capture, private recording chunks, signal ordering and optional self-hosted relay credentials implemented; full multi-participant browser/native verification outstanding |
| Mobile | Partial local implementation | Scope helper/test and entry screen recovered; participant flows and checks outstanding |
| Migrations | In progress | Additive collaboration/finance scripts require review and deploy registration; not applied to production |
| Full ship | Not started | No release commit/push/main update, deployment, OTA or TestFlight submission for this expansion |

## Test evidence
- Before restart: internal-audio policy tests passed (3 tests); baseline shared declaration build and then-existing web typecheck passed. These are historical, limited results, not proof for the current tree.
- Mobile device-scope test was first run red as intended before implementation; final passing rerun pending.
- After restart: refreshed origin; HEAD and origin/main still matched baseline. Dedicated test PostgreSQL restart performed. All complete release gates must be rerun against final integrated files.

## Blockers and limitations
- Machine restart interrupted work. No prior process is assumed alive.
- Windows sandbox helper intermittently failed to start; scoped elevated command execution has been used when required.
- Payment processor, direct deposit and payroll tax/filing integrations are not yet configured. No real money movement or filing is claimed.
- Internal audio does not require a paid calling provider; restrictive networks may require VNDRLY-hosted TURN relay configuration and verification.
- Native device behavior and live browser end-to-end proof remain outstanding.

## Next steps
1. Finish collaboration and finance contracts, mount routers/schema exports and guarded migrations.
2. Finish workspace screens, native participant flows, recording/voicemail and private-file access.
3. Review tenant/role boundaries, idempotency, fee/refund math, monetary precision and public-link scope.
4. Run root typecheck, locale parity, libraries, web, mobile, isolated API and E2E tests; inspect real UI with fictional test data.
5. Commit scoped changes; publish non-force; verify web, API/Supabase migrations, production OTA and exact TestFlight build/submission.
6. Update this checkpoint with new evidence and actual release URLs.

## Resume safely from either machine
Read this document and both linked documents first. Fetch the repository and inspect branch, remote, status and local changes. The documentation branch does not contain unfinished source; recover source from the originating checkout or a later verified implementation commit before continuing. Never reset or overwrite local work to match this checkpoint.

Preserve the pre-existing deleted button shortcut and untracked artifacts/list-one-verification directory. Do not stage them. Never wipe/reset a database, rotate demo credentials or force push. For API/E2E use fresh-local mode with a new loopback test database; do not use the legacy schema-reset test mode. Do not print secrets. Keep screenshot contents out of code/docs/fixtures.

A full ship is complete only with commit/main proof, verified web and API, additive database/storage cutover where needed, Expo OTA group and exact native TestFlight submission evidence. Source compilation alone is not a release.


## Cross-machine continuation prompt

> Read docs/work-hub-progress.md on branch codex/work-hub-handoff-20260909 in vndrly/VNDRLY.ai, then its linked scope and plan. Check for a newer progress update and a published implementation checkpoint before changing anything. Preserve this machine's local changes. Confirm which source changes are actually available remotely. Resume the unfinished Work Hub expansion under the recorded scope, using internal audio, then verify and full ship. Coordinate with the home task before parallel edits; never assume this documentation checkpoint contains the unfinished source.

## Progress maintenance

The active implementation task has been instructed to update this file at meaningful milestones with timestamps, checkpoint commits, test results, blockers, and release evidence. This is a saved checkpoint, not a live feed. If work moves to a different branch, update this document with the exact branch and commit so this bookmarked page remains the entry point.
