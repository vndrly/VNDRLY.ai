# Shared Equipment Implementation Plan

> For agentic workers: implement the approved equipment requirements across the existing inventory, API, web and native iOS; preserve existing custody and tenant boundaries.

**Goal:** Give Field, Gate and Fleet one equipment inventory with map visibility, job assignment, custody, photos, connected components and trustworthy location history.

**Architecture:** Extend existing assets with additive equipment metadata. Existing asset IDs, custody policies and audit events remain authoritative. Share API contracts between web and iOS; show current, manual and last-known observations distinctly.

**Spec:** User approved the six equipment considerations in chat and requested implementation, including staff check-out/check-in for tickets/tasks and office/admin assignments.

**Constraints:** No dependencies, destructive DB changes, credential changes, unrelated refactors or deployment. Only guarded additive migration; no schema-reset test wrapper. Preserve all earlier Gate Map geometry and visibility controls.

- [ ] Backend: shared equipment contracts; same assets identity, metadata, policy-bound custody, tenant-scoped job/person validation, idempotent commands, cycle-safe attach/detach and retained drop location; guarded migration.
- [ ] Web: shared inventory equipment workbench and branded forms for add/edit/photos/tracking, assignments, check-out/in, connections and observations/history. Preserve advanced existing inventory tools.
- [ ] Map: Reveal Equipment beside Reveal Staff; hidden by default, compact SHOW/HIDE; type/activity categories; known positions only; focus group or individual; detail popup links into same inventory.
- [ ] iOS: shared workbench in Work Hub and Field/Gate entry points; camera/photos; same server rules; equipment reveal/selection on native map.
- [ ] Verify: rejected cross-company relations, unauthorized assignment/custody, duplicate retries, version conflicts, holds/policies, stale GPS, attach cycles and detach location retention; focused UI tests, batched typechecks, additive migration readback, served browser proof at wide/375px.
