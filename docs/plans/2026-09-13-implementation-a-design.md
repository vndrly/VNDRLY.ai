# Implementation A — Unified Field Operations Design

**Status:** Approved for implementation planning
**Date:** 2026-09-13
**Release shape:** One coordinated full ship with internally staged, additive delivery
**Platforms:** Web, iPhone, and iPad; manual incident reporting everywhere; supported crash signals only on eligible devices

## 1. Product outcome

Implementation A turns VNDRLY into a continuous, voice-first field operations system. A worker can begin a shift with Ask V in an earpiece and move through schedules, Gate, location sharing, trips, inventory custody, communications, meetings, forms, and incidents without navigating menus. Ask V remains one assistant to the user, even though its implementation is divided into focused capability modules.

The same release also adds vendor-managed subcontractors, scoped cross-company collaboration, a general asset and custody register, incident awareness, automatic Gate presence, site operations displays, company-sponsored worker subscriptions, and a secure employee invitation/onboarding path.

## 2. Architecture decision

Use modular capabilities behind one coordinated release. Shared foundations own portable identity, organization context, sponsorship scope, authorization, policy, audit events, idempotency, notifications, and real-time delivery. Domain modules own workforce, communications, assets, Gate/location, safety, entitlements, billing, and operations displays.

Use the existing Work Hub event stream as a limited append-only event ledger for audit, live updates, offline reconciliation, and operational projections. Do not convert the application to full event sourcing. Existing relational tables remain the authoritative current state.

All database changes are additive. New behavior is protected by company/site feature flags, native capability checks, and emergency disable switches. No destructive migration is permitted.

## 3. Global invariants

1. Ask V has product capability parity: if a user can view or perform an action in VNDRLY, Ask V can explain it, find it, perform it within the same authority, or open the exact in-place confirmation surface.
2. Ask V never enlarges authority. Every action is evaluated against the signed-in identity, active membership, sponsorship, site, crew, relationship, and device context.
3. Read, search, summarize, draft, and personal reversible actions may execute directly when requested. Sending, publishing, inviting, scheduling others, changing hours, modifying access, deleting, recording, moderating, billing, and cross-company actions require a brief explicit confirmation.
4. Voice recognition is never identity proof. Identity comes from the authenticated account and trusted device.
5. Every accepted mutation has an operation identifier, audit actor, source device, original event time, server receipt time, scope, and result.
6. Offline mutations are queued locally, encrypted by the platform storage boundary, replayed idempotently, and reconciled without duplicate effects.
7. Conflicting writes never silently overwrite one another. The user receives a clear conflict result and the authoritative state.
8. Site, sponsor, company, and partner boundaries apply equally to API, UI, real-time streams, exports, and Ask V.
9. Safety reporting remains available when AI, mapping, transcription, or crash-detection services are degraded.
10. Web, iPhone, and iPad expose equivalent business workflows; native-only sensing is capability-gated.

## 4. Portable identity and vendor-managed subcontractors

### 4.1 Managed organizations

A vendor may create a `managed subcontractor organization` such as NewTek without creating a full VNDRLY vendor tenant. The managing vendor is the sponsor. The managed organization has a legal/display name, verification state, sponsor relationship, contacts, workers, and conversion history.

Only vendor organizations may sponsor managed subcontractors in this release. The data model must allow a future partner sponsor type without changing worker identity keys.

### 4.2 Portable workers and sponsorships

A person has one VNDRLY user identity. That identity may have multiple simultaneous sponsorships from different vendors. Each sponsorship independently stores its status, role grants, site/crew assignments, policy acceptance, billing seat, and sponsor-owned operational history.

One sponsor cannot see another sponsor's assignments, records, communications, or location history. A sponsored worker cannot inherit its sponsor's external partner or vendor relationships. The only exception is an explicit invitation into a specific shared item; that invitation does not grant downstream directory access.

### 4.3 Roles

- `Gatekeeper`: routine Gate and site work inside assigned scope.
- `Gate Supervisor`: shift assignment, coverage, hours review, and crew/site management inside assigned scope.
- `Foreman`: broader crew authority where already supported.
- `Managed Company Manager`: sees and manages only workers employed by the managed company.
- `Asset Manager`: catalog, custody policy, audits, merges, holds, and retirement inside assigned scope.
- `Safety Manager`: escalation policy, incident response, evidence holds, and closure inside assigned scope.
- `Operations Display`: non-person device identity; read-only operational presentation.

Roles and employment are independent. A NewTek employee may be a Gate Supervisor for everyone at an assigned MidCon site without receiving general MidCon administration or payroll authority.

### 4.4 Conversion to a full vendor

An authorized representative may claim and verify the managed organization. Conversion creates/activates the full vendor organization without replacing worker identities or losing schedules, hours, communications, or asset history. NewTek-owned records become available to NewTek. Each former sponsor retains its own historical assignments, audit records, and access boundaries.

## 5. Secure employee invitation and onboarding

When an authorized company administrator creates a worker account:

1. VNDRLY creates the user, membership/sponsorship, selected subscription, and a pending invitation.
2. VNDRLY generates a cryptographically random single-use activation token and stores only its hash.
3. The invitation email names the sponsoring company, shows the username, and links to the VNDRLY activation screen.
4. No temporary or reusable password is created, displayed, logged, or emailed.
5. The employee opens the link, creates the first password, verifies the invite context, and completes onboarding.
6. The token expires after 24 hours, is invalidated after use, and may be revoked or replaced by a resend.
7. A new resend invalidates previous unused links.
8. The admin can see `pending`, `delivered`, `opened`, `claimed`, `expired`, `revoked`, or `delivery failed` without seeing the token.
9. Ask V can explain invitation status, resend after confirmation, and guide the employee through onboarding.

The employee's consolidated Work Participation Authorization clearly itemizes active-shift location tracking, automatic Gate presence, automatic transcription in covered meetings, schedule acknowledgements, safety escalation, and sponsor/site data sharing. Acceptance is versioned, timestamped, and sponsor-specific.

## 6. Workforce, scheduling, and hours

The Gate Supervisor owns routine shift assignment. Partner and sponsoring-vendor users with appropriate scope may view site schedules. NewTek managers see NewTek workers; a separately assigned Gate Supervisor may manage all workers in the assigned site or crew regardless of employer.

Required staffing templates and unexpected vacancies both produce uncovered-shift records. The calendar visibly marks uncovered intervals and permits an authorized supervisor to create a shift and assign a worker.

### 6.1 Assignment acknowledgemen

Every new or materially changed assignment requires employee acknowledgement. The audit record includes delivery, view, response, reminder, and subsequent schedule changes.

Default deadline:

- four hours after assignment or 24 hours before shift start, whichever occurs first;
- 30 minutes for urgent same-day assignments.

Push reminders go to the worker at 24 hours and one hour before the shift. The Gate Supervisor is notified if the 24-hour reminder remains unacknowledged or the shift is uncovered.

### 6.2 Coverage and no-show escalation

Uncovered-shift escalation begins with the assigned Gate/Shift Supervisor, then moves to the MidCon administrator chain if unaddressed:

- shift begins within four hours: 15-minute response window;
- shift begins within 24 hours: one-hour response window;
- later shift: four-hour response window.

At shift start, the worker and Gate Supervisor receive a private reminder. At 15 minutes without valid check-in, the shift is marked at risk/no-show and escalated to the MidCon administrator chain.

### 6.3 Assignment guards

Expired required credentials, paused/terminated accounts, and overlapping shifts are hard blocks. Overtime and insufficient-rest conditions are warnings that an authorized supervisor may override with a recorded reason.

## 7. Ask V unified capability contrac

Ask V presents one identity, voice, memory, and continuous session. Internal capability modules are not exposed as different assistants. Context includes signed-in identity, active organization, sponsorship, site, crew, shift, vehicle, device, communication, and current task.

Ask V capabilities cover:

- identity, authorization, onboarding, and invitations;
- workforce, schedules, acknowledgements, hours, and escalation;
- managed subcontractors and conversion;
- Gate, visits, site presence, trips, location, and ETA;
- inventory, custody, condition, provisional assets, and evidence;
- incidents, safety escalation, and response workspaces;
- chat, calls, meetings, moderation, and room devices;
- transcription, attendance, decisions, summaries, and follow-ups;
- tasks, forms, checklists, files, and knowledge search;
- payroll/accounting exports and operational reports;
- entitlements, subscriptions, pause, termination, and reactivation;
- notifications, offline synchronization, display control, and health diagnostics.

Ask V understands natural phrasing, resolves obvious context, asks one short clarifying question only when ambiguity changes the action, and reads back the consequential effect before confirmation. It never claims success until the authoritative API response or durable offline receipt exists.

## 8. Communications, meetings, and transcription

Sponsored users receive normal Work Hub communication capabilities inside permitted crews/sites and any company-wide sponsor policy. Cross-company discovery is relationship-based through a ticket, site, crew, contract, approved organization relationship, or explicit invitation. There is no global people directory.

Broader company-to-company communication requires both organization administrators to approve it. Either side may revoke future access without deleting legitimate communication history.

### 8.1 Ask V as participan

Ask V appears by default in chats, calls, and meetings as `VNDRLY Assistant`. It is visibly non-human, does not count for attendance or quorum, and remains silent unless directly addressed. It may transcribe, summarize, capture decisions/actions, coordinate approved files, and answer addressed questions. Hosts can pause or remove it.

### 8.2 Participation authorization

Automatic transcription is a verified company policy requiring administrator compliance attestation and counsel-approved onboarding language. Covered users accept once during onboarding. A persistent indicator is always displayed, and transcription begins automatically when a covered meeting starts.

An invited person who has not accepted appears as a grayed, view-only participant. They cannot send chat or microphone audio. Ask V presents a private in-meeting authorization card. Tap or explicit voice acceptance activates participation immediately without leaving or rejoining and applies to future covered meetings. The meeting never waits for them, and an administrator cannot accept on their behalf.

Raw audio/video recording is a separate company setting from transcription. Raw media is deleted after 30 days. Transcripts and summaries follow the normal retention policy. A legal hold, incident, dispute, or evidence-preservation action suspends deletion for the specific recording until released.

## 9. Inventory and custody

Use one company-scoped asset registry with a universal record plus category-specific attributes. Separate legal owner, responsible company, current location, and current individual holder.

Supported identifiers include VIN, license plate and issuing jurisdiction, fleet number, manufacturer serial number, model, and VNDRLY QR/asset tag. Identifiers and photos are optional by default but may be made mandatory by company and category policy.

Workers may self-check out ordinary authorized assets. A company may require approval for selected categories or values. Every checkout/return includes a condition selection and explicit worker confirmation. Mileage, fuel, accessories, detailed notes, and photos appear when relevant or required.

Unknown identifiers create provisional assets so work can continue. Asset Managers review them. Possible duplicates are suggested but never auto-merged; an approved merge retains both histories and evidence.

Damage, missing, or stolen reports place an asset on protective hold, remove it from availability, create an incident, and notify the responsible supervisor/Asset Manager. Only authorized review clears the hold.

VIN is the permanent vehicle identity when known. Drivers routinely use plate plus jurisdiction. Current and historical plates are aliases. A vehicle's first appearance at Gate may create a provisional asset, later enriched with VIN without changing history.

## 10. Gate, trips, location, and site presence

A verified worker/vehicle approaching a site appears green only when identity, employer, vehicle, assignment, credentials, and expected visit checks pass. Amber means review needed, red means a defined access problem, and gray means unknown or insufficient information. A camera may support human verification, but the marker never claims camera verification unless a real camera integration establishes it.

Verified entry and exit are automatic. Directional geofence crossing plus brief presence inside/outside rejects GPS drift and drive-bys while preserving the original crossing time as arrival/departure.

An active trip links authenticated driver, vehicle, assignment, and destination. Ask V infers the destination from the current assignment and asks for a simple confirmation unless ambiguous. Authorized viewers may ask for ETA; responses include freshness/staleness. Hands-free Gate logging finalizes only while stationary or within the Gate area; while moving it saves a draft.

Workers accept active-shift tracking once during onboarding. Tracking begins and ends automatically with a scheduled shift, approved early start, or authorized check-in. Opening the app outside work does not expose location. The UI shows a persistent tracking indicator and pause control; paused tracking is visible as signal unavailable rather than a fabricated location.

Ordinary coworkers see assignment site and work status. Exact live location/route is limited to supervisors, dispatchers, company administrators, and the partner responsible for the current site. Off-duty markers disappear; authorized historical records remain.

Unknown or missed Gate entries can be reconciled after the fact. Preserve observed arrival, actual departure, facts supplied later, and the Gatekeeper who completed the record. Routine cases may be closed by a Gatekeeper; conflicts and safety/access issues go to the Gate Supervisor.

## 11. Safety and crash awareness

Manual incident reporting ships on every platform. On eligible Apple devices, a first-party native bridge consumes SafetyKit severe-crash events only when the required entitlement and device permission are available. Apple approval does not block the overall release. No outside crash-detection API is used.

A lightweight on-device fallback may combine active-trip state, speed change, motion, and location confidence. It must label the result `possible crash`, never a confirmed crash.

After a possible crash, Ask V uses a loud 60-second response window with voice and screen choices: `I'm okay` and `Get help`. Lack of response notifies the company safety chain. Emergency calling remains Apple's system or an explicit user tap/spoken confirmation; VNDRLY never silently calls emergency services from inference.

Ask V uses short, one-question-at-a-time, stress-aware prompts. Immediate injury, danger, and blocked-traffic questions come before photos or administrative details. After confirmation, VNDRLY creates an incident, alerts the configured supervisor/dispatcher/safety/admin chain, updates the shift, requests acknowledgement, escalates until accepted, and opens a scoped incident workspace.

If no safety chain exists, all active company administrators are alerted and the company receives a persistent configuration warning. Incident reporting never becomes unavailable. Only the assigned responder, Safety Manager, or company administrator may close an incident. The worker may append facts/evidence but cannot rewrite or delete the original report.

## 12. Operations displays

Operations displays use dedicated non-person identities and site/view grants. They are read-only for business actions, reconnect automatically, and support privacy modes. Ask V can place approved views on named monitors after verifying the speaker through a signed-in companion device or equivalent trusted context.

A display may join a meeting as a labeled room device. Camera and microphone begin off and may be controlled only by the meeting host or an authorized person in that room.

## 13. Entitlements, prospect adoption, and billing

### 13.1 Prospective partner workspace

Work Hub may be live for real, invited, consenting prospective Flywheel participants. Before official company authorization, they are verified pilot participants, not company administrators, and cannot bind Flywheel or create official company-wide operations. Their identities, communications, files, and legitimate user-created records persist when the workspace becomes official.

Modules stay visible. Entitled actions operate on real data. Unentitled actions open a useful preview/explanation/request-access experience, not an error. Sample data is clearly labeled and removable; user-created records are permanent. Role restrictions and commercial entitlements are explained separately.

### 13.2 Founding Site

One exact Flywheel location receives a Founding Site entitlement for its operational life. The entitlement is tied to the permanent site record/location, cannot be transferred, and does not cover another existing or new site. Additional sites require paid activation.

### 13.3 Worker subscriptions

The company, never the employee, pays a recurring monthly subscription for each created worker account. Creating the account and confirming the charge starts the subscription before first login. The confirmation screen shows plan, monthly price, payor, renewal date, and resulting seat count.

One worker used at multiple sites remains one subscription for the paying company. Plans include a reduced Gate-only option and a full worker option including Work Hub and Ask V.

Lifecycle states:

- `active`: access and billing active;
- `paused/on_leave`: access suspended, billing stops at the next renewal, and identity/history/roles/certifications/preferences are preserved; pauses operate in full billing periods;
- `terminated`: access revoked immediately, future billing canceled, and identity archived without deleting operational or audit history;
- `reactivated`: the same identity and history return.

The UI uses `Terminate and archive`, not `Delete`, for employment separation. Privacy deletion remains a separate legal process.

## 14. Offline, conflict, notification, and health safeguards

Gate actions, asset custody, shift acknowledgements, tasks, and incidents use the existing native Work Hub queue extended with domain-specific schemas. Safety drafts and emergency-call access never depend on successful synchronization.

Every command defines conflict semantics. Commutative appends merge; exclusive custody and schedule versions use optimistic concurrency; duplicate crossings coalesce by person/vehicle/site/direction/time window; billing and access operations require server authority and do not finalize offline.

Urgent notifications use persistent acknowledgement, retry, escalation, and quiet-hours bypass for safety/shift-critical events. Ordinary messages honor user preferences. Failed delivery is visible to the responsible administrator.

The operations health view reports sync backlog, failed commands, missing permissions, stale location, unavailable transcription, failed alerts, unhealthy room/display devices, and safety-chain configuration.

## 15. Accessibility and language

All primary flows support English and Spanish with locale parity checks. Voice flows use confirmation read-backs, noisy-environment recovery, short prompts, visible text equivalents, and manual fallback. Interactive targets meet mobile accessibility sizing; status is not communicated by color alone.

## 16. Security and privacy

- Tokens are stored hashed, scoped to purpose, single-use, revocable, and expiring.
- Sensitive command payloads and raw transcripts are excluded from normal logs.
- Cross-company identifiers are not enumerable.
- Real-time streams filter before serialization and after reconnect.
- Exports apply the same record-level authorization as interactive queries.
- Location and raw media have explicit retention policies and legal-hold exceptions.
- Operations displays receive view-specific tokens with short renewal and remote revocation.
- Audit records are append-only and include overrides, merges, policy changes, invitations, billing changes, and incident closure.

## 17. Release gates

The release cannot advance until:

1. authority-matrix tests cover every role, sponsor, relationship, site, and Ask V capability;
2. offline/replay/conflict tests pass for Gate, custody, acknowledgements, tasks, and incidents;
3. emergency degraded-mode tests prove manual incident reporting and emergency actions without Ask V, Mapbox, transcription, push, or API availability;
4. privacy/retention tests cover location, transcription, raw media, evidence, exports, and cross-company filtering;
5. invitation security tests prove hashed one-time tokens, expiry, resend invalidation, revocation, enumeration resistance, and no emailed password;
6. web, iPhone, and iPad user flows pass; unsupported crash capability degrades safely;
7. `pnpm run typecheck`, `pnpm lint:i18n`, `pnpm run test:web`, `pnpm run test:mobile`, `pnpm run test:api`, and the aggregate `pnpm test` pass on the exact release tree;
8. fresh accessibility, security, and release reviews find no release-blocking issue;
9. all migrations are additive and safe on a production-shaped disposable database;
10. full ship completes commit, non-force main advancement, web, API/Supabase guarded migrations, iOS OTA compatibility decision, and TestFlight submission.

## 18. Explicit exclusions

- Partner-managed subcontractors are not activated in this release.
- No third-party crash-detection service is introduced.
- VNDRLY does not silently place emergency calls.
- Voice biometrics do not authenticate users.
- Raw audio/video is not retained beyond 30 days unless a specific hold applies.
- No destructive database migration, force push, production restore, or credential rotation is authorized.
- App Store production release is not included in `full ship`; TestFlight submission is included.
