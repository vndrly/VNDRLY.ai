# Task 8 report: Yard Board and Asset Workspace

Status: implemented and committed locally. No online release was requested or attempted.

## Delivered

- Replaced FleetShell's Yard and Assets legacy fallbacks with focused Work Hub-style cards. The Yard module opens the exact preserved `yardOrderId`; the Assets module preserves an asset deep link, including an asset missing from the first Inventory page.
- Added Yard Order request, self-assignment or authorized assignment, start, component review, advisory substitutions, damaged/missing findings, readiness reporting, and canonical action readback. The three outcomes remain selectable when findings exist. A lagging readback retains the original operation for retry.
- Added narrow Yard asset intake, reusable Detail/rig package access, Yard placement and transfer, attach/detach, Driver self-check-in, latest custody/location evidence, and manager Inventory history access. Custody writes retain their operation identity and verify receipt plus current readback. Attached rigging shows inherited truck location.
- New reusable Detail saves now contain `driverUserId: null`; Driver selection remains on Runs. Legacy Details with an embedded Driver remain readable and are labeled historical.
- Current company, member, and session scope are verified before actions. Foreign Yard data is rejected, and access revocation clears protected actions. A Yard worker cannot start another worker's assigned order.

## TDD and verification

- Observed new Yard/Asset suites fail on missing modules, new Detail test fail on the permanent Driver selector, and shell routing test fail on legacy fallbacks. Additional failures reproduced foreign-Yard visibility, deep-linked asset loss, missing substitution/condition and detach controls, stale Yard readback, another worker's action visibility, and retained controls after access revocation before each fix.
- `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/YardBoard.test.tsx components/fleet/AssetWorkspace.test.tsx components/fleet/FleetShell.test.tsx components/FleetInventory.test.tsx components/FleetDetails.test.tsx components/FleetDetailsLibrary.test.tsx`: **6 files, 46 tests passed**.
- `pnpm --filter @workspace/vndrly-mobile typecheck`: **passed**.
- `git diff --check -- artifacts/vndrly-mobile/components`: **passed**. Broad mobile and root gates remain with the parent's post-Task-11 batch.

## Boundaries

- No production API, database, external accounts, or release state was changed. Live role-account acceptance is pending the parent integration task.
- The Yard API exposes current custody plus an immutable Yard Order event history; the asset card labels its latest custody observation accurately and links to the existing Inventory history. The server does not currently expose a full Fleet custody event-history read endpoint.

## Review round 1 (2026-10-20)

- Added `/api/fleet/yard-assets` for Yard-scoped read, exact asset lookup, pagination, and intake into one granted Fleet group. Driver Self-Dispatch read is limited to the current assigned Run and holder boundary. This uses current stored capabilities and existing company/grant boundaries without extending manager Inventory authority. A receipt endpoint supports exact recovery after an uncertain intake.
- Bound unresolved Yard actions to their displayed order and disabled switching during in-flight or uncertain work. Transport retries check the operation receipt first; definite 409 conflicts clear the rejected operation, refresh the current version, and retain worker findings/reasons for explicit reapplication. Custody uses the same conflict/recovery distinction and exact selected-asset readback.
- Labeled each requested component with name, tag/category, and ID; missing/damaged controls and substitute mapping name the original and replacement. All findings remain advisory. Added searchable, paginated assets and exact custody reads so older observations are not mistaken for version zero.
- Moved Yard request date/Run-ID/schema validation into the handled action path with correction messages and editable draft retention. Added Spanish copy for the new Yard and custody cards, controls, notices, statuses, and parameterized component/replacement labels.
- Focused verification: mobile Yard/Asset suites **2 files, 25 tests passed**; Yard service suite **1 file, 37 tests passed** using an inert loopback database URL (no database was touched). Mobile and API package typechecks passed. Broad gates are delegated to the parent integration batch.
- Remaining integration boundaries: full Fleet custody event-history readback is not yet exposed; pending action refs are not durable across app unmount/restart or represented in Pending Sync. No production or external state changed.
