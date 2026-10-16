# VNDRLY Fleet role and workflow contract

Approved direction: Fleet Manager owns fleet management and dispatch by default. Companies may appoint a narrower Dispatcher. Drivers work their own assigned runs. The same server permissions apply in web, iOS, Ask V and ChatGPT.

| Role | Responsibilities | Boundaries |
| --- | --- | --- |
| Fleet Manager | Vehicles, trailers, driver assignments, dispatch, maintenance and fleet overview | Assigned company, fleets and sites; finance and safety release require separate grants |
| Dispatcher | Assign qualified available drivers and equipment, schedule runs, monitor progress and communicate changes | Assigned fleets/sites; no maintenance clearance, asset ownership changes or finance access |
| Driver | Accept assigned runs, inspect equipment, record load/delivery evidence, report defects and complete own runs | Own assignments; no other drivers' runs or fleet-wide administration |

One person may hold multiple roles. A manager who drives must also have the Driver assignment for that run. A title alone never grants access to every company asset or site. Partner visibility follows the partner's authorized sites and relevant runs; it does not expose a vendor's whole fleet.

## First complete workflow

1. Manager registers a vehicle/trailer and its maintenance, inspection and qualification requirements.
2. Manager or Dispatcher creates a run with origin, destination, load type, schedule, driver and equipment.
3. Server checks assignments, site access, driver qualifications, equipment availability, overlapping runs and safety holds.
4. Driver accepts, performs the inspection and starts the run. Location collection requires an authorized device and active duty tracking.
5. Driver records arrival, loading, outbound travel, delivery/unloading and return as applicable. Gate events reconcile with the run without duplicate check-in/out.
6. Driver submits manifests, photos, mileage and exceptions. Authorized staff review completion and associated ticket/billing records.
7. Manager sees current phase, destination, ETA, last location timestamp and exceptions. Missing or stale telemetry remains explicit.

Run phases and office ticket statuses are distinct. A run cannot silently approve a ticket, clear a safety hold or move money. Failed or repeated requests use the existing audit and idempotency contracts.

## Views

- Manager: live map, inbound/outbound/loading/unloading/available groups, delayed runs, defects, upcoming service and unassigned work.
- Dispatcher: dispatch board, availability and schedule conflicts, qualified replacements, load progress and contact controls.
- Driver: current run, next destination, inspection, load/delivery capture, defect reporting and own history.
- Partner: relevant site arrivals, departures and authorized run activity.

Map cards show source, observation time and accuracy where available. ETA is unavailable when telemetry is unsuitable. Requested wall-screen views require a registered companion and authenticated device control; creating a saved view does not prove a television changed.

## Implementation status

Fleet permissions are connected to persisted company grants, canonical Inventory assets and run services. Web, iOS, Ask V and the existing ChatGPT plugin provide the shared management and driver workflows, including Fleet Dispatch, Inventory, Details, recorded maps and history. Run transitions retain current authorization, readiness, version and retry checks. Fleet review remains separate from commercial ticket approval and payment.

The approved new-ticket/shared-ticket billing workflow is tracked separately; this status does not establish its completion. Physical iPhone tracking and push behavior, configured hardware/provider integrations, and each release's online deployment, plugin verification and TestFlight submission require their own evidence.
