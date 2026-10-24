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

The local preview on port 8098 allows GET requests only and uses read-only database transactions. It must stay that way for testing against the shared database. UI tests and API tests mock saves; do not run database reset or seeding scripts.

`lib/db/drizzle/coverage_resolutions.sql` adds durable exception/ownership records. It is intentionally not applied on server startup. This change was prepared locally and has not been applied to Supabase. Resolution saving fails closed until that table is deliberately provisioned in the intended environment. Nothing in this feature authorizes deployment or altering existing assignments during testing.

Focused checks: coverage-gaps.test.tsx, shift-assignments.test.tsx, shift-assignment-model.test.ts, coverageWorkflow.test.ts, coverage-rules.test.ts, workHubSiteShiftPlans.test.ts, and site-schedule-policy.test.ts. Full API typecheck was stopped because it made the local machine unresponsive; it is not claimed as passing.
