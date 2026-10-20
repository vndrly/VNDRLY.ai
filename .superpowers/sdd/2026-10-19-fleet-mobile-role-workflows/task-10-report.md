# Task 10 — Driver Fleet Day, self-dispatch, return, and offline recovery

## Delivered

- Added `DriverFleetDay` as the Fleet shell's Driver module. It keeps the existing canonical assigned-run workflow as the single run/action surface while applying the approved Work Hub card treatment.
- A Driver with Yard capability can open the exact assigned Yard Order and complete hookup before returning to the same Run. An independent Driver with Self-Dispatch capability receives the same Yard action without requiring separate Yard staff.
- Existing run actions remain authoritative for accept, inspection, ordered stops, evidence, return, and closeout. Return defects are explicitly advisory: they affect Fleet score but never block ticket flow or the closeout action.
- A return-required closeout now atomically records the truck and snapshotted rigging as returned, clears driver custody, and creates one idempotent Yard verification follow-up for condition, detach, transfer, or discrepancy review. The follow-up remains advisory and does not block ticket submission.
- Return reconciliation locks current custody and returns only assets still reserved, attached, or in transit for the same Run or Detail. Components already detached, transferred, or replaced retain their canonical custody and are listed in the Yard discrepancy follow-up instead of being reclaimed from historical snapshot data.
- Offline return observations use the driver's verified capture time while custody-event receipt time remains server-owned. A newer canonical custody observation produces a conflict/readback response before any custody mutation, preventing delayed sync from overwriting later asset movement.
- Hardened retained replay with the original user, company, membership, and verified session. A context switch revokes the replay before any canonical read or submit. Operation IDs and original facts remain unchanged.
- Preserved pre-upgrade retained work: legacy v1 records that already contain `membershipId` import through the strict reader, while records created before that field existed receive an in-memory membership normalization only after their enclosing document scope is verified. Original stored bytes are never rewritten.
- Preserved existing unknown-outcome recovery: replay reads the canonical Run and its operation receipts before any submit, accepting an already-saved operation without duplicating it.
- Reused the established encrypted journal, evidence, and phone-location collectors. They already bind original work to account/device/provisioning scope and bind location sharing to the current Run assignment, truck, and attached rigging snapshot.
- Added Spanish Fleet copy for the Driver Day, Yard handoff, advisory warning, return, and recovery guidance.

## Verification

- Correction focused suites: 47 mobile tests and 31 API tests passed, including return handoff, offline upgrade, context switch, and single-primary-action regressions.
- API and mobile TypeScript checks passed; localization parity passed.
- `git diff --check` passed.

## Boundaries

- No new offline queue, ticket state machine, billing writer, database migration, or dependency was introduced.
- No ticket status/lifecycle is inferred in the mobile UI. Run and ticket writers remain server-owned.
- No development or production data was modified.
