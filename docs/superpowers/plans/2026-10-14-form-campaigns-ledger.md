# Form campaigns execution ledger
- Spec and direct implementation plan approved by user. Existing preview worktree retained; prior uncommitted UI/task changes preserved.
- No shared DB migration, employee notification or policy publication authorized by implementation. No actual MidCon policy content supplied.
- Task 1 started: clock-injected deadline/configuration/response rules and shared contracts.
- Task 1: deadline/response policy tests observed RED then GREEN (4 passed); DB/API-Zod declaration build passed. Additive migration prepared but not applied.
- Tasks 2/3: current-membership/session guards, draft/publish/pause, audience snapshot, response history, canonical receipts, late acknowledgement, anonymous result projection and legacy-submit delegation implemented locally. Policy snapshot downloads copy verified private bytes at publication and redact storage locators. No live storage copy performed.
- Task 4: injected clock tests observed RED/GREEN for daily briefing, DST, duplicate-date suppression, exact poll close, rolling cutoff and optional escalation. Worker uses template row locks, SKIP LOCKED and notification dedupe. Fair next-work ordering avoids a fixed first-batch starvation.
- Ruling: private policy file copy uses existing object store, deterministic content-hash key and current assigned-instance download authorization. Failed DB publication can leave an unreferenced private object; source file is never deleted or overwritten. No claim of transaction-backed external-storage rollback.
- Ruling: keep generic governance exports limited to ordinary forms; campaign result projections enforce anonymity and closing visibility. Dedicated aggregate export remains to be wired before calling result-export support complete.
- Current safe test evidence: deadline/policy 4 passed before additional publication test; access 1 passed; schedule 3 passed; projection 3 passed; AskV confirmation mapping 1 passed. API/mobile typechecks passed before latest attachment/workspace edits, final checks pending.

- Task 5: native/web campaign creation, exact assigned routes, acknowledgements, polls and existing reusable forms implemented. Supported reusable source fields: text/textarea/number/checkbox (unsupported definitions fail explicitly). English/Spanish labels and locale parity passed. Native published attachments use protected snapshot download.
- Task 6: 9 campaign tools, 3 embedded views and unchanged-identity plugin candidate 1.13.0 packaged; package checker passed. Installed plugin was not changed. Unpublished MidCon example stored in docs/examples/midcon-security-campaign-draft.json without actual policy content.
- Dedicated owner CSV exports support authorized turnout/results and named reusable-form answers; anonymous answers are excluded. User-triggered native share sheet shares counts/link only, never individual answers.
- Fresh whole-feature reviewer completed with three findings: native read-route race, legacy raw-template metadata leak, missing general-form owner answers. Fixed in one pass with native hook ID/path tests, legacy campaign exclusion, named form projection/export and UI answers. No second reviewer requested.
- Web full suite: 1606 passed, 0 failed, 3 skipped before review fix pass; targeted revalidation follows. Focused route tests 3 passed; employee screen tests 3 passed; path-race/mismatched-instance hook tests 2 passed; projection/export/route checks 9 passed.
- Quiet-hours scheduling now uses campaign IANA timezone and UTC-minute search over DST transitions; RED/GREEN schedule suite 4 passed.
- Remaining verification boundaries: no isolated PostgreSQL transactional/concurrency/e2e tests, no real iPhone or push proof, no deployment/production migration/installed plugin update. No real policy publication or notifications performed.

- Full mobile run: 1845 passed, one completion test timed out importing the shared package inside its five-second body. Reproduced; moved imports to setup. Corrected completion plus hook/response/locale checks: 16 passed. No skipped assertion or increased timeout.
- Final focused API/embedded workspace/assistant tests: 119 passed, including anonymous-view suppression and exact identifier checks.
- Publication review includes a server-derived current audience count and estimated deadline; both are revalidated at actual publication.

- Final API, native and web TypeScript checks passed after review fixes and publication-preview changes. Locale linter, plugin package checker and staged whitespace check passed. Existing approved task-assignment/native command-envelope fixes are included as campaign integration prerequisites; unrelated Meetings/Fleet/Chat edits and deployment scripts remain outside this commit.
