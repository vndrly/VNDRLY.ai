# Task 8 report: Yard Board and Asset Workspace

Status: implemented and committed locally. No online release was requested or attempted.

## Delivered

- Replaced FleetShell's Yard and Assets legacy fallbacks with focused Work Hub-style cards. The Yard module opens the exact preserved `yardOrderId`; the Assets module preserves an asset deep link, including an asset missing from the first Inventory page.
- Added Yard Order request, self-assignment or authorized assignment, start, component review, advisory substitutions, damaged/missing findings, readiness reporting, and canonical action readback. The three outcomes remain selectable when findings exist. A lagging readback retains the original operation for retry.
- Added asset intake through existing Fleet Inventory, reusable Detail/rig package access, Yard placement and transfer, attach/detach, Driver self-check-in, latest custody/location evidence, and Inventory history access. Custody writes retain their operation identity and verify receipt plus current readback. Attached rigging shows inherited truck location.
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
