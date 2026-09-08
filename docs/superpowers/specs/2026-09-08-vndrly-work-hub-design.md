# VNDRLY Work Hub Design

## Status and decision record

This specification defines one native web-and-iOS Work Hub release. It is vendor-administrator-first, includes partner parity, and enforces tenant isolation at every storage, API, event, search, notification, and AI boundary. Internal milestones may be enabled for staff and test tenants, but the customer-facing launch is one integrated release.

The selected approach is a first-party Work Hub domain inside the existing VNDRLY monorepo. It extends current comments, attachments, notifications, scheduling, AskV, role/membership authorization, audits, and mobile deep links through explicit adapters and shared policy services. It does not embed or rebrand a third-party collaboration suite.

Two decisions are intentionally deferred until implementation evidence is available:

1. The specialist provider for real-time audio, recording, and transcription. No provider package, account, or production configuration is approved by this specification.
2. Whether Microsoft 365 expands beyond read-only calendar synchronization. Native Work Hub functionality cannot depend on Microsoft.

## Goals

- Give every authenticated worker a personal Home view of conversations, assigned work, schedule, announcements, approvals, and meeting catch-up.
- Keep collaboration attached to operational context: organization, ticket, site, crew, or gate company/site.
- Provide durable threaded messages, files, voice notes, notes, tasks, checklists, forms, announcements, shifts, and audio meetings on web, iPhone, and iPad.
- Make partner participation equivalent wherever the partner is authorized, while keeping vendor-only and partner-only records private.
- Reuse the existing notification inbox, SSE delivery, iOS push, deep links, scheduling, Supabase Storage, AskV confirmation, audit, and approval patterns.
- Support unreliable field connectivity with idempotent writes, queued uploads/actions, retry/backoff, conflict visibility, and duplicate prevention.
- Ship the adjacent AskV, Gate, gate-records, and public-homepage checklist in the same final release without folding those surfaces into Work Hub ownership.

## Non-goals

- Video meetings, screen sharing, PSTN dial-in, webinar production, or breakout rooms.
- A general-purpose document editor, spreadsheet replacement, or Office clone.
- Microsoft 365 as an authentication, authorization, or authoritative scheduling system.
- Automatic AskV mutations. AskV may suggest actions, but a human must confirm every create/update operation.
- Cross-tenant discovery, global unscoped search, or implicit access based only on a guessed organization identifier.
- Replacing ticket comments or ticket-scoped PTT clips in the first migration. Existing content remains available and is projected into Work Hub context where authorized.

## Product model

### Personal Home

Work Hub Home is a personalized, permission-filtered dashboard rather than a shared channel. It contains:

- unread and mentioned conversations;
- tasks assigned to or created by the viewer;
- today's shifts, meetings, ticket schedule, and externally synchronized calendar events;
- open shifts the viewer is qualified to claim;
- required acknowledgements and approvals;
- recent files and notes from accessible contexts;
- meeting catch-up cards with recap, decisions, tasks awaiting confirmation, transcript, and playback when allowed;
- an AskV summary entry point with source links.

Cards deep-link to canonical objects. Home never caches or denormalizes authorization: every feed query applies current membership and context policy.

### Contextual channels

A channel has exactly one owning organization and one context:

| Context kind | Context key | Default audience |
| --- | --- | --- |
| `organization` | vendor or partner organization | active members of that organization |
| `ticket` | ticket id | authorized ticket participants and administrators |
| `site` | site-location id | authorized partner/vendor members assigned to the site |
| `crew` | vendor crew key | authorized vendor administrators, foremen, and crew members |
| `gate` | gate company plus optional site | authorized gate-company vendor administrators and assigned gate staff |

The owning organization defines tenant scope. A partner and vendor may collaborate in a ticket/site channel only when the existing relationship and object access rules authorize both. Membership revocation immediately removes reads, writes, live events, search results, downloads, and AI sources.

Channels support threads, `@mentions`, emoji reactions, unread positions, pinned items, attachments, durable voice notes, and system events. A reply belongs to one root message. Editing creates a version; deletion is a soft deletion with audit metadata and policy-controlled restoration.

Existing ticket and Hotlist comments remain canonical during rollout. An adapter projects them into ticket/Hotlist context feeds and preserves their existing endpoints. New Work Hub messages use the new domain tables. A later, separately approved data migration may unify the physical stores after parity is proven.

### Files, voice notes, and operational notes

Files are metadata records backed by private Supabase Storage objects. Access always flows through the API's authorization check and short-lived signed read URLs. Upload is request/finalize: the client receives an upload reservation, transfers bytes, and finalizes with the same idempotency key. Unfinalized objects expire through a worker.

Voice notes are message attachments with duration, codec/container metadata, waveform summary, and optional transcription status. Audio is durable and retryable; it is not a transient PTT packet. Existing ticket-scoped PTT clips remain available and can be linked from the associated ticket channel.

Operational notes are lightweight, versioned Markdown/plain-text documents scoped to a channel. They support title, body, mentions, attachments, edit history, and optimistic concurrency through a required version number. Concurrent edits return `409 work_hub.version_conflict` with the current version. This release does not provide character-level real-time co-editing.

### Tasks, checklists, forms, acknowledgements, and approvals

A task has a context, creator, optional assignee, due date, priority, status, recurrence source, checklist instance, and audit history. Only users visible within the task context may be assigned.

Checklist templates are organization-owned and versioned. Instantiation snapshots the template version so later template edits do not rewrite historical work. Checklist items can be required, evidence-bearing, and acknowledgement-bearing.

Form templates use a versioned JSON field definition limited to text, number, date/time, boolean, single/multiple choice, photo/file, signature acknowledgement, and reference fields. Submissions are immutable snapshots; corrections create a new version linked to the prior submission. Recurrence rules use a constrained server-validated recurrence model and timezone rather than arbitrary client cron text.

Acknowledgements record the exact subject type, subject version, user, timestamp, and optional acknowledgement text. Approval requests record ordered or parallel steps, decision, actor, timestamp, comment, and the subject version reviewed. Existing VNDRLY approval derivation remains authoritative for current ticket/accounting workflows; Work Hub adds generic operational approval requests without bypassing those domain rules.

### Announcements

Authorized organization administrators create targeted announcements for users, roles, crews, sites, or explicit channel audiences. The server expands and snapshots recipients at publish time. Required-acknowledgement announcements remain on Home until acknowledged or expired. Urgent delivery may bypass digest batching but still honors channel enablement and platform safety limits. Delivery, view, acknowledgement, edit, and withdrawal are audited.

### Shifts and unified calendar

Shifts belong to an organization and may be tied to site, crew, ticket, or gate context. They support assigned shifts, availability windows, open shifts, claim requests, administrator assignment, swap requests, and approval. The server evaluates overlap, rest-window, existing ticket schedule, crew membership, active employment, and certification/qualification constraints. Warnings are stable codes with severity `warning` or `blocking`; only authorized administrators may override configured warnings, and every override is audited.

The unified calendar merges, without copying away ownership:

- Work Hub shifts, task due dates, checklist/form recurrence instances, announcements, and meetings;
- existing ticket scheduling/reminders and foreman schedule;
- optional read-only Microsoft 365 events.

Each event identifies its source and authority. VNDRLY events are edited through their owning domain. Microsoft events are labeled external and read-only. Existing ICS export remains supported and is extended with accessible Work Hub calendar items.

### Audio meetings

Meetings are audio-only for this release and are joined inside authenticated VNDRLY web or iOS clients using desktop, iPhone, or iPad microphones and speakers.

Meetings may be immediate, scheduled, or recurring and may be attached to any Work Hub channel. Roles are `host`, `co_host`, `speaker`, and `participant`. In-room controls include mute/unmute, active-speaker indication, participant list, text chat, hand raise/lower, and host moderation. Scheduling includes invitees, RSVP, reminders, agenda, and recurrence. The server records attendance join/leave intervals.

Recording and transcription are off unless enabled by organization policy and activated by an authorized host. Before capture begins, every participant sees the policy and a consent state. Users who do not consent must leave or remain blocked from joining a recorded session according to the organization's explicit policy. The audit log records policy version, consent response, and capture start/stop actors and times.

After processing, the catch-up page presents agenda, attendance, human notes, AskV recap, decisions, source-linked suggested tasks requiring confirmation, timestamped transcript, and synchronized playback. Download/export buttons appear only when policy and role allow them. A transcript segment links to a playback timestamp and records its provider confidence metadata without exposing provider identifiers to clients.

### Microsoft 365 Connect

Company administrators may create a `Microsoft 365 Connect` connection and select one Outlook, shared, or company calendar for initial read-only synchronization. OAuth credentials and refresh tokens are encrypted at rest and never returned to clients. A cursor-based worker imports event identifiers, title, time, location, organizer, attendee display data allowed by consent, update marker, and cancellation state.

Imported events are labeled `Microsoft 365 · External` and remain read-only. VNDRLY schedules are authoritative; synchronization never overwrites a VNDRLY shift, task, ticket schedule, or meeting. Disconnect revokes the connection, stops synchronization, and applies the configured retention rule to cached external event metadata.

The connector contract reserves capabilities for later task and file synchronization, but only `calendar.read` is enabled in this release. Native Work Hub remains complete when no connector exists or Microsoft is unavailable.

## Architecture and component boundaries

### Server modules

`artifacts/api-server/src/work-hub/` owns use cases and policy orchestration:

- `context-access.ts`: resolves channel context and returns an explicit capability set for the authenticated session.
- `commands.ts`: idempotent mutations and optimistic concurrency.
- `queries.ts`: permission-filtered Home, channel, calendar, catch-up, and search reads.
- `events.ts`: tenant/user-scoped event envelopes and SSE publication.
- `notifications.ts`: maps domain events to existing notification inbox, push, deep-link, urgent, and digest behavior.
- `offline-commands.ts`: validates client operation ids and returns canonical reconciliation results.
- `retention.ts`: organization policy evaluation and scheduled purge/anonymization candidates.
- `search.ts`: permission-aware indexing and result hydration.
- `audit.ts`: immutable actor/action/subject/version records.

Route files under `artifacts/api-server/src/routes/workHub*.ts` are thin validation and response adapters. They never construct tenant filters independently.

### Shared contracts

Handwritten input/output schemas live in `lib/api-zod/src/work-hub/` until the OpenAPI generator emits the public client types. Stable enums and warning/error codes are shared. API changes update the OpenAPI document and regenerate `lib/api-client-react`; clients do not maintain divergent request shapes.

### Web

`artifacts/vndrly/src/features/work-hub/` owns the web Home, channel, calendar, search, task/form/announcement flows, meeting lobby/room/catch-up, policy admin, and connector settings. Existing layout, brand, TogglePill/ImagePill, notifications, and AskV components remain shared dependencies. Route-level components are lazy-loaded.

### iOS

`artifacts/vndrly-mobile/features/work-hub/` contains shared view models, API hooks, sync queue, upload queue, and adaptive components. Expo Router screens under `app/work-hub/` compose those features. The current route manifest adds Work Hub for authorized roles on iPhone and iPad. Mobile uses existing push/deep-link routing and native audio-session helpers.

### Provider adapters

The audio boundary is implemented before a provider is selected:

```ts
interface RealtimeAudioProvider {
  createRoom(input: CreateAudioRoomInput): Promise<AudioRoomLease>;
  createParticipantToken(input: ParticipantTokenInput): Promise<ParticipantToken>;
  endRoom(input: EndAudioRoomInput): Promise<void>;
  startRecording(input: RecordingCommand): Promise<RecordingHandle>;
  stopRecording(input: RecordingCommand): Promise<void>;
  verifyWebhook(input: RawWebhook): Promise<VerifiedAudioEvent>;
}

interface TranscriptionProvider {
  submit(input: TranscriptionJobInput): Promise<TranscriptionJobHandle>;
  getStatus(input: TranscriptionStatusInput): Promise<TranscriptionStatus>;
  cancel(input: TranscriptionCancelInput): Promise<void>;
}
```

Provider selection criteria are: web and React Native support; audio-only room controls; regional availability; participant-token isolation; active-speaker events; recording controls; webhook signing and replay protection; transcript timestamps and speaker mapping; exportable recordings; retention/deletion APIs; accessibility; observability; documented service limits; data-processing terms; data residency; cost under expected concurrent participant/minute assumptions; and a tested exit/export path. Selection requires a short decision record, security review, proof-of-concept on web and physical iOS devices, and explicit approval before installation.

`CalendarConnector` similarly exposes connect, list-calendars, start-sync, continue-sync, revoke, and health methods. Its capability declaration is fixed to `calendar.read` for this release.

## Data model

Every new tenant-owned table contains `owner_org_type`, `owner_org_id`, `created_at`, and stable audit identifiers where applicable. Foreign keys, unique constraints, and indexes supplement rather than replace application policy.

Core tables:

- `work_hub_channels`: owner, context kind/id, name, status, policy overrides; unique owner/context key.
- `work_hub_channel_members`: explicit additions/exclusions only; derived context membership is evaluated live.
- `work_hub_messages`: channel, root/parent, author, kind, body, current version, client operation id, edit/delete metadata.
- `work_hub_message_versions`, `work_hub_mentions`, `work_hub_reactions`, `work_hub_read_cursors`.
- `work_hub_files`: storage key, media metadata, checksum, upload/finalization state, retention class, owning subject.
- `work_hub_notes`, `work_hub_note_versions`.
- `work_hub_tasks`, `work_hub_task_events`, `work_hub_task_dependencies`.
- `work_hub_checklist_templates`, `work_hub_checklist_template_versions`, `work_hub_checklist_instances`, `work_hub_checklist_items`.
- `work_hub_form_templates`, `work_hub_form_template_versions`, `work_hub_form_instances`, `work_hub_form_submissions`.
- `work_hub_acknowledgements`, `work_hub_approval_requests`, `work_hub_approval_steps`.
- `work_hub_announcements`, `work_hub_announcement_recipients`.
- `work_hub_availability`, `work_hub_shifts`, `work_hub_shift_assignments`, `work_hub_shift_requests`.
- `work_hub_meetings`, `work_hub_meeting_occurrences`, `work_hub_meeting_participants`, `work_hub_meeting_attendance`, `work_hub_meeting_chat`, `work_hub_meeting_artifacts`, `work_hub_transcript_segments`, `work_hub_meeting_consents`.
- `work_hub_calendar_connections`, `work_hub_external_calendars`, `work_hub_external_events`, `work_hub_sync_cursors`.
- `work_hub_notification_state`, `work_hub_client_operations`, `work_hub_audit_log`, `work_hub_retention_policies`.

Search uses a tenant-scoped `work_hub_search_documents` projection containing subject type/id, owner, context, visibility revision, text search vector, and freshness marker. It contains no attachment bytes, secret tokens, or inaccessible transcript content.

Identifiers exposed to clients are UUIDs. Existing integer-keyed objects remain referenced by their current ids. Client operation ids are UUIDs unique per authenticated user and command kind.

## Authorization and tenant isolation

Every request follows this order:

1. authenticate the cookie/session;
2. resolve current role and active organization memberships from the database;
3. resolve the requested Work Hub subject to owner and context;
4. derive capabilities from role, membership, relationship, assignment, subject state, and organization policy;
5. execute a query already constrained by owner and accessible context;
6. filter response fields such as transcript/download details by capability;
7. publish events and notifications only to computed recipients.

The capability vocabulary includes `channel.read`, `channel.write`, `channel.manage`, `file.download`, `task.assign`, `announcement.publish`, `shift.manage`, `meeting.host`, `meeting.record`, `meeting.artifact.download`, `policy.manage`, and `connector.manage`.

Vendor administrators manage their vendor-owned Work Hub. Partner administrators have parity for partner-owned contexts and shared operational contexts. Field employees see only assigned/participating contexts. VNDRLY admins may support according to existing administrator rules, with all support reads and exports audited. Gate-company vendor administrators may search/export gate records only across sites currently authorized to their company.

Authorization tests use two vendors, two partners, shared and unshared sites/tickets, revoked memberships, and cross-tenant identifiers. A correct `404` is returned when revealing existence would leak another tenant's data; `403` is used when the object is visible but the action is not allowed.

## APIs and events

API families are grouped under `/api/work-hub`:

- `/home`, `/channels`, `/channels/:id/messages`, `/messages/:id/reactions`, `/read-cursors`;
- `/files`, `/notes`, `/tasks`, `/checklists`, `/forms`, `/acknowledgements`, `/approvals`;
- `/announcements`, `/availability`, `/shifts`, `/shift-requests`;
- `/calendar`, `/search`;
- `/meetings`, `/meetings/:id/join-token`, `/meetings/:id/attendance`, `/meetings/:id/chat`, `/meetings/:id/consents`, `/meetings/:id/catch-up`, `/meetings/provider-events`;
- `/connectors/microsoft-365` and sync-status endpoints;
- `/events` for permission-filtered Work Hub SSE.

List endpoints use cursor pagination with stable `(updated_at, id)` or `(created_at, id)` ordering. Mutations require `Idempotency-Key` and return the canonical resource plus `operationId`, `appliedAt`, and `replayed`. Updates require `If-Match` or an explicit expected version. Error codes are stable and localized by clients.

Event envelopes are versioned:

```json
{
  "version": 1,
  "sequence": 4812,
  "type": "work_hub.message.created",
  "owner": { "type": "vendor", "id": 12 },
  "context": { "kind": "ticket", "id": 481 },
  "subject": { "type": "message", "id": "uuid" },
  "recipientUserId": 45,
  "occurredAt": "2026-09-08T18:30:00.000Z"
}
```

SSE reconnect uses sequence gap detection and forces permission-filtered refetch when a gap exists. Provider webhooks are never forwarded directly; verified provider events are converted into VNDRLY domain events after room and tenant resolution.

## Notifications

Work Hub extends the current notification rows and preferences rather than creating a second inbox. New categories are `work_hub_messages`, `work_hub_tasks`, `work_hub_announcements`, `work_hub_schedule`, and `work_hub_meetings`.

Each domain notification stores a dedupe key, canonical web link, canonical mobile route, urgency, digest eligibility, and source version. Read/unread actions update one server-side notification state observed by web and iOS. Opening a notification marks it read only after successful destination resolution.

Urgent events include required announcements nearing deadline, imminent meeting changes, approved/denied swaps affecting the current shift, and blocking qualification changes. They deliver immediately through enabled in-app/push channels and may bypass quiet hours only when organization policy and user preference explicitly permit it. Digest-eligible activity includes non-mention thread replies, routine task changes, and non-urgent calendar summaries. Mentions, assignments, approvals, and required acknowledgements are immediate by default.

Every notification deep link is re-authorized at open time. If access has been revoked, clients show a neutral unavailable message and remove stale cached content.

## Offline and reconciliation behavior

Mobile persists a bounded encrypted/authenticated-user queue of command envelopes and upload reservations. Each envelope contains operation id, authenticated user id, active organization key, command kind, subject/context id, payload version, expected resource version, local timestamp, retry count, and dependency ids.

Rules:

- Text messages, reactions, read cursors, task/checklist updates, form drafts/submissions, RSVP, acknowledgements, shift requests, notes, voice notes, and file uploads can queue.
- Meeting join/host controls, provider consent start, connector setup, permission changes, exports, and destructive admin actions require connectivity.
- Queued uploads transfer first; dependent commands reference finalized file ids.
- Retry uses exponential backoff with jitter and server-provided `Retry-After`, pauses on authentication or organization-context change, and resumes after revalidation.
- A replayed operation returns the original canonical outcome. The server unique key is `(user_id, command_kind, operation_id)`.
- `409` conflicts are never silently overwritten. The client shows the server version and offers retry/merge where the domain supports it.
- `403/404` after access loss permanently fails the item, removes sensitive cached subject data, and explains that access changed.
- Optimistic placeholders use the operation id and are replaced, not duplicated, after reconciliation.

Web uses the same idempotency contract and may retain only short-lived retry state; durable offline parity is required on iOS.

## Search and AskV

Universal search covers accessible channels, messages, notes, tasks, checklist/form titles and submitted field text allowed by policy, announcements, shifts, meetings, transcripts, files, tickets, sites, and crews. Filters include organization, context, author/assignee, type, and date. Search snippets are generated only after the result passes current authorization. Removed, expired, or newly inaccessible records disappear after an authorization revision and are rechecked at hydration.

AskV uses the same search/query service and capability evaluation as human-facing search. Summaries include citations that deep-link to source messages, notes, tasks, meeting timestamps, tickets, or sites. AskV never receives raw provider tokens or unauthorized transcript/audio. Suggested tasks, announcements, schedule changes, or notes are drafts. Creation requires a confirmation card naming the target organization/context, action, assignee/audience, due time, and source links; confirmation produces the existing AskV action audit plus Work Hub audit entry.

## Retention, versioning, export, and audit

Organization policy defines retention classes for messages, deleted messages, files/voice notes, notes/versions, form submissions, meeting recordings, transcripts, attendance, external calendar cache, and audit logs. Platform minimums prevent an organization from shortening legally or operationally required audit retention. Legal hold freezes eligible records by subject/context.

Versioned content is append-only at the version layer. Soft deletion removes ordinary visibility but preserves the audit/version record until policy permits purge. A retention worker records counts, policy id/version, cutoff, and failures; bytes are deleted only after metadata authorization and reference checks.

Exports are asynchronous, scoped, watermarked with requester and generated time, stored privately with expiration, and audited. Export generation rechecks access both at request and download. Supported first-release exports are channel/notes/tasks/forms/announcements CSV or PDF bundles, shift/calendar CSV/ICS, gate records CSV, and meeting recap/transcript/attendance PDF/CSV plus recording download when policy permits.

The audit log records actor, effective organization, action, subject, prior/new version, source (`web`, `ios`, `askv`, `worker`, `connector`, `provider_webhook`), operation id, timestamp, and non-secret metadata. It never stores raw OAuth tokens, join tokens, or attachment bytes.

## Web and iOS UX

Web uses a three-region adaptive layout: Work Hub navigation, primary list/content, and optional detail pane. Smaller widths collapse to list → detail navigation. iPhone uses stacked routes and the current navigation tray; iPad uses the existing regular-width sidebar and split content. Both clients expose the same capabilities and states even when composition differs.

Core routes are Home, Channels, Tasks, Calendar, Meetings, Search, and Admin settings when authorized. Context pages also expose a Work Hub tab that opens the canonical channel. Empty, loading, queued, retrying, conflicted, access-revoked, and offline states have explicit copy. Audio controls expose accessible labels and do not rely on color alone. Transcripts support text sizing and keyboard/screen-reader navigation on web.

Brand-aware interactive controls use the existing `TogglePillButton`/`pickPillForBrand` doctrine; status uses fixed semantic colors and `ImagePill`/`TogglePill`. New strings ship in English and Spanish with locale parity.

## Adjacent same-release checklist

These items share the final release train but remain outside Work Hub domain ownership:

1. AskV listening displays a waveform; processing displays visually distinct animated dots. State and accessibility labels remain explicit.
2. Gate quick-action and duration buttons resolve through the current organization brand palette and approved pill/button primitives.
3. Gate selected-location typography is clearer and duplicated location information is consolidated.
4. `On Site Now` has a fixed height, shows current occupants first, contains separately scrollable recent activity, and preserves the existing Gate History link.
5. Gate-company vendor administrators receive permission-filtered search/export across authorized sites, with audit records and no broader vendor visibility.
6. The unauthenticated commercial homepage exposes sign-in, safe demo-request/demo-login actions, legal links, and support links. It never offers a production-data “test drive” or bypasses authentication.

These changes use existing Gate, AskV, and public-route components and have separate tests and acceptance criteria. Their code must not import Work Hub service internals.

## Additive migrations and storage

Schema delivery is split into guarded additive chunks under `lib/db/drizzle/`. Every table uses `CREATE TABLE IF NOT EXISTS`; every added column uses `ADD COLUMN IF NOT EXISTS`; indexes are created idempotently. Migrations may add foreign keys and validated constraints only after read-only prechecks prove existing rows comply. They never drop, truncate, rewrite, or restore live data.

The release sequence creates core messaging/file/policy tables, work-management tables, schedule/calendar tables, meeting/artifact tables, connector tables, then search projections and indexes. Backfills are resumable, bounded, keyed, and auditable. Existing comment projection requires no destructive copy.

Supabase Storage adds private Work Hub prefixes/buckets only if implementation confirms current private-object conventions cannot safely share the existing bucket. Provisioning is idempotent and included only when storage policy changes.

## Observability

Structured metrics and logs include:

- command count, replay rate, conflict rate, latency, and failures by kind;
- SSE connected clients, delivery lag, sequence gaps, and refetches;
- queue depth, oldest queued age, upload retries, orphan cleanup, and permanent failures;
- notification fan-out, dedupe, push success, digest delay, and deep-link failures;
- search indexing lag, authorization-filter rejects, and zero-result rate;
- meeting join latency, participant minutes, disconnects, consent outcomes, recording/transcription state and latency, webhook signature/replay failures;
- connector sync lag, cursor resets, throttling, token refresh failures, and disconnected state;
- retention/export job duration, row/byte counts, and failures;
- tenant-isolation denials and impossible owner/context mismatches as security signals.

Logs use opaque ids and exclude message bodies, transcript text, file contents, credentials, and audio tokens. Alerts cover sustained queue age, failed provider webhooks, recording stuck in processing, connector auth failure, notification backlog, and any isolation invariant violation.

## Feature flag, rollout, and internal milestones

The server-authoritative flag `work_hub_enabled` defaults off and supports platform, organization, and user allowlists. Meeting recording/transcription, Microsoft 365 Connect, exports, and urgent quiet-hour bypass have separate policy flags. Disabled clients hide entry points; direct routes and APIs return `404` without leaking feature existence.

Internal milestones are integration checkpoints, not separate customer releases:

1. Foundation: schema, capability service, idempotency, audit, events, flags, and isolation tests.
2. Communication: Home, channels, messages, reactions, unread, attachments, voice notes, notes, notifications, offline queue, and search projection.
3. Work coordination: tasks, checklists, forms, acknowledgements, approvals, announcements, shifts, warnings, and calendar.
4. Audio meetings: provider decision record and proof, room lifecycle, meeting UX, consent, artifacts, recap, and exports.
5. Optional connector: Microsoft calendar read sync, admin UX, health, revoke, and external labeling.
6. Adjacent checklist: AskV state visuals, Gate polish/records, and commercial homepage.
7. Release candidate: migrations, backfills, security/retention review, load/offline/accessibility/localization testing, production-like rehearsal, web deployment, iOS OTA/native TestFlight path as required, and one coordinated enablement.

No milestone is marketed or generally enabled independently. Rollback disables flags and stops workers while preserving additive data. Provider and connector outages degrade only their features; native messaging, work, and calendar remain usable.

## Testing strategy

- Unit: capability derivation, idempotency, recurrence, warnings, notification routing, retention, connector normalization, consent state, and provider event conversion.
- Database: unique keys, version increments, cursor ordering, recipient snapshots, immutable submissions, and additive migration reruns.
- API integration: role/context matrix, cross-tenant ids, revoked access, replayed commands, version conflicts, signed file access, search hydration, event gaps, exports, and webhook replay protection.
- Web: adaptive navigation, all Work Hub states, deep links, keyboard/screen-reader flows, meeting controls, and admin policy forms.
- Mobile: iPhone/iPad layouts, queued command/upload reconciliation, app restart, context switch, offline conflict/access loss, push read synchronization, audio interruptions, background/foreground transitions, and physical-device microphone/speaker tests.
- End-to-end: vendor admin creates channel/announcement/shift/meeting; partner participates only in shared context; field employee works offline and reconciles once; revoked user loses every surface; AskV cites sources and requires confirmation; Microsoft outage leaves native calendar intact.
- Security: object-id enumeration, tenant-switch races, signed URL expiry, export reauthorization, webhook signature/replay, OAuth token secrecy, transcript/download policy, and search index staleness.
- Performance: Home and channel pagination, fan-out to representative tenant sizes, SSE reconnect storms, search indexing, large exports, and meeting-provider limits.
- Gates: `pnpm lint:i18n`, `pnpm run typecheck`, `pnpm run test:web`, `pnpm run test:mobile`, `pnpm run test:api`, and root `pnpm test` on the exact release tree.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Cross-tenant disclosure through polymorphic contexts | One context-access service, owner columns, negative matrix tests, hydration recheck, opaque 404 behavior |
| Scope breadth destabilizes launch | Internal milestone gates, disabled-by-default flag, one integration contract, no public partial launch |
| Offline duplicates or wrong-org replay | Per-user command ids, active-org binding, dependency graph, server replay result, context revalidation |
| Audio provider lock-in or privacy gap | Adapter-first boundary, decision record, export/delete requirements, signed webhooks, explicit consent/policy |
| Search/AskV returns stale access | visibility revision, authorization at hydration, purge on revocation, cited source reauthorization |
| Notification overload | category preferences, urgent/digest rules, dedupe, recipient snapshots, quiet-hour policy |
| Calendar authority confusion | source badges, read-only external events, edits routed to owning domain, VNDRLY authoritative |
| Retention deletes referenced evidence | legal hold, reference checks, dry-run metrics, audited two-stage metadata/byte deletion |
| Existing comments regress | adapter projection, unchanged legacy endpoints, parity tests, no destructive migration |

## Acceptance criteria

1. Vendor administrators and partner administrators can use native Work Hub on web, iPhone, and iPad; partner access matches authorized shared contexts and never exposes vendor-private data.
2. Home accurately shows unread/mentions, assigned work, required acknowledgements/approvals, schedule, and meeting catch-up.
3. All five channel contexts support threads, mentions, reactions, unread state, files, durable voice notes, and versioned notes within policy.
4. Tasks, versioned reusable checklists/forms, acknowledgements, approvals, and targeted announcements work with audit history and recurrence.
5. Shifts, availability, open shifts, swaps, qualification/conflict warnings, and unified calendar behave consistently with existing ticket/foreman schedules.
6. Notifications synchronize read state across web/iOS, re-authorize deep links, honor preferences, and distinguish urgent from digest behavior.
7. Search and AskV return only authorized sources; AskV summaries cite sources and every mutation requires human confirmation.
8. Mobile survives offline creation, upload, restart, retry, duplicate replay, conflict, access revocation, and organization switching without duplicate server records.
9. Authenticated audio meetings support immediate/scheduled/recurring sessions, roles, mute, active speaker, participant list, chat, hand raise, RSVP/reminders, attendance, consent, agenda/notes, recap, confirmed suggested tasks, timestamped transcript/playback, catch-up, export, and policy controls.
10. The selected audio/transcription provider is chosen only after the recorded decision gate; provider failure does not break native Work Hub.
11. Microsoft 365 Connect is optional, admin-controlled, read-only for one selected calendar, labels external events, and never changes authoritative VNDRLY schedules.
12. Retention, versioning, legal hold, private downloads, export reauthorization, and immutable audit records pass policy tests.
13. The adjacent AskV, Gate, gate-records, and unauthenticated homepage checklist passes its separate acceptance tests.
14. All migrations are additive, guarded, rerunnable, and verified without destructive database operations.
15. All validation gates pass on the exact release tree, observability dashboards/alerts are active, and one coordinated web-and-iOS release is verified before general flag enablement.

## Release definition of done

The release is complete only when the native Work Hub, audio meetings, optional Microsoft calendar connection, and adjacent checklist are integrated behind production policy/feature controls; web and iOS behavior has been verified; additive migrations and storage policy have been applied safely; public/API/mobile release tracks are healthy; TestFlight submission is confirmed when native audio changes require it; and general availability is enabled through the server flag. Internal milestone completion alone is not a release.
