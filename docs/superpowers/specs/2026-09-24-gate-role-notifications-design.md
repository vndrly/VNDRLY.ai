# Gate-Role Notifications Design

## Purpose

Give gatekeepers and gate supervisors one role-specific notification inbox that summarizes actionable Work Hub activity without exposing office-only ticket or Hotlist categories. The existing notification store, read state, live updates, preferences, and badge count remain authoritative; this design adds a gate-role view and routing layer rather than a second inbox.

## Audience and scope

- Applies to users acting as `gatekeeper` or `gate_supervisor`.
- Other roles retain their existing notification categories and preferences.
- The gate inbox shows only notifications the current user is authorized to open in the current gate-company and site context.
- Deep links are re-authorized when opened. A stale or revoked item shows a neutral unavailable state and does not leak inaccessible content.

## Gate notification taxonomy

The gate inbox has eight filter pills:

1. **All** — unread and recent items across all seven gate categories. This is a view filter, not a preference switch.
2. **Schedule** — shift assignments, changes, cancellations, coverage requests, swap decisions, and time-bound meeting changes. Opens the exact Work Hub shift, calendar item, or meeting.
3. **Gate Crew** — gate-group announcements, supervisor broadcasts, membership changes, and general messages addressed to the Gate group. Opens the exact gate-context Work Hub channel or announcement.
4. **Messages** — direct messages, mentions, replies, and comments involving the user. Opens the exact Work Hub conversation and message.
5. **Handoffs** — prior-shift notes, revised handoffs, supervisor follow-ups, and required handoff acknowledgements. Opens the exact Work Hub handoff or Shift Notes entry.
6. **Tasks** — assigned tasks, forms, checklists, acknowledgements, due reminders, and overdue items. Opens the exact Work Hub task, form, checklist, or acknowledgement.
7. **Compliance** — PEC cards, certifications, qualifications, and 60-, 30-, 14-, and 7-day expiry reminders. Opens Profile & Settings at the relevant compliance credential.
8. **Alerts** — urgent-only safety, gate-closure, access, immediate site-change, stop-work, and other operational alerts. Opens the exact gate, safety, or urgent Work Hub announcement destination.

Gate roles do not see the generic **Tickets**, **Hotlist**, **Crew**, **Comments**, **System**, or **Safety Incidents** filters. Their relevant activity is mapped into the taxonomy above. Comments are part of Messages; safety is part of urgent Alerts.

## Event mapping

The server continues to create ordinary notification rows. A gate-role display-category resolver maps authorized events into the gate taxonomy:

- `work_hub_shift_*`, coverage, swap, and time-bound meeting events -> Schedule.
- Gate-context announcements, broadcasts, and membership events -> Gate Crew.
- `work_hub_message`, `work_hub_mention`, replies, and comment events -> Messages.
- Gate shift-note and handoff events -> Handoffs.
- `work_hub_task_*`, form, checklist, and acknowledgement events -> Tasks.
- `cert_expiring`, `cert_expired`, and qualification-blocking events -> Compliance.
- Safety events and urgent gate/site operational events -> Alerts.

Routine system notices that do not require a gate worker action are omitted. The resolver is shared by the list endpoint, unread totals, preferences, and mobile rendering so counts and filters cannot disagree.

## Gate group

Work Hub owns a Gate group/context containing authorized gatekeepers and gate supervisors. Gate Crew notifications are created only for gate-context activity visible to that group. Membership is derived from current role and gate authorization, not copied into a parallel notification membership list.

## Inbox behavior

- The category row and its light-gray divider remain fixed at the top of the inbox card.
- Only the notification results area scrolls vertically.
- Results load newest first in pages of 25. Reaching the end loads the next authorized page. Changing category resets to its first page.
- Each row shows a concise title, one-line summary, age, and read state.
- Opening a row marks it read only after the destination resolves successfully.
- The existing Mark All Read action marks every currently authorized gate notification read and refreshes the badge.

### iPhone category carousel

- The eight branded pills appear in one horizontal carousel.
- The selected pill automatically scrolls to the horizontal center without reordering the categories.
- Leading and trailing spacer widths allow the first and last pills to center.
- Neighboring pills remain visible on either side, with a subtle edge fade indicating horizontal scrolling.
- Inactive pills use the gray VNDRLY artwork; the selected pill uses the current primary brand artwork.

### iPad category row

- Pills remain in their fixed order and display together when width permits.
- The row can still scroll horizontally at narrower split-screen widths, but selection does not reorder it.

## Responsive notification bell

- One shared bell component owns the unread total and click behavior.
- The badge shows the combined unread count across the seven gate categories and caps visually at `99+`.
- On every iPhone page, the bell appears immediately left of the VNDRLY icon in the page header.
- On iPad, the same bell appears in the sidebar identity area.
- The icon grows from 18 to 27 points. The iPad placement shifts approximately 12 points left while preserving the header layout and accessible touch target.
- Clicking the bell opens the in-shell gate Notifications page on both form factors.

## Notification preferences

Gatekeepers and gate supervisors see switches for:

- Schedule
- Gate Crew
- Messages
- Handoffs
- Tasks
- Compliance
- Alerts

All is not a preference. The existing Mobile Push and Do Not Disturb controls remain. Office-only Tickets and Hotlist switches and generic System/Crew/Comments switches are hidden for gate roles. Other roles keep their current preference UI.

Preference persistence remains server-authoritative. Existing Work Hub preference columns may be reused where their meaning is exact; gate-only handoff, compliance, and urgent-alert controls receive additive fields or a guarded versioned preference object. No destructive migration is permitted.

## Urgent alert delivery channels

Alerts remain visible in the in-app inbox and increment the shared bell. They also fan out immediately through every channel the user has explicitly enabled:

- Mobile push uses the existing Expo push registration and badge count.
- Email uses the existing immediate notification-alert email template when the user has a valid email address and alert email enabled.
- SMS uses the existing Twilio transactional sender only after the user separately enables urgent-alert SMS and has a valid E.164 phone number. SMS consent is optional, auditable, and never inferred from accepting terms, providing a phone number, or enabling push/email.

Push, email, and SMS are independent attempts. A missing provider configuration or one channel's failure does not suppress the other channels or remove the inbox item. SMS sends include a signed status-callback URL; queued, sent, delivered, undelivered, failed, and opt-out outcomes are recorded per notification and channel. Permanent opt-out or invalid-recipient responses disable further SMS attempts until the user explicitly opts in again with a valid number. Alerts remain urgent-only so routine notices do not create multi-channel noise.

## Error and empty states

- Empty categories show a category-specific empty message.
- A failed deep link keeps the item unread and shows a neutral unavailable message.
- Rate limiting retains the existing slow-down banner and does not move the fixed category row.
- Offline mode may display cached authorized items, but opening a destination that requires fresh authorization waits for connectivity.

## Verification

- Unit tests cover role-to-category mapping, unread totals, preference mapping, and event-to-deep-link behavior.
- API tests prove gate roles receive only authorized gate categories and that other roles remain unchanged.
- Mobile tests cover the iPhone centered carousel, iPad fixed row, gray/brand pill states, 25-item paging, responsive bell placement, badge aggregation, Mark All Read, and category-specific empty states.
- Navigation tests cover every Work Hub/Profile destination and revoked-access handling.
- End-to-end checks create representative Schedule, Gate Crew, Messages, Handoffs, Tasks, Compliance, and Alerts events and verify the exact destination opened from each notification.

## Release boundary

The approved release is a full ship: commit, push and advance `main`, publish web, deploy API with guarded Supabase migrations, publish iOS OTA, and build and submit TestFlight. App Store Ready for Sale is not included.

## Companion web status correction

The web portal's top Ask V status treatment uses neutral gray when Ask V is muted or unavailable. Green is reserved for the active/on state. Red is not used for muted or unavailable because those are non-error states.
