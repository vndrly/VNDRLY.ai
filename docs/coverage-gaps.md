# Calendar coverage gaps

The Administrative functions selector opens a company-wide coverage list on the left and Coverage Resolution on the right. This view does not require selecting a site first.

Categories use recorded evidence:
- New / Unassigned Recurring Shifts: one collapsible category with a combined entry total. Dated shifts with unassigned positions show "Needs gatekeeper"; locations without dated shifts in the selected range show "Needs shift setup".
- Temporary coverage: an assigned worker has recorded unavailability or an inactive/suspended account. Private reasons are not inferred or displayed.
- Permanent vacancies: the assigned vendor-person record is retired.
- Coverage requests: a gatekeeper has requested cover for one of their own dated shifts.
- Urgent gaps: an existing coverage record is at risk or escalated. An alert does not by itself prove a worker is absent.

Temporary replacement affects one dated shift and records the original recurring owner. Permanent replacement affects the same weekday, gate, timezone, and start/end times from the selected date forward, including matching dated shifts created later. Other weekdays and earlier shifts are unchanged. A temporary cover remains a dated exception.

The gatekeeper selects a day on their calendar and uses My shift coverage. A request leaves the original assignment in place until an administrator confirms a replacement. Requests are scoped to the signed-in user. The request itself does not send email or remove an assignment.

All resolutions require review. The API rechecks current access, versions, site eligibility, recorded availability, qualifications, scheduling policy, and cross-company overlap in the assignment transaction. A conflict aborts the save. Historical/completed shifts are not modified through this workflow.

## Local verification and storage

The local preview on port 8098 defaults to read-only database transactions. Set `VNDRLY_COVERAGE_WRITES=1` deliberately to enable only the reviewed coverage-resolution and own-shift coverage-request POST endpoints. Write requests require an allowed localhost origin, JSON, and a current session validated by the production issuer. Other writes remain disabled. No application background workers run in this preview.

Run `pnpm --filter @workspace/api-server run migrate:coverage-resolutions` with the intended database environment to provision coverage storage. The migration applies additive pattern metadata and durable exception/ownership records transactionally; it does not modify shifts or assignments. Production API deployment runs this replay-safe migration explicitly. It is not an application-startup migration. Coverage saving requires the storage to exist.

Tests must not submit changes to existing shifts or assignments. The persistence integration suite requires a fresh isolated loopback database and verifies temporary saves, idempotency, permanent future ownership, and transaction rollback. Never point reset or seed scripts at the shared database. Local browser verification may prepare and review a resolution, but must leave it unsaved.

Focused checks: coverage-gaps.test.tsx, shift-assignments.test.tsx, shift-assignment-model.test.ts, site-shift-administration.test.tsx, coverageWorkflow.test.ts, coverageWorkflow.integration.test.ts, coverage-rules.test.ts, workHubSiteShiftPlans.test.ts, and site-schedule-policy.test.ts. Run the required release gates before deployment.

