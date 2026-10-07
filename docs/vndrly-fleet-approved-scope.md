# VNDRLY Fleet approved foundation

Approved by the user on 2026-10-06. Finish the current integration ship, then implement this native Fleet foundation across web, iOS and ChatGPT. This document records requirements; it does not establish shipped functionality.

## Roles

- Fleet Manager owns vehicle/driver readiness, maintenance, inspections, qualifications, availability and performance. Dispatch permissions are included by default.
- Dispatcher manages schedules, driver/vehicle/load assignments, destinations, reassignment, live runs, ETAs and delay communication. It is a separate narrower role.
- Driver performs assigned runs, inspections, defect reporting, load/delivery evidence and completion.
- Company Admin grants these roles and sets company policy and fleet/site scope. Users may hold multiple roles.

Authorization combines company membership, role, assigned fleet/site and action. Dispatcher authority cannot clear safety defects, override out-of-service restrictions or read another company's fleet. The same server authorization applies in every interface and to Felix/V tools.

## Permission contract

| Capability | Fleet Manager | Dispatcher | Driver |
| --- | --- | --- | --- |
| Fleet map, availability and run status | Assigned fleet | Assigned fleet | Own assigned run |
| Assign drivers, vehicles, trailers and loads | Yes | Yes | No |
| Dispatch and reassign eligible work | Yes | Yes | Acknowledge own assignment |
| Vehicle registry and custody | Manage assigned fleet | Read availability | View assigned equipment |
| Maintenance and inspection planning | Manage | View readiness restrictions | Perform assigned inspection; report defects |
| Release an out-of-service vehicle | Only with separately granted safety release permission | No | No |
| Rates, costs and financial reporting | Only with separately granted finance permission | No by default | No by default |
| Grant roles or expand fleet scope | Company Admin permission required | No | No |

Small companies assign Fleet Manager to one person, including dispatch. Larger companies add Dispatchers scoped to the fleets and sites they operate. Existing Foreman and Gate Supervisor roles do not automatically gain fleet-wide control. A person can hold several explicitly granted roles.

All assignment changes must validate driver qualifications, availability, vehicle readiness, company/site authorization and concurrent revisions on the server. Views and assistant tool discovery use the same permission contract; hiding a button is not authorization.

## Delivery order

1. Finish the current verified integration release, including the ChatGPT package and TestFlight.
2. Build shared fleet records, role grants and server permission checks, reusing existing identity and inventory records.
3. Deliver the complete first workflow on web and iOS, then expose the same services through Felix/V and ChatGPT.
4. Verify manager, dispatcher and driver workflows and denied access using isolated synthetic records before the next full ship.

## Assignment states

Keep dispatched, acknowledged and started distinct. Saving and notifying an assignment is not driver acceptance or physical movement. Preserve actor, timestamps, revision history and retry protection. Reassignment must not overwrite an active driver's run without the canonical transition policy.

## First complete workflow

Vehicle registry and custody -> assign driver/vehicle -> inspection -> dispatch -> tracked run -> Gate arrival -> load/delivery evidence -> ticket -> completion.

Reuse existing workers, inventory assets, site relationships, Gate contractor assignments, Work Hub and ticket records. Preserve the existing ticket status and lifecycle axes. Define truck/trailer/load identity and relationships before presenting their positions as fleet telemetry.

Fleet Manager sees readiness, maintenance, utilization and exceptions. Dispatcher sees the live map, available drivers/vehicles, active runs and assignment board. Driver sees their own authorized assignments and next required step. Site partners see site-relevant authorized activity.

## Verification

Prove a small-company combined manager/dispatcher and a larger-company scoped dispatcher. Test cross-company denial, out-of-service refusal, unavailable driver/vehicle conflicts, assignment acknowledgement, reassignment concurrency and retry protection. Verify saved state and notifications separately. Check web, iOS and actual ChatGPT actions with synthetic records.

Phone location, hardware telemetry, route services, cameras and regulated electronic logging need verified integrations. Show source, freshness and availability. A placeholder or API descriptor does not establish collection, compliance, media playback or tracking.
