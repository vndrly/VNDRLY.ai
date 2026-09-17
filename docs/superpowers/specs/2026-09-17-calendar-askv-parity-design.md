# Calendar and Ask V Parity Design

## Goal

Make the Work Hub Calendar a complete operational surface and give Ask V the same authorized capabilities as the page, with one concise confirmation for mutations.

## Calendar experience

- Reuse the branded sidebar-button image treatment for weekday headers.
- Use gray month-day borders when empty and the organization primary color when scheduled work exists.
- Rename the creation card and action to **Create Shift/Event**.
- Add a branded Calendar **Create Task** card directly below Create Shift/Event with title, description, due date, priority, and crew-or-individual assignment.
- Clicking any month date opens a Day Agenda flyout containing every scheduled item and exact item links.
- Order creation fields as Meeting Type, Title, Starts, Ends, Attendees, Calendar, and Mandatory.
- Meeting Type is an autocomplete that selects an existing type or creates a new type on submission.
- Attendees support crews and individual employees; Calendar defaults to Internal Company.
- Scheduled items open the exact meeting, shift, or task detail surface.
- Today's Agenda and item-detail flyouts reuse the Ask V visual shell.

## Ask V behavior

- Keep replies concise and infer safe defaults such as a one-hour duration when omitted.
- Resolve a named crew or employee, summarize the complete action once, request one confirmation, then perform the mutation and notifications.
- Support mandatory events, agenda/date summaries, exact item details, update/reschedule/cancel, and subcontractor-hours operations.
- Use the Ask V modal as a visual companion for transcripts, numbers, tables, long text, meeting notes, employee details, agendas, and delivered results.
- The voice control labels are exactly **Click to Start V** and **Click to Stop V**.

## Tool and security model

- Calendar receives a purpose-built tool pack rather than unrestricted access to every Work Hub family.
- Reads and writes remain organization-, role-, and site-scoped on the server.
- One composite calendar mutation resolves meeting type and attendees and creates or updates one item, so the existing confirmation boundary fires once.
- Cancellation preserves audit history; no destructive database operations are introduced.
- New persisted fields are additive and guarded.
- Project Timeline is explicitly deferred and remains unchanged.

## Verification

- Contract tests cover the Calendar tool pack, action schemas, confirmation classification, and runtime routing.
- Web tests cover labels, field order, branded weekday chrome, day-border state, attendee controls, mandatory state, exact links, and Ask V modal events.
- API tests cover tenant isolation, crew expansion, meeting-type creation, mandatory persistence, notification fan-out, updates, and cancellation.
