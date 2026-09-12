# VNDRLY Multi-Device Work Hub and Ask V Design

Date: 2026-09-12  
Status: Ready for user review

## Decision

VNDRLY will support one person using several signed-in devices at the same time. A user may keep meeting audio and AirPods on an iPhone, work on a ticket or schedule from a desktop, and upload a receipt from a tablet without leaving the meeting or forcing every device onto the same screen.

The design uses a server-owned, organization-scoped device coordinator. Devices share the user's meeting membership, Ask V conversation, confirmations, action progress, and saved results, but each device navigates independently. Exactly one eligible device owns live audio at a time.

This is an extension of the existing Work Hub, meeting, call, file, calendar, and Ask V systems. It does not replace their server-side authorization or persistence.

## Goals

- Let one user work safely and continuously across phone, tablet, and desktop.
- Keep each device's page independent while sharing the same authorized work context.
- Mirror an Ask V conversation, confirmations, progress, and results across the user's devices.
- Let phone-based Ask V understand and act on the VNDRLY page being used on a desktop without moving audio.
- Preserve meeting membership while a device browses tickets, files, schedules, or other VNDRLY areas.
- Support explicit and resilient audio handoff, including remembered backup devices and automatic failover.
- Make uploads and other mutations appear promptly on every active device.
- Prevent duplicate work, silent overwrites, cross-company leakage, and one device accidentally disconnecting another.
- Give meeting hosts and assigned co-hosts enforceable moderation controls across an attendee's devices.

## Non-Goals

- Mirroring the same visual screen or navigation route on every device.
- Allowing two devices for the same user to transmit meeting microphone audio simultaneously.
- Silently moving audio merely because another device becomes active.
- Remotely unmuting an attendee without that person's prior failover authorization.
- Exposing a user's device names, device count, or device activity to ordinary meeting attendees.
- Bypassing browser, iOS, or operating-system microphone permission rules.
- Changing existing role or organization permissions.
- Performing the separate Exxon-to-Remington demo-data anonymization project.

## Current-State Findings

VNDRLY already stores conversations, files, schedules, tasks, call settings, and Ask V conversations on the server, so the same signed-in user can retrieve saved work on several devices. Existing Ask V voice sessions have distinct session identifiers, which prevents a new voice session from automatically replacing another.

The remaining gaps are live coordination boundaries:

- Meeting presence and signaling currently identify a participant by user, not by user plus device. One device leaving can remove the person's shared presence even when another device remains.
- Meeting signals addressed only to a user can be consumed or interpreted ambiguously by multiple connected devices.
- Several Work Hub screens learn about remote changes through periodic refresh instead of immediate invalidation.
- Local component state and device-local drafts are not a complete cross-device activity model.
- Call acceptance, ringing, meeting audio ownership, and Ask V confirmations need one authoritative cross-device outcome.

## Device Identity and Organization Scope

Each authenticated app or browser installation receives a revocable device identity. A device record belongs to a user and carries only the minimum coordination metadata:

- opaque device identifier
- user identifier
- current organization membership and session version
- device class and user-editable friendly name
- supported capabilities, such as microphone, speaker, camera, file selection, and push notifications
- last-seen time and foreground/background state
- current VNDRLY surface and authorized entity context
- microphone permission state
- whether it is eligible and ranked for audio backup

The device coordinator is scoped to the user's current organization. Switching organizations ends or rebinds the old organization session and clears pending confirmations from the old context. A device must pass the normal session, membership, role, and entity authorization checks on every action; device identity grants no additional business permission.

Users can view their own devices, rename them, change backup order, forget a device, and clear learned preferences. Company administrators may revoke a user's device within their organization but cannot inspect private device activity or use device identity to impersonate the user.

## Shared Session, Independent Screens

A shared workspace session represents the user's active Work Hub or VNDRLY activity. It is not a shared browser tab.

Each device may navigate independently. For example:

- iPhone remains on meeting notes and owns AirPods audio.
- Desktop opens a ticket to answer a question asked in the meeting.
- Tablet opens Files and Notes to upload a PDF.

The user remains one attendee in the meeting. Every active device shows a compact persistent meeting bar with meeting status, current audio device, mute state, and a return-to-meeting action. Browsing elsewhere does not leave the meeting.

Each foreground device reports a short-lived authorized page context. Ask V can use the active context from another device when the spoken request refers to it. If more than one target is plausible, Ask V names the candidate device or record and asks one concise clarification. Audio location never determines page context, and page activity never moves audio.

## Ask V Across Devices

An Ask V conversation has one server-owned conversation stream per selected conversation, visible on all of the user's active devices. The stream includes:

- user and assistant turns
- pending confirmations and their expiry
- tool progress and results
- target device or surface when relevant
- recoverable failures and retry state

Only one device submits a given confirmation result. The server resolves the first valid response atomically and broadcasts the outcome; later responses become harmless acknowledgements rather than duplicate actions.

Ask V tool execution remains server-side and role-aware. Cross-device routing adds a target context but never carries authority. A phone command may operate on an authorized desktop ticket, but the backend rechecks the user's current organization, role, entity access, tool confirmation policy, and idempotency key before execution.

## Live Synchronization

Authenticated devices maintain a bounded live event connection to the VNDRLY API, with polling as a fallback. Events contain identifiers and invalidation hints, not sensitive record bodies. After an event, the client refetches the authorized canonical resource.

The event stream covers:

- Ask V turns, confirmations, tool progress, and outcomes
- meeting presence, moderation, audio ownership, and handoff offers
- call ringing, acceptance, decline, end, and voicemail state
- chat, notes, shared items, uploads, tasks, forms, schedules, and ticket changes
- device eligibility and backup preference changes for the current user

Reconnect uses a monotonic cursor so clients can catch up without missing or replaying mutations. If catch-up history is unavailable, the client invalidates the affected Work Hub queries and reloads canonical state.

## Files and Meeting Sharing

When a meeting is active, a file selected on any device defaults to the active meeting's Shared area. Before upload, VNDRLY visibly shows `Sharing to: <meeting>` and lets the user select another authorized destination.

The upload is staged on the selecting device, uses a stable upload operation identifier, and reports progress to the other devices. A completed upload appears in the meeting's Shared area everywhere without navigating any device away from its current screen. Ask V may confirm completion through the current audio device.

Interrupted uploads remain retryable on the device that holds the local file. Other devices can see that an upload is pending or failed, but cannot read or retransmit local file bytes they do not possess.

## Audio Ownership and Handoff

One device holds a renewable audio lease for the user's meeting or call. Other devices are companions: they may display content, perform work, and receive synchronized state, but they do not send microphone audio and must avoid duplicate playback or feedback.

Audio does not move merely because another device becomes active. When Ask V detects a likely handoff intent, the destination device offers `Move audio here`. The existing device retains audio until the user explicitly accepts. If the current device is speaking or recording, the prompt clearly warns that accepting will interrupt that capture.

An accepted handoff:

1. reserves the destination device,
2. mutes and releases the prior audio lease,
3. activates the destination audio session,
4. confirms the new owner to all devices, and
5. rolls back to the prior owner or a muted state if activation fails.

Two devices never hold a valid transmit lease simultaneously. Lease changes use generations so delayed callbacks from an old device cannot publish audio after a handoff.

## Learned Backup and Automatic Failover

VNDRLY remembers a ranked backup-device preference per user. Ask V may learn the order from repeated successful, user-approved handoffs. The user can inspect, reorder, override for one meeting, disable, or clear the learned preference.

A remembered device is eligible only when it is signed in to the same organization, online, joined to the meeting, has already granted microphone permission, and was authorized as an automatic backup.

If the audio owner disconnects unexpectedly, VNDRLY waits only long enough to distinguish a transient network interruption from a true loss. It then selects the highest-ranked eligible backup. The backup device gives a three-second visible and audible `Audio moving here` warning with an immediate cancel or mute action, then becomes the audio owner and turns on its microphone automatically.

If no pre-authorized backup is eligible, VNDRLY offers one-tap takeover but does not bypass microphone permission or silently activate a new device. If the original device returns after failover, it joins as a companion and cannot reclaim audio without a new handoff.

## Meeting Presence and Signaling

Meeting runtime presence is keyed by device connection beneath a user-level participant. A person is shown as present while at least one authorized device connection remains fresh. Leaving or losing one device removes only that connection.

User-level presentation is derived from the device set:

- joined time is the earliest active connection time
- speaking is true only for the current audio owner when permitted and unmuted
- hand raise and host-enforced mute are participant-level state
- ordinary attendees see one participant, not the person's device list

Realtime signaling addresses a specific device connection. Offers, answers, ICE candidates, cursors, and cleanup cannot be consumed by a different device under the same user. Server limits remain bounded by meeting, user, and device.

## Host Moderation

The meeting host and explicitly assigned co-hosts can apply `Muted by host` to an attendee. The restriction applies to every current and future device connection for that attendee and survives reconnects and handoffs.

While host-muted:

- the attendee cannot acquire a transmit audio lease,
- a device cannot unmute itself,
- automatic failover remains listening-only,
- the attendee may raise a hand or send `Request to speak`, and
- VNDRLY clearly identifies that the host controls the mute.

The request-to-speak notification goes to the present host first, then present co-hosts. If none are reachable, a present organization administrator may receive the request as a notification, but cannot release the mute unless that administrator is also assigned as co-host. Only the host or co-host can release the restriction. Releasing it permits the attendee to unmute; it never remotely activates their microphone.

## Concurrent Writes and Conflict Handling

Every mutating client or Ask V action carries a stable operation identifier. Server idempotency guarantees that retries or confirmations from several devices create one logical result.

Editable records use their existing version or a new additive version field. If two devices edit the same record from the same base version, the first valid update succeeds and the second receives a conflict response with the canonical new state. VNDRLY preserves the user's unsent input and offers review or retry; it does not silently apply last-write-wins.

Device-local drafts remain local unless the feature already advertises saved drafts. Shared Ask V confirmations and Work Hub conversation drafts use server state and version checks. Sensitive local attachment bytes never synchronize implicitly.

## Calls and Notifications

Incoming calls may ring on several eligible devices, but acceptance is atomic. The first successful answer selects the audio owner and immediately cancels ringing everywhere else. Decline, end, and missed-call transitions also broadcast to all devices.

Call availability remains a user-level preference. A device may be unavailable as an audio endpoint without marking the person unavailable when another eligible device exists.

Notifications deduplicate by user and event. Read state synchronizes across devices. Device-specific delivery may still occur through push or browser notification, but acknowledging one notification clears its active presentation everywhere.

## Privacy, Audit, and Retention

- Raw audio is not stored by this feature.
- Device metadata is visible only to the user and narrowly authorized administrators for revocation.
- Cross-device context records only route, entity type and identifier, capability, freshness, and coordination state required for the feature.
- Every mutating Ask V action retains its existing audit entry and adds source device, target surface, confirmation device, and audio device identifiers as protected metadata.
- Audio handoff, failover, host mute, mute release, device revocation, and organization switch create audit events.
- Logs and user-visible events use friendly device names while protected audit data uses opaque identifiers.
- Retention is bounded; stale device connections and short-lived surface context expire automatically.

## Failure Handling

- **Network interruption:** preserve membership, renew or fail over the audio lease, reconnect from the event cursor, and refetch canonical state.
- **Destination handoff failure:** keep or restore the previous owner when possible; otherwise remain muted and offer eligible devices.
- **Microphone permission missing:** explain the missing permission and offer another eligible device; never bypass the operating system.
- **Duplicate confirmation:** execute once and show the already-completed result.
- **Concurrent edit:** preserve unsent input and present the canonical changed record for review.
- **Organization or role change:** terminate invalid device coordination state, clear pending confirmations, and reauthorize all visible data.
- **Device revocation:** end that device's live streams and leases; if it owned audio, run the authorized failover policy.
- **Event-stream outage:** fall back to bounded polling and show a freshness indicator until live synchronization resumes.
- **Host unavailable:** retain moderation state and route request-to-speak notifications to present co-hosts; notification-only fallback does not grant moderator authority.

## Additive Data Model

Implementation should use additive guarded migrations only. Expected records include:

- registered user devices and capabilities
- organization-scoped active device connections
- shared workspace sessions and per-device surface context
- audio leases with generation and expiry
- learned and explicit backup-device preferences
- event-stream cursors or durable user-event references
- participant-level host-mute state and request-to-speak records

Existing user, organization, meeting, call, file, calendar, ticket, assistant conversation, confirmation, and audit records remain authoritative. No destructive migration, reseed, or credential change is permitted.

## Compatibility and Rollout

Older clients continue using existing endpoints and periodic refresh. New coordination fields and endpoints are additive. Until a device registers the new capability, it behaves as a single-device client and cannot be selected for automatic failover.

Recommended rollout order:

1. Add device identity, revocation, and organization-scoped connection model.
2. Add authenticated event delivery and client invalidation.
3. Convert meeting presence and signaling from user-only to user-plus-device connections.
4. Add participant-level host mute and request-to-speak routing.
5. Add audio lease, explicit handoff, generation fencing, and rollback.
6. Add backup preference, learning, eligibility, warning, and automatic failover.
7. Mirror Ask V conversations, confirmations, progress, and results.
8. Add cross-device surface context and authorized Ask V action targeting.
9. Add meeting-aware upload destination and progress synchronization.
10. Add call ringing and answer deduplication across devices.
11. Add conflict handling, device settings, audit, accessibility, and localization.
12. Run exact-tree validation, hands-on multi-device tests, and the full seven-track ship.

## Acceptance Tests

### Authorization and isolation

- A device cannot register, subscribe, or act without an authenticated session.
- Device coordination is restricted to the active organization membership.
- An organization switch invalidates old context and confirmations.
- An administrator can revoke a device only within the administrator's company.
- Device identity never expands Ask V tool, file, ticket, meeting, payroll, or billing access.
- Cross-company and cross-user event access is denied without revealing resource existence.

### Shared work with independent screens

- iPhone owns meeting audio while desktop opens and updates a ticket.
- Tablet uploads a receipt while another device remains on meeting notes.
- Meeting membership persists while each device navigates elsewhere.
- Each device's route remains unchanged when another device navigates.
- The persistent meeting bar accurately reports meeting and audio state.
- A meeting-context upload defaults visibly to the meeting, can be redirected, and appears everywhere after completion.

### Ask V

- The same conversation, confirmation, progress, and result stream appears on all active devices.
- A phone voice command can use an authorized desktop page context without moving audio.
- Ambiguous multi-device context produces one concise clarification.
- One confirmation executes one tool action even when two devices respond.
- A denied or stale action remains denied after rerouting to another device.
- Text and voice produce the same authorized tool behavior.

### Audio and meetings

- Only one device can hold the transmit lease.
- Passive device activity never moves audio.
- Explicit handoff mutes the prior device before activating the destination.
- Delayed callbacks from a former owner cannot publish audio.
- Failed handoff restores the prior owner or lands safely muted.
- Phone battery or network loss fails over to a pre-authorized desktop after the warning.
- Failover does not occur to an offline, wrong-organization, revoked, background-ineligible, or permission-denied device.
- A returning original device remains a companion.
- One device leaving does not remove a user whose other device remains present.
- Signaling messages reach only the intended device connection.

### Moderation

- Host and co-host can mute an attendee across all devices.
- An ordinary attendee and an unassigned organization administrator cannot impose or release host mute.
- Host mute survives reconnect, handoff, and newly joined devices.
- Host-muted devices cannot transmit or automatically unmute on failover.
- Request to speak reaches the host, then co-hosts, with notification-only administrator fallback.
- Releasing host mute permits self-unmute but does not turn on the microphone remotely.

### Concurrency and recovery

- Simultaneous edits produce a preserved conflict, not silent overwrite.
- Retried uploads, schedules, tickets, and Ask V confirmations remain idempotent.
- Event reconnect catches up from a cursor without duplicate effects.
- Missing cursor history triggers an authorized canonical refetch.
- Call acceptance on one device cancels ringing on every other device.
- Notification acknowledgement synchronizes across devices.
- Device revocation terminates its streams and triggers safe audio recovery.

### Platform and quality gates

- Web supports two browser sessions and responsive desktop/tablet layouts.
- iOS and TestFlight support phone audio ownership, companion behavior, file selection, background/foreground transitions, and failover eligibility.
- Voice, meeting, call, Ask V, upload, calendar, ticket, accessibility, English/Spanish parity, and offline/reconnect suites pass.
- Root typecheck, web, mobile, API, library, isolated database, and browser end-to-end gates pass on the exact release tree.
- Manual testing covers real iPhone plus desktop and iPhone plus tablet combinations, AirPods routing, permission denial, battery/network loss, and host moderation.

## Release Requirements

The implementation is not complete at source acceptance. A requested full ship must follow the repository's seven-track release rule: commit, push and advance `main`, publish web, deploy API and additive migrations, verify production Supabase-backed behavior, publish iOS OTA when compatible, and build and submit TestFlight. Native coordination or audio changes require a new TestFlight build rather than OTA-only delivery.

The release handoff must identify the exact commit, migration result, web and API health, OTA decision, TestFlight submission, automated evidence, and hands-on multi-device evidence or any device-only evidence still awaiting the user.

## Separate Future Project: Demo Data Anonymization

The Exxon-to-Remington request is intentionally excluded from this implementation. Its first phase will anonymize Exxon in place while preserving stable organization, site, ticket, assignment, and history relationships; rename visible company, account, and well information; change visible demo email addresses without rotating canonical passwords; and delete nothing. One additional vendor and one additional partner will be selected only after that pilot is verified. Any later deletion of unrelated tickets requires a separate dependency audit and explicit per-incident authorization.
