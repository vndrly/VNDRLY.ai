# iOS Ask V parity backlog

This is a release-blocking checklist for the next VNDRLY iOS update. The Calendar work is being published to web/API first; TestFlight is intentionally deferred until the next grouped mobile batch.

Before the next iOS or TestFlight update, explicitly confirm with the user that this parity batch is included, then verify each item in the native app rather than assuming server availability proves the iOS experience.

## Calendar Ask V tools

- Read the permission-scoped Calendar range.
- Read a timezone-correct day agenda.
- Open the exact authorized shift, meeting/event, or task.
- Resolve eligible people, crews, and the members of a selected crew.
- Create, update, reschedule, and cancel authorized shifts, meetings/events, and tasks.
- Create or reuse meeting types.
- Support mandatory events and the Internal Company default.
- Read and act on authorized subcontractor-hours reports: approve, email, and prepare PDF.
- Preserve the one-pass scheduling flow: silent read lookups, one concise readback, one confirmation, then one mutation.
- Default an omitted meeting duration to one hour.
- Deliver and display the existing in-app and push notifications for invitees and assignees.

## Native Ask V experience

- Use the exact voice-control labels “Click to Start V” and “Click to Stop V.”
- Open the visual Ask V results surface for numbers, tables, long text, agendas, meeting notes, and employee details.
- Keep the live conversation and delivered result visible in that surface.
- Make agenda items and Calendar results open the exact native detail destination.
- Verify role, company, site, and tenant scoping for every read and write.

## Required mobile verification

- Add or update native contract tests for the tool pack and one-confirmation flow.
- Exercise the flows on an authenticated iOS build.
- Verify push notifications on-device.
- Complete OTA when sufficient and TestFlight when native code or bundled native behavior changes.
