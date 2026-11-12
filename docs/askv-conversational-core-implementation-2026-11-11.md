# Ask V conversational core continuation

## Authorized direction

Continue the work-machine review locally: retain VNDRLY business records,
permissions and canonical application actions; evaluate and improve the shared
conversation/task layer using Gate operations first. Do not replace the entire
application or claim physical-device acceptance from unit tests. Preserve the
MidCon notification hold. Use synthetic fixtures for operational writes.

## Recovered baseline

- Review: `docs/askv-comprehensive-review-2026-11-11.md`.
- Actual inventory: `docs/askv-tool-inventory-2026-11-11.csv`.
- Prior observed acceptance: `docs/askv-workflow-acceptance-2026-11-11.md`.
- Local main fast-forwarded from `0bf5f3c6` to
  `872424888c66458c7f15fd5237c3da3d800444b8`, matching fetched origin/main.
  The checkout was clean before this continuation. Local configuration retained.

The review's baseline defects are not all current defects: its final checkpoint
records subsequent repairs. Current source contains dynamic pack installation,
bounded organization-scoped observations, exact confirmation references,
disconnect cancellation and native shared-reasoning transport support.
These are components to reuse, not evidence that every workflow is accepted.

## Implemented Gate core

- Reused existing session permissions, canonical Gate APIs, confirmation binding,
  durable operation reservations, conversation storage and provider selection.
- Added read_gate_task and update_gate_task to the shared Gate pack. Drafts are
  scoped to actor, company and conversation. Corrections patch fields, normalize
  plate states, retain unchanged details, invalidate pending approval and require
  the current version. Page changes never silently retarget a draft.
- Draft execution reserves before the business request, outside the business
  transaction. Concurrent calls cannot submit the same draft again. A delayed
  result cannot overwrite a newer task. A different payload cannot reuse a saved
  draft outcome. Completed and uncertain task results survive server restarts.
- Added query_gate_visit_movements and confirm_gate_visit_movement for enter,
  leave and route on the existing property visit. These reuse current access,
  active-gate, topology, row-lock and operation-replay checks. Outer departure
  continues to use the property checkout endpoint.
- Movement saves require exact operation/visit/gate/destination readback. A lost
  response or server error is followed by a read, never a replacement write.
  read_gate_task can reconcile an uncertain movement by its original operation.
- Added a minimal Gate receipt read using the same current Gatekeeper role,
  contracted site and temporary-watch scope as the write. The general host-detail
  route is not used for save verification. Revoked roles and uncontracted sites
  are denied, including sessions with legacy role labels.
- Check-in/out reject missing, failed and mismatched receipts. Success requires
  an authorized visit readback matching the saved identity and timestamps.
  An inner departure is never announced as a property checkout. A receipt whose
  readback was interrupted can be reconciled read-only on resumption.
- Web text and native shared reasoning use the same dispatcher; legacy realtime
  now passes the server-owned conversation identity to that dispatcher too.
- iOS prepared Gate forms now retain the selected station and resolve it against
  the newly selected site's authorized station list.
- Check-in schemas now accept explicit named or inner-Gate destinations from
  authorized reads; the resolver retains these in its proposed draft.

No dependency, database migration, production mutation, notification resumption
or production deployment is included. Existing Next Steps guidance and registered
workflows remain available; this does not claim a new Next Steps-to-task UI bridge.

## Verification

Focused automated checks observed during development:
- 166 tests across eight server files passed before the final recovery additions.
- 94 tests across nine server files passed with recovery additions, including
  durable reservation, correction, canonical receipt verification, existing
  confirmation/idempotency, saved Gate proof and manifest coverage.
- 31 tests across three mobile files passed (Gate screen and client handoff).
- These are synthetic/mocked tests, not a production-data exercise.

Cloud run 43146855100 passed all 2,447 web and 2,221 mobile tests.
Cloud run 43148978768 passed compilation/locale checks, the full selected Ask V
suite (including the three PostgreSQL draft tests), and the canonical Gate suite.
The subsequent normalized-role receipt route passed both focused Gatekeeper and
supervisor tests locally; its cloud recheck is tracked on the review branch.
No production data was used.

## Remaining acceptance limits

This is a Gate-first improvement to the shared core, not a claim that every Ask V
workflow has been rebuilt or accepted. Model selection is unchanged. Real spoken
web/iPhone acceptance, an old-versus-new model comparison for unnecessary
questions and latency, and isolated database-backed scenario results must be
reported separately from unit tests.

A property check-in whose response is lost before any visit ID is received cannot
be conclusively recovered by this adapter: that canonical endpoint does not have
an operation-ID receipt lookup. It remains uncertain and blocks automatic replay;
it never guesses from a similar person or plate. Movement operations do have an
exact operation identity and support automatic read-only reconciliation.

No broad release or live-service restart is implied by this implementation.
