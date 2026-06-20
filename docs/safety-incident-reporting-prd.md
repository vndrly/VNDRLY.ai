# Safety & Incident Reporting — Product Requirements Document

**Product:** VNDRLY (vndrly.ai)  
**Industry:** Oil & gas field operations (partners, vendors, field employees, foremen)  
**Packages:** `@workspace/vndrly` (web), `@workspace/vndrly-mobile` (iOS), `@workspace/api-server`, `@workspace/db`  
**Status:** Approved for implementation — v1 scope locked (June 2026)  
**Related:** [`foreman-portal-spec.md`](./foreman-portal-spec.md), [`foreman-portal-workflows.md`](./foreman-portal-workflows.md), [`database.md`](./database.md)

---

## 1. Summary

VNDRLY today tracks **work** (tickets, GPS, crews, payables) and touches **safety adjacently** (visitor safety acknowledgment at check-in, employee certifications such as OSHA-10 and H2S, cert blocking on scheduled jobs). It does **not** provide a structured program for **field safety reporting, partner/vendor review, resolution, or safety metrics**.

This PRD defines a new **Safety Events** domain: mobile-first reporting from the pad, routed to the correct partner and vendor inboxes, closed with resolution notes, and surfaced on dashboards via a transparent **safety score** and **days without recordable** metrics. AskV gains read tools so operators can query safety status in natural language.

**Design principle:** Safety events are **not tickets**. Tickets carry office/accounting lifecycle and field GPS phases; safety events carry investigation, recordability, and HSE metrics. Events may **link** to a ticket when the hazard occurred during a job, but they remain independent records.

---

## 2. Problem statement (oil & gas context)

Field operations in oil & gas depend on contractors (vendors) working at partner-controlled sites (pads, wells, facilities). When something goes wrong—or almost goes wrong—programs fail when:

- Reporting requires a desk, email, or phone call instead of a 30-second mobile capture at the wellhead.
- Near misses are never logged, so leading indicators disappear until a recordable occurs.
- Partners cannot see vendor crew issues across their sites; vendors cannot track corrective follow-through.
- HSE leads lack a single inbox tied to **site + vendor + partner** context VNDRLY already owns.
- There is no auditable close-out trail for insurance, operator audits, or contractor prequalification.

Industry reference patterns (API RP 754 tier thinking, OSHA recordability, near-miss programs, CAPA) inform this PRD. VNDRLY v1 does **not** require full OSHA 300/301 export; it **does** capture recordability decisions and retention-friendly audit history so exports can follow in a later phase.

---

## 3. Goals

| Goal | v1 |
|------|-----|
| Field staff can report a safety issue in under 60 seconds on iOS | Yes |
| Anonymous reporting option for field users | Yes |
| Partner and vendor dashboards show open events and safety score | Yes |
| Partner/vendor can add resolution notes and close events | Yes |
| Injury / recordable path alongside near miss and unsafe condition | Yes |
| AskV can answer scoped safety questions with real data | Read-only tools |
| Mandatory safety video on every login | No — **soft banner** in v1 |
| Full CAPA (assignee, due date, verify photo) | **v1b** |

---

## 4. Non-goals (v1)

- OSHA Form 300 / 300A / 301 PDF export
- Root-cause templates (5-Why, fishbone, TapRoot)
- Toolbox talks / JSA / pre-job checklists
- Hard app lock until training video completes
- Replacing or merging ticket status workflow
- Anonymous reports hidden from VNDRLY admin or audit log
- Direct Postgres access from mobile (all via api-server, per [`database.md`](./database.md))

---

## 5. Locked product decisions

| Decision | Choice |
|----------|--------|
| Anonymous field reports | **Yes** — checkbox at submit; masked in partner/vendor UI |
| Event types in v1 | **Near miss, unsafe condition, injury/illness, property damage, observation** (+ recordability workflow for injuries) |
| iOS primary entry | **Home** — prominent “Report safety issue” |
| iOS secondary entry | **Ticket detail** — same form, pre-filled with ticket/site/vendor/crew context |
| Safety score in v1 | **Yes** — simple published formula (see §10) |
| Days without recordable | **Yes** — shown alongside score |
| Training videos | **Soft banner** on Home (and Profile) when overdue; no full app block |
| Resolve / counter in v1 | **Resolution notes + close** (partner and vendor can comment); full **CAPA in v1b** |
| Domain model | **Separate `safety_events` tables** — not a ticket subtype |
| HSE routing role | **`HSE / Safety Officer`** company-role pill on partner contacts and vendor office staff — every org must have ≥1 (see §6a) |
| Close authority | **Partner HSE only** may close safety events (vendor adds notes; partner HSE closes) |
| Stop-work | Field/foreman may trigger; sets site **Inactive**; only **Partner HSE** may reactivate site (web + iOS) |

---

## 6. Personas & permissions

| Persona | Report | Stop-work | Inbox | Triage | Notes | Close event | Reactivate site |
|---------|--------|-----------|-------|--------|-------|-------------|-----------------|
| Field employee | Yes | Yes | Own | No | No | No | No |
| Foreman | Yes | Yes | Own + crew | No | Yes (vendor) | No | No |
| Vendor w/ HSE role | Yes | No | Vendor-scoped | Yes | Yes | No | No |
| Partner w/ HSE role | Yes | No | Partner sites | Yes — recordable, HiPo | Yes | **Yes** | **Yes** |
| Partner (no HSE pill) | Yes | No | Yes | Limited | Yes | No | No |
| VNDRLY admin | Yes | Yes | All | Yes | Yes | Yes | Yes |

**Cooperating vendor visibility:** Same principle as notification Send to — a vendor sees events involving **their** crews and assignments; they do not see another vendor’s internal notes unless the event is shared at partner direction. Partner sees all events at **their** site locations.

**Anonymous events:** Partner and vendor UIs show reporter as “Anonymous field report.” Admin and immutable audit rows retain `reportedByUserId` for abuse investigation and legal retention.

---

## 6a. HSE company role (routing & close authority)

HSE is **not** a separate login role (`admin` / `member` / `ap` stay unchanged). It is the existing company-role pill:

**`HSE / Safety Officer`**

Already present in partner/vendor company-role pickers (`partner-detail.tsx`, `field-employees.tsx`) and in send-to routing (`PARTNER_OPS_ROLES` in `ticket-send-to.ts`).

### Requirements

1. **Every partner and every vendor** must have at least one active person tagged `HSE / Safety Officer` in their `roles[]` array (`partner_contacts.roles` or `vendor_people.roles`).
2. **Backfill:** `pnpm --filter @workspace/api-server run backfill:hse-roles` — idempotent; assigns HSE to the best available contact (prefers linked login, then ops/superintendent, else first contact).
3. **Safety event routing:** On submit, notify all users linked to contacts/people with the HSE pill for that partner site and vendor org (plus existing escalation for HiPo / stop-work).
4. **Close authority:** Only users whose active org membership resolves to a contact/person row with **`HSE / Safety Officer`** in `roles` may `POST …/close` on safety events. VNDRLY admin bypasses.
5. **Vendor HSE** triages and adds resolution notes but **cannot** close — partner HSE closes (including recordables).

New org onboarding (future): wizard step or admin warning if no HSE tagged before go-live.

---

## 6b. Stop-work & site activation (well status)

Stop-work connects field safety to **site operational status** already modeled on `site_locations` (`status`, `isActive`).

### Trigger (field / foreman — iOS + web report flow)

When a reporter checks **Stop work** (or event type implies immediate hazard):

1. Create safety event with `isStopWork = true`.
2. Set linked `site_locations.status = 'inactive'` and `isActive = false`.
3. Notify Partner HSE + Vendor HSE immediately (push + in-app; email when enabled).
4. **Block new ticket work at site:** ticket create / check-in / schedule assignment at that site returns a clear error until site is active again (`safety.site_inactive`).

### Reactivation (Partner HSE only — web Site Locations + iOS site detail)

1. Only a user with **Partner HSE** pill (or admin) may set `status = 'active'`, `isActive = true`.
2. UI on Site Locations page shows **Active / Inactive** badge; inactive sites visible to all authorized viewers; reactivate control visible only to Partner HSE.
3. On reactivation: append `safety_event_history` / optional `site_location_admin_audit_log` row; notify vendor HSE + field crews assigned to open tickets at site.
4. **Ticket resume:** open tickets at site that were paused by stop-work may proceed (no auto status change on tickets — site gate lifts; office decides per ticket).

### iOS + web parity

Site list and site detail must show inactive state and Partner-HSE-only reactivate on **both** platforms.

---

## 7. Event taxonomy (v1)

| `eventType` | Description | Typical reporter |
|-------------|-------------|------------------|
| `near_miss` | Close call with no injury or damage | Field, foreman |
| `unsafe_condition` | Hazard in environment (leak, trip, missing guard) | Field, foreman |
| `unsafe_act` | At-risk behavior observed | Foreman, partner |
| `injury` | Injury or illness — triggers recordability review | Field, foreman |
| `property_damage` | Equipment / property damage without injury | Field, foreman |
| `observation` | Positive or general safety observation | Any |

| Flag | Meaning |
|------|---------|
| `isHighPotential` (HiPo) | High potential severity — escalated notifications |
| `isRecordable` | Nullable until partner HSE sets; `true`/`false` for OSHA-recordable determination |
| `isAnonymous` | Reporter hidden from partner/vendor UI |
| `isStopWork` | Immediate hazard — sets site **Inactive**, escalates notifications; see §6b |

---

## 8. Status workflow (v1)

Simple lifecycle — CAPA sub-states arrive in **v1b**:

```
submitted → under_review → resolved → closed
                ↘ duplicate (link to existing event)
                ↘ denied (not valid / spam — admin/partner HSE only)
```

| Status | Meaning |
|--------|---------|
| `submitted` | Just filed from field or office |
| `under_review` | Partner or vendor HSE acknowledged |
| `resolved` | Resolution notes recorded; awaiting Partner HSE close |
| `closed` | Terminal — **Partner HSE only** (or admin); metrics updated |
| `duplicate` | Linked to canonical event id |
| `denied` | Rejected with reason (audit only) |

**v1 resolution model:** Thread of **resolution notes** (partner and vendor), each with author, role, timestamp, optional attachment. **Close** requires Partner HSE (§6a) and at least one resolution note.

**v1b — CAPA (confirmed next slice):**

Separate `safety_corrective_actions` with assignee, due date, verification photo, overdue notifications, score penalties. Routes through same HSE inboxes; closure of CAPA items required before event close when CAPAs exist.

## 9. User stories

### Field / foreman (iOS)

1. From **Home**, tap “Report safety issue,” pick type, add photo and short description, optionally check **Report anonymously**, submit — auto-attaches nearest site from GPS when on location.
2. From **ticket detail**, tap “Safety report” — same form with ticket, site, vendor, and foreman pre-filled.
3. View **My reports** list with status badges.
4. See **soft banner** when assigned safety video is incomplete; tap to watch — app remains usable.

### Vendor safety / office (web + future iOS)

5. Inbox shows new events for their vendor org; filter by site, status, HiPo.
6. Add **vendor resolution note** (“crew retrained, hazard barricaded”).
7. Mark **under review**; request partner review for recordable injuries.

### Partner HSE (web)

8. Dashboard card: open events, HiPo count, **days without recordable**, **safety score**.
9. Inbox for all events at partner sites (all vendors).
10. Set **recordable** yes/no on injuries; flag **HiPo**; add partner resolution note; **close** event (Partner HSE only).
11. **Partner HSE** reactivates site from Site Locations after stop-work (web + iOS).
12. Trigger **stop-work** from field report → site shows Inactive on Site Locations.

### AskV

13. “Any open safety issues at this site?” → scoped count + deep link to inbox.
14. “What’s our safety score?” → formula-backed number + explanation.
15. “Is this well active?” → site status from stop-work / reactivation.
16. Never reveal anonymous reporter identity to non-admin users.

---

## 10. Safety score & days without recordable

### Days without recordable

Per **partner org** and per **site location** (vendor rollup optional):

```
days = today - date(last closed event where isRecordable = true)
```

If none in retention window, show “No recordable in {N} days” using org go-live or rolling 365-day window.

### Safety score (0–100, v1)

Transparent formula displayed in UI (“How is this calculated?”):

| Component | Points |
|-----------|--------|
| Base | 100 |
| Each **open recordable** in last 90 days | −15 |
| Each **open HiPo** older than 7 days | −5 |
| Each **open event** (any type) older than 30 days without status change | −2 (cap −10) |
| **Near misses reported** in last 30 days | +2 each, cap +10 (rewards reporting culture) |
| Overdue required training (when tracked) | −5 per role cohort overdue % > 10% (soft banner cohort) |

Score clamped to `[0, 100]`. Admin may adjust weights in a later **platform settings** phase; v1 uses constants in code + this doc.

**v1b additions:** −2 per overdue CAPA; CAPA closure bonus.

---

## 11. Data model (proposed)

New tables in `@workspace/db` (names illustrative; implement via Drizzle + OpenAPI):

### `safety_events`

| Column | Notes |
|--------|-------|
| `id` | serial PK |
| `eventNumber` | Human-readable `SAFE-XXXXXXXX` (server-generated) |
| `eventType` | enum (§7) |
| `status` | enum (§8) |
| `title` | Short summary (required) |
| `description` | Free text |
| `siteLocationId` | FK — required when known |
| `partnerId` | Denormalized from site |
| `vendorId` | FK — nullable if partner-only observation |
| `ticketId` | FK — nullable |
| `fieldEmployeeId` | FK — nullable |
| `reportedByUserId` | FK — always stored |
| `isAnonymous` | boolean |
| `isHighPotential` | boolean, default false |
| `isRecordable` | boolean nullable |
| `isStopWork` | boolean, default false — triggers §6b site inactive |
| `siteDeactivatedAt` | nullable timestamp on event when stop-work fired |
| `latitude`, `longitude` | from device at submit |
| `duplicateOfEventId` | nullable FK |
| `closedAt`, `closedByUserId` | nullable |
| `createdAt`, `updatedAt` | timestamps |

### `safety_event_attachments`

Photos (Supabase storage paths), same pattern as ticket/site photos.

### `safety_event_history`

Append-only: status transitions, classification changes, assignment — mirrors ticket status history discipline.

### `safety_resolution_notes`

| Column | Notes |
|--------|-------|
| `eventId` | FK |
| `authorUserId` | FK |
| `authorRole` | snapshot |
| `body` | text |
| `createdAt` | timestamp |

Partner and vendor notes share one table; UI labels by org side.

### `safety_training_modules` + `safety_training_completions` (v1 minimal)

- Module: title, video URL/path, required roles, version, active flag
- Completion: userId, moduleId, completedAt, watchProgressPct

Soft banner when required module incomplete for user’s role.

### Indexes

- `(partnerId, status, createdAt)`
- `(vendorId, status, createdAt)`
- `(siteLocationId, createdAt)`
- `(ticketId)` partial

---

## 12. API surface (v1)

All routes under `/api/safety/*`, session-authenticated, role-scoped. OpenAPI + Orval regeneration required.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/safety/events` | Create event (+ attachments upload flow) |
| `GET` | `/api/safety/events` | Inbox list — filters: status, siteId, vendorId, sinceDays, eventType |
| `GET` | `/api/safety/events/:id` | Detail + notes + history |
| `PATCH` | `/api/safety/events/:id` | Status, HiPo, recordable, duplicate link |
| `POST` | `/api/safety/events/:id/notes` | Add resolution note |
| `POST` | `/api/safety/events/:id/close` | Close — **Partner HSE or admin only** |
| `PATCH` | `/api/site-locations/:id/status` | Set active/inactive — **Partner HSE or admin only** on reactivate |
| `GET` | `/api/safety/metrics` | Score + days without recordable (scoped) |
| `GET` | `/api/safety/training/status` | Current user training completion |
| `POST` | `/api/safety/training/:moduleId/complete` | Mark video complete |

**Rate limiting:** Apply same patterns as ticket create and comments (prevent spam anonymous floods).

**Validation:** Zod at boundary; fail fast with `api-error-codes` entries under new `safety.*` namespace.

---

## 13. Notifications

Extend existing [`notifications`](../../lib/db/src/schema/notifications.ts) pipeline:

| Trigger | Recipients | Type / category |
|---------|------------|-----------------|
| New event submitted | Partner + Vendor **HSE** tagged users | `safety_event_submitted` / `safety` |
| Stop-work / site inactive | Partner HSE + Vendor HSE + site assignees | `safety_stop_work` |
| HiPo flagged | HSE + partner escalation list | `safety_event_hipo` |
| Status → under_review | Reporter (if not anonymous) | `safety_event_update` |
| Event closed | Reporter + participants on notes thread | `safety_event_closed` |

Add preference toggles: `safetyEnabled`, `safetyEmailEnabled` (default **on** for in-app, email off by default like crew/system).

**Dedupe keys:** `safety_event_submitted:{eventId}`, etc.

Reuse **Send to** roster patterns where partner wants to forward an event summary to colleagues (v1b or v1 stretch — not blocking inbox MVP).

---

## 14. UI surfaces

### iOS (`artifacts/vndrly-mobile`)

| Surface | v1 |
|---------|-----|
| **Home** | “Report safety issue” button; safety metrics teaser for office roles; **soft training banner** |
| **Ticket detail** | “Safety report” — opens same flow with context |
| **Report flow** | Type → title/description → photo(s) → anonymous toggle → submit |
| **My reports** | List + detail (status, notes read-only for field) |

No dedicated Safety tab in v1.

### Web (`artifacts/vndrly`)

| Surface | v1 |
|---------|-----|
| **Partner dashboard** | Safety card: open count, HiPo, score, days clean |
| **Vendor dashboard** | Same, vendor-scoped |
| **Safety inbox** | `/safety` or under Reports — filterable table |
| **Event detail** | Timeline, attachments, notes thread, classify, close |
| **Site locations** | Active/Inactive badge; Partner HSE reactivate control (web + iOS) |
| **Admin** | Training module list (upload video, assign roles) — minimal CRUD |

Follow existing industrial UI patterns (pill buttons, status chips, `ImagePill` for severity).

---

## 15. AskV integration (v1 read-only)

Add to `artifacts/api-server/src/assistant/tools.ts` and `data-tools.ts`:

| Tool | Purpose |
|------|---------|
| `query_safety_events` | List/count with filters (role-scoped) |
| `lookup_safety_metrics` | Score + days without recordable for org/site |
| `lookup_site_operational_status` | Active/inactive + last stop-work event link |

Deep link screens (permissions.ts + DEEP_LINK_SCREENS):

- `safety-inbox`
- `safety-event-detail`
- `site-location-detail` (existing — surface inactive state)

System prompt guidance: when user asks about safety, incidents, near misses, recordables, or TRIR-adjacent questions, use tools — never invent counts. Do not disclose anonymous reporter.

**v1b write tool (optional):** `create_safety_observation` from chat — only after inbox proven stable.

---

## 16. Training (soft banner v1)

- Admin uploads safety video module (Supabase storage); assigns to roles: `field_employee`, foreman, vendor office, partner office.
- On login / Home focus, if incomplete: non-blocking banner — “Complete required safety video (≈N min)”
- Completion tracked; feeds small score penalty when cohort overdue (§10).
- **Phase 2 option:** hard gate (block tabs until complete) — explicitly out of v1.

---

## 17. Anonymous reporting — security & legal

- UI copy: explains anonymity applies to partner/vendor visiblity, not law enforcement or admin investigation.
- Store `reportedByUserId` always; encrypt-at-rest is existing Postgres/Supabase responsibility.
- Rate limit per user/IP to prevent harassment via anonymous spam.
- Admin audit view shows reporter; export for legal hold includes identity.
- AskV and API responses for partner/vendor roles **omit** reporter fields when `isAnonymous = true`.

---

## 18. Retention & audit

- Soft-delete prohibited for closed recordables — use status only.
- Retain events and history **minimum 7 years** (OSHA log alignment — configurable constant).
- All classification and close actions write to `safety_event_history` with actor, IP, user-agent (mirror 1099 correction audit pattern in `reports.ts`).

---

## 19. Implementation phases

### Phase 1 — Report → inbox → notes → close → metrics → stop-work

1. Schema + migrations + OpenAPI
2. HSE backfill script (`backfill:hse-roles`) on all environments after deploy
3. API routes + HSE close gate + site inactive/reactivate
4. iOS: Home report + ticket entry + my reports; site inactive badge
5. Web: partner/vendor inbox + detail + dashboard widgets; Site Locations reactivate
6. Notifications (`safety` category)
7. AskV read tools + deep links
8. Soft training banner + minimal admin module upload
9. Ticket/site gate when site inactive

**Exit criteria:** Foreman submits stop-work near miss; site flips Inactive; partner HSE reactivates from Site Locations; vendor adds note; partner HSE closes event; score updates; AskV returns correct open count.

### Phase 1b — CAPA (confirmed)

- `safety_corrective_actions` CRUD
- Assignee, due date, verification photo on close
- Overdue notifications
- Score penalties for overdue CAPAs
- Optional: block event close until all CAPAs verified

### Phase 2 — Analytics & compliance

- Trend charts (by site, vendor, work type)
- HiPo SLA timers
- CSV/PDF export + `report_export_audit_log`
- OSHA 300/301 generation
- Optional hard training gate

---

## 20. Testing requirements

Per project gates:

- **Unit:** score formula, scope filters, anonymous field redaction
- **Integration:** API routes with partner/vendor/field sessions; isolated test DB
- **Mobile:** report flow, anonymous toggle, ticket pre-fill
- **E2E (stretch):** partner closes event from web after mobile submit
- **AskV eval:** add safety tool-use cases to eval suite
- **i18n:** en/es keys for all user-facing strings (`pnpm lint:i18n`)

---

## 21. Success metrics

| Metric | Target (90 days post-launch) |
|--------|------------------------------|
| Reports per active site per month | > 0 (leading indicator — near misses reported) |
| Median time submit → under_review | < 24 hours |
| Partner inbox adoption | > 80% open events closed within 30 days |
| Anonymous report rate | Tracked — not targeted high/low; monitor abuse |
| AskV safety queries answered with tools | > 95% in eval suite |

---

## 22. Existing code to reuse (do not reinvent)

| Concern | Reference |
|---------|-----------|
| Notifications | `artifacts/api-server/src/routes/notifications.ts`, `notifyUsers()` |
| Send-to roster / HSE role | `artifacts/api-server/src/lib/ticket-send-to.ts` (`HSE / Safety Officer`) |
| HSE backfill | `artifacts/api-server/scripts/backfill-hse-roles.ts` |
| Site status fields | `lib/db/src/schema/siteLocations.ts` (`status`, `isActive`) |
| Photo storage | `artifacts/api-server/src/routes/storage.ts`, Supabase paths |
| Site / partner / vendor scoping | Ticket list filters in `tickets.ts`, `mobile-office-ticket-list.ts` |
| Status history | Ticket status history pattern |
| Visitor safety ack | `siteVisits.safetyAcknowledgedAt` — future unify under Safety program admin |
| Cert blocking | `employeeCertifications`, schedule cert blocking — future tie to score |
| AskV tools | `artifacts/api-server/src/assistant/tools.ts`, `data-tools.ts` |
| Mobile Home | `artifacts/vndrly-mobile/app/(tabs)/index.tsx` |
| Ticket detail | `artifacts/vndrly-mobile/app/ticket-detail/` |

---

## 23. Open items (post-PRD)

| Item | Status |
|------|--------|
| Default partner HSE assignee | **Resolved** — `HSE / Safety Officer` pill + `backfill:hse-roles` |
| Stop-work immediate page/SMS | v1: in-app + push; SMS optional later |
| Vendor close authority | **Resolved** — vendor notes only; Partner HSE closes |
| iOS “My reports” location | Home section vs Profile — implementer choice |

---

## 24. Document history

| Date | Change |
|------|--------|
| 2026-06-20 | Initial PRD — v1 scope locked from product review |
| 2026-06-20 | HSE role routing, stop-work/site inactive, Partner HSE close authority, CAPA v1b confirmed; HSE backfill script |
