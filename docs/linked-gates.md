# Parallel linked gates

Parallel gates are alternative entrances and exits for one shared Site / Spur.
Distance does not determine a link. Series/checkpoint routing is not included.

## Setup

- Gate Map → Administrative functions → Create Gate: choose a site and use
  **+ Add linked gate** to start its named Site / Spur link, or **+ Add to
  existing link** to join another site belonging to the same partner.
- Existing gates can use the same link controls from Edit a Gate / Move a Gate.
- Partner site creation has the same optional Site / Spur link controls.
- Sites without a link retain their existing behavior. Multiple gates at one
  site already share its site traffic; an explicit link also connects sites.
- Linking requires gate-management authority for both sites. A link never
  grants access to another site and cannot silently merge two existing groups.

## Shared operations

Arrivals, On Site, Departures, Gate Log, dashboard traffic totals, and the
unassigned task hopper include the authorized sites in the parallel group.
An active visit is retained once across check-in retries at different linked
gates. Check-out may happen at another linked gate; entry and exit gate evidence
remain separate. Approval remains clearance to enter, not proof of arrival.

The shared current-watch reporting window begins at the earliest active watch
in the group (the previous 24 hours if none is active). Handoffs retain their
own gate/watch signature and include shared metrics plus the latest saved
notes from the other linked gates. Linking does not transfer watch ownership,
change paid shifts, or sign anyone out.

## Selector and connection

The compact **Site | Gate** selector remains 170 px for phone views and 375 px
for larger layouts. GPS stays on its right; the mirrored left arc indicates
the selected linked booth's connection. Unlinked gates hide the left arc:

- Green: a current watch/duty operator reported from the visible Gate or Gate
  Dashboard within 90 seconds, and that operator's account/session is valid.
- Red: a previous report has expired, or its watch/duty/session ended.
- Grey: no booth report has been received, or the connection read failed.

Reports repeat every 30 seconds while the page is visible and the browser is
online. An office user merely viewing a gate does not make it appear online.
All gates remain selectable; an offline status does not block traffic entry.
The selector's tooltip includes the number of connected linked gates. This is
booth application connectivity, not a camera or network-device health monitor.

## Storage and rollout

`migrate:linked-gates` adds only `site_locations.gate_link_id`,
`site_locations.gate_link_name`, and `gate_stations.connection`. It does not
change historical visits, staff, watch assignments, credentials, or existing
site links. The guarded migration is included in API deployment; the existing
separate demo-owner provisioning path includes the same additive fields.
