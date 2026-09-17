# Ask V Minimal-Input Scheduling Design

## Goal

Let an authorized user schedule a basic meeting through Ask V with as little spoken information as possible. A request such as “I need an admin meeting tomorrow; what is the first time everyone is available?” must be enough to find a common opening, present one concise proposal, and create an editable meeting after one final confirmation.

## Required behavior

- The only required scheduling intent is the audience plus either a requested time or a broad day/window.
- Missing title, description, agenda, location, meeting type, availability rules, and explicit time zone do not trigger follow-up questions.
- The creator's device time zone is the default. Meetings are stored as absolute instants and displayed in each attendee's local time.
- If the user gives only a broad day, Ask V finds the earliest common opening within the organization's normal scheduling window. When no window is configured, use a sensible daytime search window without requiring setup.
- Hard conflicts are overlapping shifts or job assignments, meetings, and approved time off.
- Tasks do not block time. Travel buffers apply only when an organization has configured them.
- Ask V may say that a participant is busy and show the conflicting time span, but it must not reveal a private event title or details the requester cannot access.
- Ask V returns a short proposal with the audience, local start time, duration, and mandatory status, then asks once for confirmation.
- After confirmation, the server rechecks availability under locks. If availability changed, it does not create the meeting and returns fresh alternatives.
- Authorized administrators can open the created meeting later and fill in optional details.

## Architecture

1. Add a read-only Ask V availability tool that resolves people or crews, checks permission-scoped busy intervals, and returns the earliest common candidate slots.
2. Put shared conflict and slot-selection logic in the Work Hub scheduling domain so the read tool and the write path use the same rules.
3. Extend the meeting creation write path to perform the same conflict check immediately before insert.
4. Return structured conflict results with privacy-safe participant labels and replacement slots instead of relying on free-form error text.
5. Keep the existing confirmation boundary: availability lookup is read-only; meeting creation remains a single confirmed, idempotent write.

## Minimal defaults

- Duration: the selected meeting type's duration, otherwise 30 minutes.
- Title: the named meeting type or audience label, otherwise “Meeting”.
- Time zone: creator device time zone.
- Availability: configured rules when present; otherwise calendar-derived free/busy within the requested day.
- Notifications: existing Work Hub invitations and supported web/mobile notifications.

## Verification

- Tool contract tests cover minimal input, crew expansion, privacy-safe conflicts, and candidate slots.
- Scheduling policy tests cover shifts/jobs, meetings, time off, tasks as non-blocking, and configured travel buffers.
- Route tests prove write-time recheck prevents races and returns alternatives.
- Existing one-confirmation and idempotency tests remain green.
