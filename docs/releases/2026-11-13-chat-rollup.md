# November 13 chat rollup

Release instruction: "roll up any unimplemented tasks from this chat and implement them now then do a full ship minus plug in".

## Included changes

- Dashboard: Ticket Status replaces the duplicate Tickets card; Ticket Tracking
  uses the same status panel. Gate Locations count sits in its header, History
  has MORE, and Safety program sits beside it. Hotlist controls align right and
  use the shared Live indicator; titles and Library link follow the requested style.
- Safety: concise Assessment Incomplete label, full-width inner tile and two
  actionable service/role training recommendations from saved server projections.
- Credentials: 50 researched external credential types, scope-specific fields,
  optional issue date, number/expiry and private card/PDF upload through the same
  office and personal-profile form. Reviewed external or internal training
  satisfies the same requirement once, with expiry/revocation/version checks.
- Maps: Gate Locations reuses Gate Map's authorized choices, centred selector,
  staff/activity columns and administrative card. Site radius is one circle per
  site, independently toggled; obsolete per-gate circles and duplicate fit control
  are removed. Dropped pins have separate details/move actions.
- Gate administration: shared always-visible Details, Site/Spur and Location;
  right-aligned Create/Edit selector; mini-card Next Steps; compact flyout header;
  name-only Save; GPS with save opposite; inactive/remove on a second row.
- Destinations: list, create and details views; GPS capture; Add/Cancel returns to
  list; Remove is in details; no default-destination or assigned-gate picker.
  Configured destinations follows the location controls.

The earlier curriculum publication and Ask V work are retained, not regenerated.
The task-revival discussion was a question, not an implementation instruction.
No customer gate names, assignments, completions or notification holds are changed
by this rollup. San Roman's corrected site centre/radius and prior pin removal are
existing data, not replayed as a seed.

## Validation and publication

Focused checks cover the changed map, gate, destination, ticket, credential and
credit behavior. Full required checks run on the release branch in cloud runners,
including an isolated API test database. The release ledger records actual
workflow and runtime evidence separately; this document is scope, not a claim
that publication has completed. Plugin is explicitly excluded; TestFlight and
canonical local synchronization remain required.
