# Fleet tickets and reusable destinations

Approved behavior: Company → Site → Ticket → Runs. Fleet Map always renders a base map, opening on the saved company position. A selected originating site centers the map and narrows authorized resource/run lists. No idle equipment position is inferred from company or site coordinates.

A transport ticket locks one originating site, vendor, partner, billing mode, per-run rate and currency. Batch tickets contain multiple runs; Singles tickets accept one run. Destinations are separate run stops, not additional ticket job sites. Approved destination records are copied into the ticket plan and selected run stop so directory edits do not alter history. Company defaults apply unless the partner site specifies a requirement. Configuration is permitted before operational work; existing unrelated tickets/runs remain compatible.

Implementation: additive JSON columns on existing vendor/partner/site/ticket records; reuse existing Fleet run repository, session/grant checks, operation IDs, version checks and audit snapshots. Completed/accepted runs contribute per-run billing lines exactly once under the existing office approval workflow. No payment, accounting push or irreversible external transaction is initiated by this feature.

Reusable directory fields: name, type, business address, coordinates, materials, instructions, hours, active state, revision. Partner-owned locations are visible only through authorized partner/site relationships. Nearest suggestions are distance estimates and never assert unverified capacity or truck-safe routing.

Validation: scope isolation, frozen ticket origin, Singles uniqueness, completed run line deduplication, immutable destination/rate snapshots, terminal ticket rejection, stale operation handling, map with zero GPS, company/site/ticket filtering, and native/browser UI checks. Use synthetic isolated tests; no production reseeding or credential changes.
