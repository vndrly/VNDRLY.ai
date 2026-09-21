# Gate Change Over implementation and verification ledger

## Authorized outcome
Implement and full-ship web/iOS Change Over and Shift Notes for assigned gatekeepers and supervisors, reusing visits, membership resolution, authentication, branding, and askV. User expressly authorized unattended execution and release; no routine design approval is pending.

## Design
An explicit shift belongs to one site/gate and one operator. Gate stations are site-scoped; initial station is Main gate. Existing site_visits and ticket_check_ins remain authoritative. Until visits carry a verified gate identity, metrics are explicitly site-wide and visitor/employee records are not silently deduplicated into a head count. Shift windows are server timestamps, never inferred from login time.

Prepared handoffs contain immutable structured snapshots, outgoing notes and open actionable items. A revision digest covers relevant visits, employee check-ins and items. Authentication uses existing password/context resolution without changing the active session. Transfer validates current membership/site access and snapshot revision under database locks, closes the old shift, creates the new shift, records acknowledgment, freezes the handoff, and revokes the outgoing session in one transaction. A lost response recovers through ordinary incoming-user login and persistent Shift Notes. Transfer cannot be queued offline.

Supervisors may inspect assigned sites, add stations, resolve items with an audit reason, cancel abandoned preparations, and explicitly accept responsibility for abandoned shifts with a recorded reason and immutable snapshot. They cannot rewrite completed handoffs or impersonate an incoming user. The notes default is seven days with date/search/pagination support and no seven-day deletion policy.

askV reads the same permission-checked services. Summary generation chooses and orders source fact IDs; display text is reconstructed from those facts to prevent invented operational assertions. Notes are untrusted data, never model instructions. No credential-taking or implicit transfer tool is exposed to askV.

## Tasks
1. Add snapshot contracts and failing metric/exception/revision tests; implement pure snapshot assembly.
2. Add additive schema/migration, current site authorization, transactional shift/handoff/item service and rollback/concurrency tests.
3. Add HTTP routes, bounded authentication attempts, summary grounding, askV definitions/runtime/pack wiring and tests.
4. Add web navigation, Change Over and Shift Notes UI, credential isolation and recovery, screen tests.
5. Add equivalent iOS screens/navigation, offline read behavior, reconnect and session-switch tests.
6. Run repository typecheck, locale checks, root tests in fresh local database, build and smoke checks. Review the branch independently, fix findings.
7. Commit, push and non-force advance main; deploy migrations/web/API; publish OTA; build and submit exact iOS build; record terminal evidence per release track.

## Review focus
- Current assignments and session versions, not stale signed role claims, control access.
- Concurrent visit changes or transfers cannot produce a false acknowledgment.
- Failed authentication and transaction rollback cannot log out the outgoing user.
- Lost network response and process restart preserve recoverable handoff identity.
- Cached data is user/site scoped and never authorizes offline writes.

## Verification
- Baseline: clean checkout `aec75605708e47ec6409e243795de5bc0b7ca9d4`, equal to origin/main. Isolated worktree used; dependencies installed from the pinned lockfile.
- Independent review resolved supervisor event/photo access, abandoned-shift recovery, native session persistence consistency, and selected-gate navigation (including already-mounted iOS tabs).
- Root typecheck and EN/ES parity passed. Production web and API builds passed.
- Shared library suites passed. Web: 1,256 passed, 3 existing skips. iOS: 1,006 passed.
- API: 3,088 passed in the full final run, 53 existing skips. One new test hook accidentally returned a mock as a cleanup function; after correcting that test-only callback, all three AI-summary tests passed. The resulting API coverage is 3,089 passing cases.
- API integration covers migration replay, RLS, current permissions, wrong-site/inactive users, authentication without session replacement, atomic transfer and rollback, competing transfers, stale/cancelled/expired preparations, immutable history, carry-forward items, supervisor recovery, askV grounding/access, and unused-site cleanup without deleting shift history.
- Real-browser Change Over smoke passed across two separate vendor accounts, including incoming authentication, acknowledgment, ownership transfer and opening the second gate's notes.
- Full browser regression suite: all 43 scenarios passed, including Change Over, visitor check-in/out, managed workers and real internal Work Hub audio.
- Release evidence will record the exact remote commit, web/API/migration workflow results, OTA group and exact native build/submission separately.

## Operational boundaries
- Counts remain explicitly site-wide because existing authoritative visit/check-in records do not carry a gate identifier. Gate ownership, shifts, notes and action items are station-specific.
- Offline clients can read records already loaded in their current session; transfers and incoming authentication require a connection and are never queued. Reconnection or activity changes discard prior review/authentication.
- Lost transfer responses recover via normal incoming-user login and persisted Shift Notes. An unavailable outgoing operator can be replaced only by an authorized supervisor explicitly accepting responsibility with an audit reason.
- History is retained independently of the seven-day default display filter. Existing public Sign Out remains separate.
