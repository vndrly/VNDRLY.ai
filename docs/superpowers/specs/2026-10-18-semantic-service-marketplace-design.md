# Semantic Service Marketplace Design

**Date:** 2026-10-18
**Status:** Approved design
**Scope:** Partner catalog ownership, vendor capability discovery, semantic service matching, coverage eligibility, partner-specific commercial offers, and accepted-offer ticket creation.

## 1. Purpose

VNDRLY must connect services that partners buy with capabilities that vendors provide even when each company uses different terminology. For example, Flywheel may buy “Gatekeeping,” Warwick may buy “Perimeter Security,” and MidCon may advertise “Gate Services.” VNDRLY should recognize these as the same underlying service without rewriting or merging any company’s catalog.

Every qualified vendor may discover matching service demand across every partner catalog on VNDRLY. A vendor that adds a matching capability and partner-specific rate becomes visible to that partner immediately. Partners compare eligible vendors using price, ratings, safety, relevant work history, distance, compliance, and availability, then offer a job to a selected vendor. A ticket is created only when the vendor accepts.

Success means:

- each company retains its own language, requirements, and commercial records;
- equivalent services are discoverable across differently worded catalogs;
- vendors cannot see competitors, competitor pricing, partner budgets, or private notes;
- partners can compare all vendors that have expressed capability and rates for the partner’s service;
- job-site coverage and operational readiness are enforced by the server;
- accepted offers create exactly one correctly scoped ticket;
- AskV and the ChatGPT VNDRLY integration use the same authorization, confirmation, and audit boundaries as the application.

## 2. Current State and Gap

VNDRLY currently stores platform and partner-owned items together in `work_types`. A non-null `partner_id` owns an item, while a null `partner_id` represents a platform item. `vendor_work_types` links a vendor directly to a specific work-type ID and stores pricing. Because partner-owned work types have independent IDs, a vendor currently prices and selects each partner’s exact record separately.

This provides company isolation and partner-specific pricing, but it does not represent shared meaning. “Gatekeeping” and “Perimeter Security” remain unrelated database records unless a person recognizes the connection. Vendor catalog access is also currently tied to approved partner relationships, while the approved marketplace design requires qualified vendors to discover demand across all partner catalogs.

The existing partner catalogs, vendor selections, catalog history, relationships, and ticket references must remain valid. This design adds a semantic and commercial layer rather than replacing historical identifiers.

## 3. Architectural Decision

Use one PostgreSQL database with strict row-level application authorization and a VNDRLY-managed canonical service graph.

The design separates five concepts:

1. **Partner catalog item:** what a particular partner buys, in that partner’s own language.
2. **Canonical service:** VNDRLY’s shared semantic identity for an underlying service.
3. **Vendor capability:** what a vendor can perform, independent of any one partner.
4. **Partner-specific offer/rate:** commercial terms a vendor makes available to one partner.
5. **Job offer:** a proposed piece of work whose acceptance creates a ticket.

AI maps partner catalog items and vendor capabilities to canonical services. Search, authorization, ranking, and ticket creation operate on stored, versioned mappings and deterministic rules. VNDRLY does not run a dedicated autonomous agent that rereads every catalog during every search.

## 4. Proposed Data Model

Names below are conceptual; implementation planning may adjust names while preserving boundaries.

### 4.1 `canonical_services`

- `id`
- stable `code`
- display `name`
- `category`
- definition and inclusion/exclusion guidance
- active/archive state
- audit timestamps

Examples include `gate_perimeter_security`, `hotshot_transport`, and `vacuum_truck_services`.

### 4.2 `canonical_service_aliases`

Stores reviewed vocabulary associated with a canonical service. Aliases improve retrieval but do not replace semantic classification.

- canonical service ID
- alias text
- optional industry/region context
- provenance: platform, partner usage, vendor usage, or reviewed AI suggestion
- active state

### 4.3 `service_mappings`

Maps either a partner work type or vendor capability to one canonical service.

- subject type and subject ID
- canonical service ID
- mapping state: active, review-required, rejected, or superseded
- confidence score
- explanation and evidence summary
- classifier/model version
- mapping version
- actor or automated-process identity
- creation, review, and supersession timestamps

Only one current active mapping may exist for a subject. Mapping history is immutable. High-confidence, non-conflicting matches activate automatically. Low-confidence results, conflicts, and proposed new canonical services enter VNDRLY-admin review.

Thresholds are configuration, not hard-coded policy. Offline evaluation establishes initial thresholds before production activation.

### 4.4 `vendor_capabilities`

Represents what a vendor performs, separate from partner demand.

- vendor ID
- vendor’s display name and description
- canonical service mapping
- default unit and default rate card
- declared capacity, such as available crews
- capability-specific qualifications and supporting evidence
- active state
- audit timestamps

A vendor capability may match many partner catalog items through the shared canonical service.

### 4.5 `vendor_service_areas`

Stores enforceable geographic coverage for a capability.

- vendor capability ID
- verified service-base address and coordinates
- radius in miles
- provenance of coordinates
- active/effective timestamps

Each vendor has a company-wide default service base and radius. While adding a capability, the vendor sees and may override the radius for that service. The first implementation uses great-circle distance between the saved service-base coordinates and the partner’s saved job-site coordinates. The model permits multiple service bases or polygon coverage in a later phase without changing partner catalog ownership.

### 4.6 `vendor_partner_service_offers`

Stores the terms by which one vendor offers one capability to one partner catalog item.

- vendor capability ID
- partner ID and partner work-type ID
- unit price, unit, currency, overtime or other supported rate components
- vendor notes and commercial conditions
- availability/capacity declaration
- active/effective timestamps
- audit identity

These rows replace neither the partner catalog item nor the vendor capability. They connect supply, demand, and partner-specific terms. Competitors cannot read one another’s rows.

### 4.7 `job_offers`

- partner, vendor, site, partner work type, canonical service, and vendor capability IDs
- immutable commercial snapshot
- requested schedule, crew count, scope, attachments, AFE/PO references, and expiration
- state: draft, offered, vendor_reviewing, accepted, declined, expired, or withdrawn
- offer-version and idempotency key
- sent, accepted, declined, expired, and withdrawn audit fields
- created ticket ID after successful acceptance

Acceptance writes an immutable agreement snapshot before creating the ticket. Future changes to rates, service coverage, or mappings do not alter an accepted ticket.

## 5. AI Matching Pipeline

The matching pipeline is asynchronous at import/edit time, not improvised during each user search.

1. Normalize the submitted catalog item or capability without altering its stored display text.
2. Retrieve a small candidate set using reviewed aliases, lexical search, and semantic embeddings.
3. Ask the classifier to choose among candidates or declare that no suitable concept exists.
4. Store the selected concept, calibrated confidence, concise explanation, evidence, and model version.
5. Activate a high-confidence non-conflicting mapping automatically.
6. Route uncertain, conflicting, or novel classifications to admin review.
7. Reindex marketplace search from active mappings.

Automatic activation is reversible and audited. A mapping change affects future discovery and offers but never rewrites historical tickets or accepted commercial snapshots.

Search uses stored mappings. AskV can explain a match—for example, that both descriptions include controlled entry, visitor logging, and vehicle verification—but cannot create an unrecorded commercial match merely by asserting one in conversation.

## 6. Vendor Experience

### 6.1 Add a capability

The vendor describes the service using its own wording. VNDRLY shows the canonical match and explanation. If the automatic match is high confidence, it is active immediately; otherwise the capability is saved pending review and clearly labeled.

### 6.2 Configure coverage and capacity

The add-service flow includes:

- verified service base;
- company default coverage radius;
- capability-specific radius override;
- available crews or other appropriate capacity;
- service qualifications;
- default rates.

The vendor sees how many partner catalog entries match the service. The vendor may review the partner name, that partner’s public catalog wording, service requirements, coverage locations, and approximate demand or opportunity count.

### 6.3 Join matching partner catalogs

For each matched partner catalog item, the vendor may adopt its default rates or specify partner-specific terms. Saving an active rate makes the vendor immediately discoverable to that partner. It does not reveal competing vendors, competitor rates, internal partner budgets, private notes, or private partner performance assessments.

## 7. Partner Experience

From a partner catalog item, the partner selects a site, schedule, scope, and anticipated crew/capacity needs. VNDRLY displays matching vendors and explains eligibility.

Partner comparison includes, when available:

- partner-specific rate and unit;
- completed-ticket rating and review count;
- safety score, source, and refresh date;
- relevant completed-job count and on-time performance;
- distance from the vendor’s applicable service base;
- coverage radius;
- compliance and required credential status;
- declared capacity and availability;
- prior relationship or work history with that partner.

Missing evidence displays as “Not yet rated” or an equivalent label and is never silently converted into a zero score.

Eligible vendors appear first. Partners can change sort and filter priorities. VNDRLY explains why a vendor ranks where it does and does not silently select a winner.

An otherwise matching vendor outside the selected site’s coverage remains visible but is marked **Out of Service Area**. Its offer action is disabled. This both explains the exclusion and lets the partner know the capability exists for other locations.

## 8. Eligibility and Ranking

Eligibility is deterministic and precedes ranking. The server checks:

- active canonical-service match;
- active vendor capability and partner-specific offer;
- distance within the capability’s coverage radius;
- required vendor and worker credentials;
- current compliance documents and relationship requirements;
- sufficient declared capacity and availability;
- active company/user state and tenant authorization.

Ranking operates only after eligibility and may consider safety, rating, relevant work history, on-time performance, distance, price, availability, and the partner’s prior experience. Ranking factors and explanations are returned separately so the UI can display them transparently.

No ranking factor grants authorization. A high score cannot override an eligibility failure.

## 9. Job Offer and Ticket Creation

The partner builds an offer containing scope, site, requested dates, crew count, agreed rate basis, commercial references, attachments, and expiration. Sending an offer does not create a ticket.

The vendor may accept or decline. The partner may withdraw before acceptance. The system expires an unanswered offer at its deadline.

Acceptance runs in one database transaction protected by the offer version and idempotency key:

1. Lock the current offer and reject duplicate, stale, withdrawn, declined, expired, or already accepted requests.
2. Recheck canonical match, site distance, compliance, credentials, capacity, company state, and authorization.
3. Freeze the agreed commercial, scope, coverage, and eligibility snapshot.
4. Create exactly one ticket using the original partner work-type ID so downstream workflows and reporting retain the partner’s catalog identity.
5. Link the ticket to the canonical service, vendor capability, partner-specific offer, and accepted job offer.
6. Mark the job offer accepted and emit notifications/audit events after commit.

If eligibility changed after the offer was sent, acceptance fails with a precise reason and does not create a partial ticket. Changing future rates or coverage does not mutate an accepted ticket.

## 10. AskV and ChatGPT Behavior

AskV and the VNDRLY ChatGPT integration call the same marketplace services used by the web and mobile clients.

Read operations may:

- search semantically across services;
- explain catalog mappings;
- show partner demand to an authorized vendor under the approved visibility policy;
- compare eligible vendors for an authorized partner;
- explain ineligibility, including Out of Service Area.

Write operations may guide capability creation, service-area configuration, partner-specific rate setup, offer creation, offer sending, and acceptance. Every consequential write uses role-scoped authorization, confirmation bound to the exact proposed action, an idempotency key, and canonical result readback. Model-generated coordinates, confidence, compliance status, and confirmation text are untrusted inputs; authoritative values come from saved VNDRLY records and server calculations.

## 11. Privacy and Authorization

Qualified vendors may discover all partner catalog demand, but only the approved marketplace projection:

- partner identity;
- public catalog wording and requirements;
- coverage locations at the approved level of precision;
- approximate demand/opportunity counts;
- the requesting vendor’s own rates and eligibility.

Vendor responses exclude competitor identity, competitor rates, ranking position against named competitors, partner budgets, private notes, and internal partner assessments.

Partners can view vendors, terms offered to that partner, evidence-based ratings and safety data, eligibility, and relevant performance. Company-scoped notes and unrelated partner terms remain private.

Every endpoint fails closed when company scope is missing or ambiguous. Marketplace discoverability does not itself create an approved operating relationship, authorize site details beyond the marketplace projection, or permit ticket work before an offer is accepted.

## 12. Failure Handling

- Missing or invalid vendor/service-base coordinates block activation of geographic coverage.
- Missing site coordinates block a site-specific offer and provide a remediation path.
- Boundary calculations use consistent units and an explicitly documented inclusive rule at the configured radius.
- Low-confidence or conflicting semantic mappings remain discoverable only as pending vendor/admin work, not as active commercial matches.
- Stale compliance, insufficient capacity, or changed coverage blocks acceptance with the exact failing condition.
- Classifier outages do not break existing mappings or marketplace search; new/edited subjects enter a retryable pending state.
- Search-index lag never grants eligibility because acceptance reads authoritative database records.
- Repeated acceptance, network retries, and concurrent requests return the already-created result rather than creating duplicate tickets.

## 13. Migration and Rollout

All database work is additive and guarded. No existing work type, vendor selection, partner relationship, ticket, or catalog history is deleted or renumbered.

Recommended sequence:

1. Add canonical services, aliases, mapping history, and classifier evaluation tooling.
2. Seed canonical concepts from existing distinct catalog content and review them internally.
3. Classify existing partner-owned work types and vendor selections without changing current application behavior.
4. Measure precision, conflict rate, coverage of existing catalogs, and per-category confidence calibration.
5. Add vendor capabilities, service bases, radii, capacity, and partner-specific offer records.
6. Project existing `vendor_work_types` pricing into the new structures with explicit lineage and reconciliation reports; preserve original rows during transition.
7. Launch vendor demand discovery and capability/rate management behind a feature flag.
8. Launch partner comparison and coverage eligibility in read-only mode, then enable job offers.
9. Enable transactional offer acceptance and ticket creation after concurrency and idempotency verification.
10. Add matching AskV and ChatGPT tools after the underlying APIs are stable, preserving the same permission and confirmation contracts.

Migration scripts must be rerunnable, transactionally guarded, additive, and verified with before/after counts and lineage checks. They must never use destructive schema or data operations against live data.

## 14. Verification Requirements

### Data and authorization

- partner catalog ownership and historical work-type references remain unchanged;
- vendor marketplace projection excludes competitor and private partner information;
- partner-specific rates cannot cross partner boundaries;
- missing or ambiguous tenant scope fails closed;
- archived/deactivated records cannot become eligible.

### Semantic matching

- a representative labeled evaluation set measures precision by category;
- gatekeeping/perimeter-security synonyms match correctly;
- similarly worded but operationally different services do not collapse together;
- low-confidence, conflict, rejection, remapping, and rollback behavior is tested;
- stored mappings make search stable across classifier outages and model upgrades.

### Geographic coverage

- inside, exactly-on-boundary, and outside-radius cases;
- miles/kilometers conversion and coordinate-order regressions;
- missing, stale, and corrected coordinates;
- company defaults and capability overrides;
- UI status and server decision remain consistent;
- direct API attempts cannot bypass Out of Service Area.

### Offers and tickets

- eligibility recheck at send and acceptance;
- expired, withdrawn, declined, stale-version, and changed-terms offers;
- duplicate clicks, retries, and simultaneous acceptance requests;
- exactly one ticket and one immutable acceptance snapshot;
- existing ticket status/lifecycle invariants remain valid;
- future rate/coverage changes do not alter accepted tickets.

### Experience and integrations

- vendor capability/rate flows on web and mobile;
- partner comparison, explanations, filters, and disabled offer states;
- AskV read permissions and action-bound confirmations;
- ChatGPT permission-scoped reads, synthetic harmless writes, and canonical result readback;
- accessibility, localization parity, audit logging, and notification behavior.

## 15. Explicit Non-Goals for the First Release

- separate physical databases for each partner;
- a continuously autonomous catalog agent;
- exposing competitor rates or reverse-auction behavior;
- AI selecting or awarding a vendor without the partner’s explicit action;
- rewriting historical ticket work-type IDs;
- road-routing travel time, arbitrary geographic polygons, or unlimited multi-base optimization;
- public anonymous catalog access.

These boundaries keep the first release explainable and safe while leaving clear extension points for multiple service depots, richer territories, bidding, and capacity scheduling.
