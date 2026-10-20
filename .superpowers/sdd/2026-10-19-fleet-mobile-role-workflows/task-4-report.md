# Task 4 report: Yard Orders and asset custody API

Status: implemented locally with review-round-1 corrections. Focused in-memory verification passes; the prior-commit API typecheck passed, while current-tree typecheck is reserved for the parent's batched gate. Fresh-local database execution remains pending because this shell does not have `VNDRLY_TEST_DB_MAINTENANCE_URL`. No shared development or production database was read or modified.

## Delivered

- Added company-scoped Yard create/update/list, Yard Order create/list/detail/actions, custody read/operations, and Yard resource suggestions on the Fleet API routes. Yard Orders retain their scheduled time and existing Run/Detail references. They do not change ticket or Run status.
- Added version checks and operation replay for Yard saves, Yard Orders, and custody. Yard Order and custody events are append-only. Operation receipts are kept in the existing action audit so replay returns the original canonical result; bounded Yard events keep a compact decision summary.
- Added authorization using the current Fleet repository transaction and stored capability override. Assignment requires a current company member with Yard/Admin capability and a Fleet grant. Driver-app custody writes require the Driver's own current Run and asset. Asset reads and writes remain within company and Fleet grants.
- Added gate scan, GPS geofence, manual, and Driver-app custody sources. GPS observations require a coordinate pair. Attached rig components inherit their truck location only for the selected Detail; transfer/detach stops inheritance. Suggestions surface co-location and reservation reasons, and preserve unavailable alternatives as advisory results.
- New reusable Detail saves no longer require or store a driver. An optional selected Driver on the Detail snapshot read creates a Run-bound historical snapshot without changing the saved Detail. Reservation matching compares transport identity independently of that selected Driver and still checks the Driver grant, active company person, and asset conflicts. Historical driver snapshots remain readable.
- Yard assignment and report events notify the assignee/requester after commit with an operation dedupe key. Notification failure does not erase the committed canonical operation.

## Verification

- Observed the first Yard tests fail because the service did not exist. Observed the driver-free Detail save test fail with `fleet.driver_grant_required`, the reservation identity test fail with a missing comparison helper, and the attachment test fail by selecting the wrong truck. Implemented each behavior after its failing test.
- `pnpm --filter @workspace/api-server exec vitest run src/services/fleet-yard.test.ts src/services/fleet-details.test.ts src/services/fleet-reservations.test.ts --no-file-parallelism` with environment loading disabled and an unusable loopback database URL: **3 files, 17 tests passed**.
- `pnpm --filter @workspace/api-server typecheck`: **passed**.
- Authored `fleet-yard.database.test.ts` for fresh-local verification of multi-yard intake, source methods, assignment, substitution, outcomes, version conflict, replay, and company isolation. It was not executed here. The repository `test` wrapper's non-fresh mode resets a test schema, so it was intentionally not used without the explicit fresh-local maintenance URL.

## Pending controlled gate

With an approved loopback `VNDRLY_TEST_DB_MAINTENANCE_URL` set privately, run the brief's focused command under `VNDRLY_TEST_DB_MODE=fresh-local` and `VNDRLY_LOAD_ENV_LOCAL=0`:

`pnpm --filter @workspace/api-server test -- src/services/fleet-yard.test.ts src/services/fleet-yard.database.test.ts src/services/fleet-details.test.ts src/services/fleet-reservations.test.ts`

The existing broader Detail database fixtures still submit legacy driver-bound Detail saves. Those fixture flows need migration to driver-free Detail saves plus explicit snapshot Driver selection before the broader database suite can be treated as a parity gate. No production migration, online publication, or full ship was attempted in Task 4.

## Review round 1 correction (2026-10-20)

- Yard Order create/list/detail/action/replay now check the actual target Fleet and Run site scope. Creation captures the complete referenced Detail/Run equipment set into the order's immutable requested assets; assignees must hold the target Fleet and relevant Run sites. Orders without a canonical Fleet target are rejected. Self-Dispatch can create and self-assign an order for its own active Run, then start/report only its own assigned order; Driver-only and other-work paths remain denied.
- Driver custody read/write/replay and receipt read now require an active assigned Run with an unreleased reservation, no competing active equipment assignment, a current Fleet/site grant, and no different Inventory holder. `submitted_for_review` remains eligible for end-of-run return/check-in; completed/cancelled Runs are not. The equipment set comes from the immutable Run assignment, including every rig component, with legacy truck/trailer fallback.
- Every new `attached` observation saves the actual truck, Detail version, and rig-package version in its append-only operation receipt. Readback joins that exact custody event and receipt, so later Detail revisions or package archival cannot move an attached component. Legacy attached observations without the immutable event metadata fail closed by not inheriting a truck; explicit transfer/detach still ends inheritance.
- Driver + Self-Dispatch may list and snapshot driver-free reusable Details only for their own selected driver identity; it does not gain configuration write authority or general Dispatcher visibility. Historical driver-bound snapshots remain readable.
- Added owned operation-specific readback routes for Yard save/order and custody receipts. Each read rechecks current company, target Fleet, assignee/actor, or active Driver authority.
- TDD evidence: new cross-Fleet order listing and full-rig custody regressions failed before the service fixes; the self-dispatch Detail test failed before its authorization fix. Final focused command, with `VNDRLY_LOAD_ENV_LOCAL=0` and an unusable loopback `DATABASE_URL`: `pnpm --filter @workspace/api-server exec vitest run src/services/fleet-yard.test.ts src/services/fleet-details.test.ts --no-file-parallelism` — **2 files, 24 tests passed**. Additional in-memory probes cover assignee isolation, lost-response receipt readback, stale/superseded Runs, Inventory holder conflicts, all rig components, immutable attachment location, and self-dispatch own-work denial cases. `git diff --check` passes. Per parent direction, no unchanged package/API typecheck was repeated in this correction; it remains part of the batched gate.
