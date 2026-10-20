# Task 9 — Dispatch Board, Run Builder, ticket continuity

## Delivered

- Added a scoped, idempotent Dispatch plan contract stored additively in the existing Fleet state. A plan can be saved as `waiting_on_yard` without a driver, vehicle, Detail, Run, or billable ticket. A non-billable Office-review draft cannot be released until Office attaches an eligible existing authorized ticket. This does not create or advance a ticket.
- Added Dispatch Board cards for authorized work, default yard → job → return routing, ordered multi-stop cycles and saved Run templates, Yard Detail requests, driver/Detail selection, review, release, and canonical Run readback. Selected Yard Orders must be scoped to the company and Detail; a selected order must report `ready` before the plan becomes ready. Advisory compliance warnings are displayed without becoming a dispatch gate.
- Kept the canonical Run-level driver requirement. The selected driver is bound to a reusable driver-free Detail at snapshot time; Run creation and dispatch still require a ready assignment and existing billing validations. The plan is marked released only after the canonical Run is dispatched with matching route, Detail, driver, billing site, and linked ticket.
- Added exact-operation retries/readback for plan creation, Yard requests, Office ticket attachment, Run release, and pre-start reassignment/redispatch. Reassignment uses the canonical Run action and verifies the linked ticket identity is unchanged.
- Added an Office card for attaching authorized work to a non-billable draft and handing submitted/completed Runs to existing v2 commercial charge review or legacy ticket finalization. Dispatch and Office FleetShell fallbacks now open these cards.
- Updated the Task 8 work-creation fixture to save a reusable Detail with `driverUserId: null` and explicitly select the Run driver for its snapshot. Separate legacy driver-bound Detail coverage remains in `fleet-details.database.test.ts`.

## Verification

- Dispatch/Office/FleetShell/Yard/Run Plan/Run Billing/Run Orders/Ticket Finalization mobile tests: 8 files, 55 tests passed.
- Dispatch plan API unit tests: 5 passed. Schema/route tests: 13 passed.
- API server typecheck, mobile typecheck, library typecheck, and `lint:i18n`: passed.
- `git diff --check`: no whitespace errors in Task 9 files.
- The database-backed Fleet suite was attempted through the repository's old wrapper, which initialized its isolated `postgres_test` database but could not satisfy the current fresh-local provenance requirement; all test bodies rejected before running. `VNDRLY_TEST_DB_MAINTENANCE_URL` is not configured. No shared development or production database was changed. The parent integration batch should run those tests only against an approved fresh local test database.

## Continuity and boundaries

- Existing canonical Run, ticket status, reservation, Yard substitution, driver closeout, and Office charge-review writers remain authoritative. This task adds orchestration, not a second ticket state machine or billing writer.
- No new database migration or external dependency was introduced. Dispatch plans use additive optional fields in the existing Fleet state document.
- No production push, API migration, OTA, or TestFlight release was performed in this task; those belong to the parent release stage.
