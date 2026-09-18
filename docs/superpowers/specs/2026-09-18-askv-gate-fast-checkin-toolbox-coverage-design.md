# Ask V Gate Fast Check-In and Toolbox Coverage Design

## Status

Approved in conversation on September 18, 2026.

## Goal

Give Ask V permission-safe tools for every functional workflow changed in the
September 17–18 release batch, with VNDRLY Gate as the priority. A gate
attendant must be able to provide one reliable clue—person, company, plate, or
any combination—and have Ask V resolve authorized history, prefill the visit,
and leave the completed draft ready for the attendant to submit.

Prior history accelerates data entry but never changes authority. Ask V never
silently admits a visitor or submits a Gate check-in. The signed-in gate
attendant reviews or overrides the draft and performs Check In every time.

## Design Principles

1. Reuse the existing audited Gate prepare and confirm path rather than create
   a second check-in system.
2. Separate read-only resolution from mutation so every inferred field has a
   visible, testable source.
3. Ask at most one short clarification when the supplied clues do not identify
   one safe candidate.
4. Scope all history and directory reads to the caller's active organization,
   assigned Gate sites, and existing relationship rules.
5. Keep server-defined permissions, confirmation, idempotency, and audit
   behavior identical for web and iOS Ask V.
6. Enforce page-to-tool coverage in code so future functional page changes
   cannot silently ship without Ask V parity.

## Gate Tool Model

### Read-only history search

Add a Gate-history tool that accepts any combination of:

- current site or Gate context;
- visitor name;
- company;
- normalized plate number;
- plate state when known;
- date or date range;
- active-only or historical scope.

It returns only visits visible to the signed-in Gate user. Supported questions
include:

- when a person or vehicle last came through;
- which authorized company was recorded;
- the most recent or frequent plate used by a returning visitor;
- the person most recently associated with a plate;
- the recorded gate attendant, recorder, or shift context for a visit;
- recent arrivals, departures, and active visitors at the current Gate.

The response is privacy-safe and bounded. It does not expose visits from
unassigned sites or unrelated organizations, and it does not become a global
person or vehicle directory.

### Check-in candidate resolver

Add a read-only resolver that accepts the same partial clues plus the current
Gate context. It ranks authorized prior visits and returns:

- zero, one, or multiple candidates;
- a confidence classification;
- a proposed check-in draft;
- field-level provenance;
- any single material clarification still required.

Example provenance values include:

- explicit in the guard's utterance;
- current Gate or site context;
- exact normalized state-and-plate match;
- unique normalized plate match with historically consistent state;
- exact name-and-company match;
- most recent confirmed visit;
- most frequent confirmed vehicle association.

The resolver never commits a visit.

### Existing prepare and submit path

The resolver's draft feeds the existing `prepare_visitor_check_in` client
intent. The form is visibly populated so the guard can change the driver,
company, plate, state, host, purpose, duration, notes, or other editable field.

The signed-in gate attendant then presses Check In. The existing authenticated,
audited, idempotent Gate endpoint remains the sole mutation path. The current
role, site-assignment, location, host, and validation checks remain
authoritative.

## Resolution Rules

### Name and company

"Jack Smith, Grady Farms checking in" is sufficient when the current Gate
context plus authorized history yields one clear person-company association.
Ask V may suggest the most recent reliable vehicle, plate state, host, purpose,
and duration, with provenance for each field.

### Plate and driver

"ABC 123 coming in, driver Jack Smith" is sufficient when the normalized plate
has one authorized historical state/vehicle association and the supplied driver
does not conflict with a stronger current fact. The explicit driver always
overrides a historical driver suggestion in the draft.

### Plate-state collisions

State plus normalized plate is the canonical vehicle match. A plate without a
state may infer the state only when all authorized exact normalized-plate
history agrees. If the same plate occurs in multiple states, Ask V asks for the
state once and does not guess.

### Fleet and shared vehicles

A fleet vehicle may legitimately have multiple drivers. The vehicle may supply
company, state, host, and purpose suggestions, but a historical driver never
overrides a driver explicitly named by the guard. Multiple plausible drivers
without an explicit driver produce one concise clarification.

### New visitors

New visitors use the same flow. Ask V preserves all supplied facts and asks
only for required values that cannot be derived from the current Gate context
or authorized history. There is no separate returning-visitor mode.

### Ambiguity and conflicts

One clear match produces a completed draft without repetitive questions.
Multiple material matches produce one short disambiguation containing only the
minimum safe distinction, such as company or plate state. Conflicting explicit
facts remain visible for guard correction and are never silently reconciled.

## Gate History and Shift Context

History lookup should return the user who recorded a visit when that audit fact
exists. When the product has an authoritative shift record for that time and
site, the tool may also return the matching shift and on-duty personnel. It must
not infer "who was on shift" from unrelated activity or claim a shift record
exists when only a recorder is known.

The first delivery should reuse existing visit, user, assignment, and Work Hub
shift data. A new durable visitor or fleet registry is deferred; it is not
required for fast check-in because visit history already contains the approved
facts. Any later registry must remain additive and must not rewrite historical
visits.

## September Release Toolbox Coverage

The audit covers functional workflows changed in the September 17–18 batch.
Cosmetic modal normalization and styling-only changes do not create artificial
server tools.

### Calendar and Day Agenda

Ask V must be able to:

- read Calendar ranges and a local-day agenda;
- read one shift, meeting, event, or task;
- resolve authorized people and groups;
- find privacy-safe meeting availability;
- create, update, reschedule, or cancel shifts, meetings, events, and tasks;
- preserve the single-confirmation scheduling flow;
- open or prefill client-only Calendar controls when no server mutation is
  appropriate.

Existing Calendar tools are reused and expanded only where the audited page
action lacks a contract.

### Groups

Ask V must be able to list and read groups, then create, rename, archive, or
delete an authorized group; add or remove members; promote or demote owners;
and preserve the server-enforced minimum of one owner.

The user-facing term is Group even if internal APIs retain crew names.

### Company Chat

Ask V must be able to search authorized conversations, select a group or person
without creating anything, start or reopen the canonical group conversation
only on command, send an authorized person invitation, manage participants,
and send or manage messages within existing collaboration permissions.

Relationship-scoped person search remains limited to the active organization,
approved partner/vendor relationships, and existing authorized shared contacts.

### Employees

Ask V must receive explicit contracts for the employee operations exposed by
the updated pages: create or attach a portal login, resend an onboarding invite,
reset or suspend access, inspect account state, manage authorized subcontractor
worker access, and preview or apply bulk-login imports. Consequential writes
retain exact confirmation and company-admin authorization.

### Gate

Ask V must be able to resolve check-in candidates, prefill a Gate draft, search
history, identify recorded visit and shift context, find active visitors,
prepare checkout, and support the existing guard-controlled check-in and
checkout operations.

## Coverage Manifest

Add a checked-in manifest that maps each audited page workflow to:

- route or surface;
- user-visible action;
- read, client-only, prepare, or mutating tool;
- required role/capability;
- confirmation class;
- web and iOS availability;
- focused contract test.

A test fails when an audited functional action has no tool mapping, when a
mutating tool lacks permission or confirmation metadata, or when web and iOS
resolve different server authority. Styling-only controls are explicitly marked
non-operational rather than omitted silently.

## Security, Privacy, and Reliability

- Gate history is restricted to the caller's assigned sites and organization
  relationships at both search and execution time.
- Search responses are capped and rate-limited to prevent directory scraping.
- Exact clues are normalized but never broadened into an unrelated global
  search.
- Every inferred check-in field includes provenance and confidence.
- Check-in submission revalidates authorization and required fields; a stale
  resolver result cannot bypass changed access.
- Idempotency prevents duplicate visits after retries, reconnects, or repeated
  voice turns.
- Audit records distinguish supplied, inferred, overridden, and submitted
  values without storing raw audio.
- Plate and person data are treated as private operational information and are
  never exposed through public Ask V.

## API and Component Boundaries

The recommended implementation adds:

- a Gate-history query service shared by the API and Ask V runtime;
- a read-only Gate candidate resolver built on that service;
- tool definitions, registry metadata, page-aware Gate tool-pack entries, and
  runtime routing;
- a client intent that applies the resolved draft to the existing Gate form;
- the cross-page toolbox coverage manifest and enforcement tests.

It reuses:

- the current visit tables and authorized visit access rules;
- current site, assignment, user, relationship, and Work Hub shift data;
- `prepare_visitor_check_in` and the authenticated Gate check-in endpoint;
- existing pending-confirmation, idempotency, audit, and realtime tool-pack
  infrastructure.

No destructive migration, database reset, or historical rewrite is permitted.
If an additive index or audit column is required for safe production
performance, it must use the guarded migration path.

## Verification

### Gate contracts

- exact name and company returns one completed draft;
- exact plate and explicit driver returns one completed draft;
- explicit driver overrides a historical fleet driver;
- unique historical plate may safely infer state;
- duplicate plate across states requests one clarification;
- ambiguous same-name visitors request one clarification;
- new visitors retain supplied facts and request only unresolved required data;
- current Gate context supplies authorized site and location facts;
- history answers last visit and recorded attendant accurately;
- shift answers use an authoritative shift record or clearly say only the
  recorder is known;
- unassigned sites and unrelated organizations return no private candidate;
- form overrides win before submission;
- submission remains guard-controlled, authorized, audited, and idempotent;
- repeated or reconnected turns do not create duplicate visits.

### Toolbox coverage

- every audited Calendar, Groups, Company Chat, Employees, and Gate action has
  a manifest entry and focused contract;
- existing tool definitions match the current page action enums and server
  routes;
- company-admin and relationship-scoped actions cannot be widened by Ask V;
- web and iOS use the same server authority and confirmation classification;
- client-only presentation controls cannot be mistaken for server writes.

### Release gates

- focused Ask V, Gate, Work Hub, Employees, web, and mobile tests;
- locale parity;
- web, API, and mobile type checks;
- full mandatory validation suite;
- production web and API builds;
- guarded migration validation when applicable;
- full ship through main, web, API health, production Supabase changes if any,
  iOS OTA, and TestFlight submission.
