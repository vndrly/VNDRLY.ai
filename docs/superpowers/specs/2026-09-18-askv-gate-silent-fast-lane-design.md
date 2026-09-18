# Ask V Gate Silent Fast Lane Design

## Goal

Make Ask V faster than manual Gate entry. A short command such as “New check in, Oklahoma plate ABC123” must immediately prepare the Gate form using authoritative current location plus the latest submitted visit for that exact plate. Ask V stays silent after a successful prefill and the gatekeeper remains responsible for reviewing and submitting.

## Operating contract

- Gate commands are tool-first. Ask V does not explain capabilities, restate the request, or narrate successful prefill.
- One short clarification is allowed only when the available data is genuinely ambiguous or a required fact cannot be resolved.
- Ask V never submits a Gate check-in or check-out. The signed-in gatekeeper always performs the final action.
- A successful prefill returns a silent-response marker so web and iOS do not request another spoken model response.
- Errors and genuine ambiguity may produce a concise spoken response.

## Check-in resolution

1. Resolve the signed-in gatekeeper's GPS against assigned sites.
2. Lock the lease/location context to that GPS result. It is not user-selectable.
3. Limit the rig/well selector to assigned sites for the same partner whose geofence contains the current GPS; fall back to the nearest assigned site.
4. Match plate history using normalized plate state and plate number.
5. Prefill the most recent submitted visit's driver, company, purpose, expected duration, and rig when the rig is still one of the current local options.
6. Treat historical driver and rig as editable suggestions, with provenance. A draft never becomes future history; only a submitted visit does.
7. Derive the host from the selected site's lease-holding partner. Do not expose Host in the Gate form or Ask V workflow.

## Check-out resolution

Ask V locates active visits using the spoken person, company, or plate. One exact match is selected silently. Multiple matches cause one concise choice prompt. Ask V never performs the final check-out.

## API and permissions

- Realtime setup receives the current path and applies strict Gate instructions on Gate surfaces.
- Gate realtime tools expose lookup and draft preparation, but not submission tools.
- Gatekeeper check-in derives the partner host server-side from the selected site. Legacy host fields may remain accepted for compatibility but are not trusted as the Gate source of truth.
- History resolution is scoped to the signed-in gatekeeper's assigned sites and uses a bounded server query rather than loading and filtering the full visit history.
- Existing session, site assignment, audit, and idempotency boundaries remain unchanged.

## Web and iOS parity

Both clients use the same silent tool-output contract, GPS-locked location, local-rig options, history backfill rules, hidden host field, editable suggestions, and manual submission boundary.

## Verification

Focused tests cover Gate instructions, tool availability, bounded history resolution, server-derived host, silent realtime handling, client intent provenance, GPS/local-rig selection, web Gate, and iOS Gate. The release then passes locale parity, typecheck, web, API, mobile, and production builds before the full-ship lanes run.
