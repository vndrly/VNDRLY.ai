# Task 4 report: Yard Orders and asset custody API

Status: implemented locally; focused unit verification and API typecheck pass. Fresh-local database execution remains pending because this shell does not have `VNDRLY_TEST_DB_MAINTENANCE_URL`. No shared development or production database was read or modified.

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
