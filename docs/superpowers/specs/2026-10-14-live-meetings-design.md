# Live company meetings and admission

## Intent

Make Meetings useful for impromptu company conversations as well as scheduled meetings. A host starts a meeting immediately, invites people while it is running, and chooses whether current company members can enter directly or must ask to join. In-app notifications and native push open the exact meeting after authentication. The same authorized room is reachable through a copied link and through VNDRLY assistant surfaces.

Approved conversation design: Start meeting now, Schedule meeting, Live now, Upcoming and History; company-only open admission or a host-approved waiting room. Communications contains Chats, Calls and Meetings, with the duplicate company conversations row removed. Preserve the unfinished internal-call transcription implementation and its verification ledger.

## Existing code and boundaries

- `artifacts/vndrly-mobile/components/WorkHubMeetings.tsx` provides Upcoming/History, details and the scheduling popup.
- `MeetingScheduling.tsx` provides date/time helpers, description, 60-minute default duration, overnight rollover and optional attendance confirmation.
- `artifacts/api-server/src/routes/workHubMeetings.ts` provides participant-restricted audio, presence, host controls, artifacts and AskV participation. Its context requires a participant: the new discovery and admission endpoints must authorize company membership before a participant exists.
- `workHubOperations.ts` creates meetings and invitations; existing command envelopes, audit and idempotency are reused.
- `pushDeepLinks.ts` and notification destination adapters currently have different path handling. Normalize meeting notifications to one occurrence identifier and canonical mobile path `/work-hub/meeting/:occurrenceId`.
- Existing native room is audio only. No video dependency, Codex voice bridge or automatic Codex system notification is introduced or claimed by this change. Human users can open the meeting link in the app or a compatible browser. Assistant tools can read authorized state and perform authorized host actions.
- Company recording/transcription policy remains a separate unfinished work item. Admission and attendance RSVP must not manufacture consent records or introduce per-meeting recording permission prompts. Do not route new audio to external speech services.

## Page and room design

Top row: Meetings heading, compact branded Start meeting now and Schedule meeting actions. Below: Live now cards, then Upcoming/History selectors and the branded 2px search field. Phone layout stacks cards; iPad shows selected details beside the list. Existing brand/pill components and corner treatment are reused.

Live card: title, host name, elapsed time, actual connected participant count, admission label and the user's action. Owner/admin sees Open meeting; admitted member sees Join; other eligible member sees Join for open admission, Ask to join for approval, Waiting for host while pending, or Request declined after denial. An ended meeting cannot offer Join. Empty Live now is a short message rather than a large unused card.

Start-now popup: title required, description optional, admission selector, searchable invitees and Start meeting. Default admission is Host approval; default planned duration is 60 minutes. Server timestamps define actual start. Planned end is informational and does not disconnect an active meeting. Existing explicit host End meeting controls termination. Starting creates the meeting/occurrence and owner participant atomically, then opens that occurrence. It does not automatically enable a microphone.

Room header: LIVE indicator, elapsed time, participant count, Invite people, Copy meeting link and host-only Waiting room control with count. The waiting room stays accessible when a request popup is dismissed. On iPad it is a side panel; on phones a popup/sheet. Each pending request shows name and requested time with Admit/Decline. A dismissed popup does not change admission state. Host mute and removal remain separate controls.

Scheduled meetings retain one Date, Start time, Description and default 60-minute Duration. Require attendance confirmation is optional and defaults off. RSVP acknowledges planned attendance; it does not admit somebody to a live approval meeting or establish actual attendance. Actual attendance is recorded upon real room entry and departure.

## Admission data and authorization

Use additive guarded `ADD COLUMN IF NOT EXISTS` migrations on existing tables only:

- Meeting `admission_mode`: nullable text; new meetings use `company_open` or `host_approval`. Null means legacy participant-only behavior so existing meetings are not silently opened or locked by rollout.
- Participant `admission_state`: nullable text; new rows use `pending`, `admitted` or `declined`. Null preserves legacy eligibility for an existing participant. New invitations in approval mode create pending eligibility, not automatic admission.
- Participant `admission_requested_at`, `admission_decided_at`, `admission_decided_by_id`: nullable timestamps/user identifier. Request absence means invited but not asking yet. An explicit request sets the timestamp. Owner is admitted on creation.

Only current non-suspended company members can discover new-mode live meetings. Discovery shows title, host, admission mode, start time, count and their own admission state; it reveals no room messages, transcript, files or signaling. Only current admitted members access room data/audio. Membership and admission are checked for every room/capture endpoint, not just the lobby button. Removed participants cannot self-rejoin through an open room; an owner/admin must explicitly restore them.

Current company administrators and the meeting owner can invite, admit/decline, change admission and end the meeting. Role and ownership are checked from current persisted membership, including in write transactions. Generic session admin labels alone are insufficient. An invited person's admission request is not granted solely because they possess a link.

Switching open to approval preserves already admitted people and requires approval for subsequent unadmitted entries. Switching approval to open lets pending current members join but does not revive removed users or grant outsiders access. Pending requests can be retried after a host denial only when the host resets that decision; no repeated popup spam.

## Commands and discovery

Provide narrow server operations for company live listing, start-now, request admission, decide admission, invite additional current members and change admission mode. Reuse command envelopes, optimistic versions, operation IDs, canonical result readback and audit events. Start-now retry creates one occurrence. A request is unique per occurrence/user through the existing participant uniqueness constraint. Duplicate admission decisions return the canonical decision; a stale conflicting decision is rejected.

Acquire occurrence/participant locks for admission and termination decisions. End racing with Admit cannot create access to an ended room. Final host authorization and current target membership are checked before mutation. Host authority revocation prevents further decisions. Cancellation/end resolves pending requests as no longer actionable without deleting their audit history.

Existing participant-only routes require a shared admission guard; modifying only Join would leak meeting chat, transcripts or signaling to pending invitees. Native device ownership/lease safeguards continue unchanged.

## Invitations, notifications and navigation

Invitation, admission request, admission granted/declined, and meeting ended use the existing notification service and user/device preferences. Persist inbox notification and delivery intent after the successful transaction, with existing dedupe/retry mechanisms; an unavailable push service must not roll back a meeting or hide the inbox item. Do not claim push delivery from merely queueing it.

Live invitation: '[Host] invited you to [Title] — happening now.' Admission request goes to the owner and eligible company admins who manage that meeting. Granted notification goes to the requester. In-app refresh/polling presents the popup and updates the persistent waiting-room count. Use existing refresh conventions with a 5-second live polling interval, pause polling when backgrounded, and refresh immediately when foregrounded. Popup dedupe is by request identity; notification read state does not resolve the request.

Notification data includes occurrenceId, organization identity and event type, and never microphone credentials or a bearer admission grant. Resolve only validated identifiers and supported internal paths. Native foreground/background/cold-start taps navigate to the exact occurrence, preserving destination through login. A different current organization requires an explicit context switch or a clear access message; never silently act under another company.

Copy meeting link returns the canonical HTTPS meeting destination with occurrence ID. SMS delivery is outside this feature: the user copies and texts it. Web and native universal-link handling open the same authorized lobby/room; an uninstalled app can use the compatible web route. Login and ended/removed/wrong-company cases show useful outcomes rather than redirecting to Fleet Ops or an unrelated home screen.

## Assistant and plugin parity

Expose permission-scoped discovery/details and host commands through the existing AskV/MCP registry and embedded meeting surface, with the same server checks, audit, idempotency and required action confirmations as equivalent app actions. An ordinary signed-in employee can request their own admission, not admit others. The embedded view displays pending requests only for an authorized host/admin. Provide a human-clickable Open meeting link. Tool results must distinguish active, pending, admitted, ended, queued notification and verified delivery.

Do not auto-invite an AI participant or assume Codex microphone/video access. No autonomous notification to another Codex task or external SMS is authorized by implementing this feature.

## Acceptance and verification

1. Communications has exactly Chats, Calls, Meetings and their distinct destinations.
2. Start-now retry creates one live occurrence; owner can enter and invite while active.
3. Open company member enters; outsider, suspended member and removed participant are refused.
4. Approval member can discover and request, but cannot read room data or use signaling/audio before admission. Approved member enters; rejected/ended requests cannot.
5. Two simultaneous host decisions, meeting end, mode changes and membership revocation produce canonical guarded results.
6. Optional attendance confirmation, description, date/time helpers and overnight scheduling continue to work.
7. Push tap maps to the same occurrence from foreground, background and cold start; login preserves destination; malformed IDs and cross-company routes refuse access. Web link reaches the equivalent room.
8. Push failure retains the inbox and durable retry; request popups and counts remain correct after reload and dismissal.
9. AskV/MCP discovery and admission decisions match app permissions and canonical readback. No AI audio/video joining is represented as available.
10. Focused mobile/API/web tests, typecheck and locale parity pass. Database integration uses a fresh empty isolated test database; never reset shared dev/prod. Native two-device/push delivery evidence is required before claiming device readiness. Existing transcription native/runtime blockers stay explicit.

## Release boundary

This spec authorizes no destructive database changes, password rotation, new external provider, external messages or automatic production publication. Implementation remains in the current preview worktree, preserving unrelated changes. Any later full-ship command follows the standing eight-track release rules and requires actual native and plugin evidence.
