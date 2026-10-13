# Web parity for the October 12–13 iOS rollout

These changes are in the release working tree. Local verification is separate from deployment and live verification.

| iOS surface | Web implementation | Permission and evidence boundary |
|---|---|---|
| Daily workspace: Calendar / My Work / Needs Attention / Safety | Work Hub Activity now exposes the four destinations, an actual own-work task/ticket/assigned-run list and pending Safety records. Existing Activity priorities, notifications inbox and Safety forms remain available. | Each source is authenticated; company categories select Field/Fleet sources. Failed sources show partial coverage, capped Safety lists disclose the cap. Reads never acknowledge or close an incident. |
| Unified Work Calendar | Existing day/week/month calendar now merges scheduled Field tickets and Fleet runs, preserves canonical record links and includes their type filters. Fleet cursors are fully read. | Company-category, actor and active-membership scoped cache keys; canonical assigned-ticket schedule endpoint; unavailable sources are explicit. No schedule is invented for unscheduled records. |
| Shift / On Call | Existing Work Hub native-work panel persists duty status and separately agreed on-call windows, reads status back, and confirms starting duty/window saves. Daily workspace links directly to it. | Starting duty does not modify sharing consent. Availability declarations remain a separate existing planning surface. |
| Ticket Travel / Arrival / Check In | New Field work controls capture device GPS, confirm each action, accept optional starting mileage and call the existing canonical lifecycle endpoints. | Field employees only; removed assignments hide the controls; server assignment/ownership checks remain authoritative. Arrival is explicitly distinct from work/billing start. Successful actions invalidate canonical ticket reads. |
| Ticket Check Out / Review | Existing Send for Review action retains device GPS checkout and review handling. | Existing assignment-removed, geofence and API lifecycle guards remain in force. |
| Field Proof Packet | Field employee/foreman view hides approval/payment sections and ends at Submitted to Office. Kickback requires corrections/resubmission. Office view retains Proof-to-Pay. | Optional mileage does not reduce required-evidence completion. Field users do not gain office controls. |
| Gate map / coverage / history | Gate Dashboard now embeds live or selected-time coverage, gate/site markers, fresh staff observations and staff/duty record lists. Existing Gate history and Shift Notes remain available. | Server-projected company/site authorization. Stale/missing observations remain listed and never acquire a map position; no coverage action is performed by viewing the map. |
| Fleet overview / History & Replay | Existing observation map is retained. New recorded-route replay selects a currently authorized loaded run, queries its location history, and offers play/pause, speed, scrubber and event seeking. | Timestamped samples only. Long gaps split route lines and suppress guessed markers. Estimated short-segment interpolation is labelled. Truncated history is explicit. Removed run selection clears. No dispatch/run mutation occurs in playback. |

## Local validation

- Web typecheck passed after these implementations.
- Focused field-action tests cover device GPS, optional mileage, confirmation cancellation and terminal/on-site gating.
- Shared replay-logic tests cover invalid samples, timestamps, segmented gaps, distance and interpolation.
- Final focused batch passed: 73 tests across 12 files covering calendar normalization, field proof, Gate map, Work Hub collaboration, native operations, existing Fleet/ticket behavior and replay/action integration. Final release-wide results belong in the release handoff.

The web Gate map and Fleet replay require the matching API endpoints from this release. This document does not establish online deployment, installed ChatGPT tools or Apple submission.
