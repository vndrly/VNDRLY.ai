# iOS Ask V parity backlog

This checklist is included in the September 22 Gate operations TestFlight release. Calendar and Gate Ask V parity now share server permissions, confirmation, audit, and idempotency boundaries; the remaining release gate is the exact-tree verification and successful TestFlight submission.

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
- Default an omitted meeting duration to thirty minutes and derive a short title rather than asking for optional details.
- Use the shared `find_work_hub_meeting_times` server tool to check participant meetings and assigned shifts, keep tasks non-blocking, protect private schedule titles, and suggest the earliest common openings.
- Recheck availability during the confirmed create transaction so a newly introduced conflict returns fresh alternatives instead of double-booking.
- Use the creator device timezone for creation and render the same absolute meeting time in each attendee's local timezone.
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

## Gate Ask V and native parity included in this release

- Common-language Gate commands cover check-in, check-out, paid-travel start, assume shift, Gate coverage status, secure report delivery, stale-visit reconciliation, and authorized reversal.
- Explicit imperatives execute the exact requested Gate action without a redundant second confirmation; one short question is reserved for a genuinely missing required target, date, reason, or authorized recipient.
- Native Dashboard, Work Hub, Gate, History, and Shift Notes use the same order and server-defined permissions as web.
- Native History defaults to Current shift and supports Previous shift, 24 hours, 7, 14, 30, and 90 days, and one year, with record-type filters and matching PDF, Excel, Word, and secure-link delivery.
- Native Gate duty supports concurrent workers, independent Assume Shift and sign-off, and paid-travel start when the Work Hub assignment permits it.
- Native Needs Review supports audited stale-vehicle reconciliation; reversal remains supervisor/admin scoped on the server.
