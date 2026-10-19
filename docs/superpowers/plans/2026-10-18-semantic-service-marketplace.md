# Semantic Service Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-sided VNDRLY service marketplace that semantically connects partner-owned catalog items to vendor capabilities, enforces vendor service areas, supports transparent vendor comparison, and creates exactly one ticket when a vendor accepts a partner job offer.

**Architecture:** Preserve `work_types` as the partner catalog and historical ticket source of truth, then add canonical services, versioned mappings, vendor capabilities, geographic service areas, partner-specific commercial offers, and job offers. AI classification runs when catalog content changes and stores an auditable mapping; runtime discovery and eligibility use authoritative database records and deterministic checks. Job-offer acceptance revalidates eligibility and creates one ticket transactionally.

**Tech Stack:** Node.js 24, TypeScript 5.9, PostgreSQL/Supabase, Drizzle ORM, Express 5, Zod, React 19, Vite, TanStack Query, React Native/Expo, Vitest, Playwright, existing Anthropic AskV integration, Orval/OpenAPI.

**Spec:** `docs/superpowers/specs/2026-10-18-semantic-service-marketplace-design.md`

## Global Constraints

- Use one PostgreSQL database with company-scoped authorization; do not create per-partner databases.
- Preserve every existing `work_types`, `vendor_work_types`, ticket, relationship, and catalog-history identifier.
- Database changes are additive and guarded: no `DROP`, `TRUNCATE`, destructive restore, or delete-and-reseed behavior.
- Qualified vendors may discover every partner catalog through the approved marketplace projection, but never competitors, competitor rates, partner budgets, private notes, or private assessments.
- High-confidence non-conflicting mappings activate automatically; low-confidence, conflicting, and novel-service results require VNDRLY-admin review.
- Coverage uses authoritative saved coordinates and a capability-specific radius override over the vendor default; server eligibility is authoritative.
- Missing evidence is labeled unknown/not-yet-rated and is never silently converted to a zero.
- Sending a job offer never creates a ticket; vendor acceptance creates exactly one ticket after transactional revalidation.
- AskV and ChatGPT writes require role-scoped authorization, action-bound confirmation, idempotency, and canonical result readback.
- Do not add an external AI/vector dependency in the first implementation. Use an interface around the existing model provider plus PostgreSQL lexical/alias candidate retrieval; a later embedding provider can implement the same interface.
- Keep all marketplace release surfaces behind `SEMANTIC_SERVICE_MARKETPLACE_ENABLED` until migration verification and evaluation gates pass.

## Review Focus

- Invalid, missing, reversed, or zero coordinates must fail closed with a remediation message; Task 4 tests each case.
- A service exactly on the radius boundary must be eligible under a documented inclusive `distanceMiles <= radiusMiles` rule; Task 4 pins the boundary.
- Mapping reruns, model-version changes, and concurrent classification must leave one active mapping and immutable history; Task 2 tests these races.
- Offers whose compliance, coverage, capacity, rate version, or authorization changes after send must fail acceptance without a partial ticket; Task 8 tests each stale condition.
- Duplicate clicks, network retries, and simultaneous acceptances must return the same ticket ID and create one ticket/snapshot; Task 8 tests transaction and idempotency behavior.

---

## File Structure

New database files own one table family each; marketplace domain modules own classification, distance, eligibility, ranking, and acceptance independently. API routes remain thin and delegate to these modules. Existing catalog pages receive focused child components rather than accumulating marketplace logic directly.

- `lib/db/src/schema/canonicalServices.ts` — canonical concepts and aliases.
- `lib/db/src/schema/serviceMappings.ts` — immutable mapping history and one-current-mapping constraint.
- `lib/db/src/schema/vendorCapabilities.ts` — capability, service-area, and partner-offer records.
- `lib/db/src/schema/jobOffers.ts` — offer lifecycle and accepted commercial snapshot.
- `artifacts/api-server/src/services/service-matching/` — candidate retrieval, classifier interface, activation policy, and review workflow.
- `artifacts/api-server/src/services/marketplace/` — geographic eligibility, projection, ranking, and offer acceptance.
- `artifacts/api-server/src/routes/serviceMarketplace.ts` — marketplace HTTP contract.
- `artifacts/vndrly/src/components/service-marketplace/` — web vendor setup, comparison, offer composer, and status components.
- `artifacts/vndrly-mobile/components/service-marketplace/` — mobile counterparts using the generated API client.

### Task 1: Add the Additive Marketplace Schema and Guarded Migration

**Files:**
- Create: `lib/db/src/schema/canonicalServices.ts`
- Create: `lib/db/src/schema/serviceMappings.ts`
- Create: `lib/db/src/schema/vendorCapabilities.ts`
- Create: `lib/db/src/schema/jobOffers.ts`
- Modify: `lib/db/src/schema/tickets.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/scripts/migrate-semantic-service-marketplace.ts`
- Modify: `artifacts/api-server/package.json`
- Modify: `.github/workflows/deploy-api.yml`
- Test: `artifacts/api-server/src/lib/semantic-service-marketplace-schema.test.ts`

**Interfaces:**
- Consumes: existing partner, vendor, work-type, site-location, user, and ticket foreign keys.
- Produces: `canonicalServicesTable`, `canonicalServiceAliasesTable`, `serviceMappingsTable`, `vendorCapabilitiesTable`, `vendorServiceAreasTable`, `vendorPartnerServiceOffersTable`, `jobOffersTable`, and `jobOfferAcceptanceSnapshotsTable`; nullable ticket lineage fields `canonicalServiceId`, `vendorCapabilityId`, and `jobOfferId`.

- [ ] **Step 1: Write the failing schema contract test**

Assert exact table exports, enum/value constants, foreign-key ownership, uniqueness for active mapping and `(vendorCapabilityId, partnerId, workTypeId)`, positive-radius/capacity checks, job-offer idempotency uniqueness, nullable ticket lineage, and absence of destructive SQL tokens in the migration.

- [ ] **Step 2: Run the schema contract test and verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/semantic-service-marketplace-schema.test.ts`

Expected: FAIL because the schema exports do not exist.

- [ ] **Step 3: Implement the Drizzle schemas and exports**

Use text status constants consistent with the repository. Store service-base coordinates as double precision, radius as positive numeric miles, confidence as numeric `0..1`, mapping evidence/explanation as JSONB/text, and offer commercial snapshots as JSONB. Add partial uniqueness so one subject has one current active mapping while preserving superseded history.

- [ ] **Step 4: Add the guarded additive migration**

Implement `migrate-semantic-service-marketplace.ts` with `APPLY_SEMANTIC_SERVICE_MARKETPLACE=1`, an advisory lock, transaction, `CREATE TABLE IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`, postcondition verification, and rollback on mismatch. Register `migrate:semantic-service-marketplace` and invoke it in API deployment with the guard.

- [ ] **Step 5: Run schema verification**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/semantic-service-marketplace-schema.test.ts && pnpm --filter @workspace/db run check-schema`

Expected: PASS against the isolated test database; do not point the schema check or migration at shared development or production data during implementation.

- [ ] **Step 6: Commit the schema slice**

```bash
git add lib/db/src/schema artifacts/api-server/scripts/migrate-semantic-service-marketplace.ts artifacts/api-server/package.json .github/workflows/deploy-api.yml artifacts/api-server/src/lib/semantic-service-marketplace-schema.test.ts
git commit -m "feat: add semantic marketplace schema"
```

### Task 2: Implement Versioned Canonical-Service Matching

**Files:**
- Create: `artifacts/api-server/src/services/service-matching/types.ts`
- Create: `artifacts/api-server/src/services/service-matching/candidates.ts`
- Create: `artifacts/api-server/src/services/service-matching/classifier.ts`
- Create: `artifacts/api-server/src/services/service-matching/activation.ts`
- Create: `artifacts/api-server/src/services/service-matching/index.ts`
- Test: `artifacts/api-server/src/services/service-matching/service-matching.test.ts`

**Interfaces:**
- Consumes: canonical-service/alias tables and the repository’s existing model-provider configuration.
- Produces: `classifyServiceSubject(input: ServiceSubjectInput): Promise<ServiceClassification>` and `recordClassification(input: RecordedClassificationInput): Promise<CurrentServiceMapping>`.

- [ ] **Step 1: Write failing matching-policy tests**

Cover `Gatekeeping` and `Perimeter Security` selecting `gate_perimeter_security`; operationally different near-name rejection; high-confidence activation; low-confidence review; conflict review; no-candidate novel-service review; model-version rerun; concurrent rerun; rejected and superseded mappings; and classifier outage returning retryable pending without disturbing the current mapping.

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/service-matching/service-matching.test.ts`

Expected: FAIL because the service-matching modules do not exist.

- [ ] **Step 3: Implement candidate retrieval and the classifier boundary**

Define `ServiceCandidateProvider.findCandidates(input, limit): Promise<ServiceCandidate[]>` using normalized aliases and PostgreSQL lexical matching. Define `ServiceClassifier.classify(input, candidates): Promise<ServiceClassification>` so the existing model provider is replaceable and tests use a deterministic fake.

- [ ] **Step 4: Implement activation and immutable history**

Activate only when confidence meets configured threshold, the classifier chose an existing concept, and no current/manual conflict exists. Use a transaction and subject lock; supersede the old current row instead of updating its evidence/model fields.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/service-matching/service-matching.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the matching engine**

```bash
git add artifacts/api-server/src/services/service-matching
git commit -m "feat: classify catalog services canonically"
```

### Task 3: Add Admin Canonical-Service and Mapping Review APIs

**Files:**
- Create: `artifacts/api-server/src/routes/serviceMarketplaceAdmin.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Test: `artifacts/api-server/src/routes/service-marketplace-admin.test.ts`
- Create: `artifacts/vndrly/src/pages/admin-service-mappings.tsx`
- Modify: `artifacts/vndrly/src/App.tsx`
- Modify: `artifacts/vndrly/src/lib/locales/en.json`
- Modify: `artifacts/vndrly/src/lib/locales/es.json`
- Test: `artifacts/vndrly/src/pages/admin-service-mappings.test.tsx`

**Interfaces:**
- Consumes: `classifyServiceSubject` and `recordClassification` from Task 2.
- Produces: admin-only canonical-service CRUD/archive, alias management, pending-review list, approve/reject/remap, and subject reclassification endpoints.

- [ ] **Step 1: Write failing authorization and review tests**

Assert non-admin denial; archived services cannot receive new active mappings; approve/reject/remap retains history; reclassification is idempotent; an admin cannot delete a referenced concept; and every response contains current mapping status, confidence, evidence summary, and model version.

- [ ] **Step 2: Run the route test and verify failure**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/service-marketplace-admin.test.ts`

Expected: FAIL with missing router/endpoints.

- [ ] **Step 3: Implement thin admin routes and OpenAPI operations**

Use existing `requireAdmin`, API error helpers, Zod validation, pagination, and audit identity patterns. Archive instead of delete when a service has references.

- [ ] **Step 4: Implement the admin review queue**

Add an admin-only route and page listing pending/conflicting mappings with subject text, proposed concept, confidence, evidence, and model version. Provide approve, reject, remap, alias-add, and reclassify actions; require a confirmation dialog for remap/archive actions and refresh canonical readback after every write.

- [ ] **Step 5: Regenerate and validate the API contract**

Run: `pnpm generate && pnpm lint:i18n && pnpm --filter @workspace/api-server exec vitest run src/routes/service-marketplace-admin.test.ts && pnpm --filter @workspace/vndrly exec vitest run src/pages/admin-service-mappings.test.tsx`

Expected: generated clients are current and tests PASS.

- [ ] **Step 6: Commit the admin review workflow**

```bash
git add artifacts/api-server/src/routes/serviceMarketplaceAdmin.ts artifacts/api-server/src/routes/service-marketplace-admin.test.ts artifacts/api-server/src/index.ts artifacts/vndrly/src/pages/admin-service-mappings.tsx artifacts/vndrly/src/pages/admin-service-mappings.test.tsx artifacts/vndrly/src/App.tsx artifacts/vndrly/src/lib/locales lib/api-spec lib/api-client-react lib/api-zod
git commit -m "feat: add service mapping review api"
```

### Task 4: Implement Vendor Capabilities, Service Areas, and Geographic Eligibility

**Files:**
- Create: `artifacts/api-server/src/services/marketplace/distance.ts`
- Create: `artifacts/api-server/src/services/marketplace/eligibility.ts`
- Create: `artifacts/api-server/src/routes/serviceMarketplace.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Test: `artifacts/api-server/src/services/marketplace/eligibility.test.ts`
- Test: `artifacts/api-server/src/routes/service-marketplace-vendor.test.ts`

**Interfaces:**
- Consumes: vendor capability/area/offer tables and current active service mappings.
- Produces: `distanceMiles(a: Coordinates, b: Coordinates): number`, `evaluateMarketplaceEligibility(input: EligibilityInput): Promise<EligibilityResult>`, plus vendor capability, coverage, matching-demand, and partner-rate endpoints.

- [ ] **Step 1: Write failing pure distance and eligibility tests**

Test known coordinate distance, identical points, exactly 500 miles eligible, `500.001` miles ineligible, reversed latitude/longitude, latitude outside `[-90,90]`, longitude outside `[-180,180]`, zero/missing coordinates, vendor default radius, capability override, inactive capability, missing offer, stale compliance, missing credential, insufficient capacity, and the exact `OUT_OF_SERVICE_AREA` result including measured distance and limit.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/marketplace/eligibility.test.ts src/routes/service-marketplace-vendor.test.ts`

Expected: FAIL because distance, eligibility, and routes do not exist.

- [ ] **Step 3: Implement distance and eligibility as side-effect-free boundaries**

Use a documented Haversine implementation returning miles. Validate coordinate order before calculation and apply inclusive `distanceMiles <= radiusMiles`. Return reason codes and display-safe facts separately from internal evidence.

- [ ] **Step 4: Implement vendor APIs and approved demand projection**

Permit active vendor admins to manage their own capabilities, service area, capacity, and rates; permit system admins to support a selected vendor. Matching-demand responses include partner identity, public catalog wording/requirements, approved location precision, approximate demand, and the caller vendor’s own offer/eligibility only. Do not require a preexisting partner-vendor relationship for discovery.

- [ ] **Step 5: Regenerate the client and rerun tests**

Run: `pnpm generate && pnpm --filter @workspace/api-server exec vitest run src/services/marketplace/eligibility.test.ts src/routes/service-marketplace-vendor.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the vendor marketplace API**

```bash
git add artifacts/api-server/src/services/marketplace artifacts/api-server/src/routes/serviceMarketplace.ts artifacts/api-server/src/routes/service-marketplace-vendor.test.ts artifacts/api-server/src/index.ts lib/api-spec lib/api-client-react lib/api-zod
git commit -m "feat: add vendor marketplace capabilities"
```

### Task 5: Redesign the Vendor Catalog Experience

**Files:**
- Create: `artifacts/vndrly/src/components/service-marketplace/VendorCapabilityEditor.tsx`
- Create: `artifacts/vndrly/src/components/service-marketplace/ServiceAreaEditor.tsx`
- Create: `artifacts/vndrly/src/components/service-marketplace/MatchingPartnerDemand.tsx`
- Modify: `artifacts/vndrly/src/pages/vendor-catalog.tsx`
- Modify: `artifacts/vndrly/src/lib/locales/en.json`
- Modify: `artifacts/vndrly/src/lib/locales/es.json`
- Test: `artifacts/vndrly/src/pages/vendor-catalog.marketplace.test.tsx`

**Interfaces:**
- Consumes: generated vendor capability, matching demand, service-area, and partner-offer hooks from Task 4.
- Produces: vendor add/edit capability flow with AI match explanation, company default and service override coverage, capacity, matching partners, and partner-specific rates.

- [ ] **Step 1: Write failing vendor-flow component tests**

Cover adding “Gate Services,” showing the canonical explanation, entering a 500-mile radius, inheriting and overriding company defaults, invalid coordinate/radius messages, viewing Flywheel and Warwick demand, setting separate rates, preserving unsaved drafts, pending-review display, and competitor-data absence.

- [ ] **Step 2: Run the component test and verify failure**

Run: `pnpm --filter @workspace/vndrly exec vitest run src/pages/vendor-catalog.marketplace.test.tsx`

Expected: FAIL because the new components are absent.

- [ ] **Step 3: Implement focused components and integrate the existing page**

Keep current AFE and catalog behavior accessible during the feature-flag transition. Use existing VNDRLY cards, pills, branding, error translation, toast, and query invalidation patterns. Put service coverage in the add/edit capability step and show matching partner count before save.

- [ ] **Step 4: Add English and Spanish copy and validate locales**

Run: `pnpm lint:i18n && pnpm --filter @workspace/vndrly exec vitest run src/pages/vendor-catalog.marketplace.test.tsx`

Expected: locale parity and component tests PASS.

- [ ] **Step 5: Commit the vendor experience**

```bash
git add artifacts/vndrly/src/components/service-marketplace artifacts/vndrly/src/pages/vendor-catalog.tsx artifacts/vndrly/src/pages/vendor-catalog.marketplace.test.tsx artifacts/vndrly/src/lib/locales
git commit -m "feat: redesign vendor service catalog"
```

### Task 6: Implement Partner Vendor Discovery and Transparent Ranking

**Files:**
- Create: `artifacts/api-server/src/services/marketplace/ranking.ts`
- Modify: `artifacts/api-server/src/routes/serviceMarketplace.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Test: `artifacts/api-server/src/services/marketplace/ranking.test.ts`
- Test: `artifacts/api-server/src/routes/service-marketplace-partner.test.ts`

**Interfaces:**
- Consumes: `evaluateMarketplaceEligibility` from Task 4, completed-ticket ratings/history, safety/compliance sources, offers, sites, and current mappings.
- Produces: `rankMarketplaceVendors(input: RankInput): RankedVendor[]` and partner-scoped catalog-item vendor-search/detail endpoints.

- [ ] **Step 1: Write failing projection and ranking tests**

Assert eligibility precedes ranking; missing rating/safety is `null` with `not_yet_rated`; distance/radius facts are returned; out-of-area vendors remain visible but not offerable; partner-adjustable sort works; ties are deterministic; explanations name factors; and responses exclude other partners’ terms, competitor-private data, internal notes, and hidden budgets.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/marketplace/ranking.test.ts src/routes/service-marketplace-partner.test.ts`

Expected: FAIL because ranking and partner endpoints are absent.

- [ ] **Step 3: Implement transparent ranking**

Represent ranking as named normalized factors rather than one opaque AI score. Default ordering is eligible first, then configured factor weights, then stable vendor ID. Keep eligibility reason codes independent of ranking.

- [ ] **Step 4: Implement partner-scoped search endpoints**

Require the active partner to own the requested work type and selected site. Return approved comparison facts and explanations only. Reuse server-side site, compliance, rating, and safety sources rather than trusting client values.

- [ ] **Step 5: Regenerate the client and rerun tests**

Run: `pnpm generate && pnpm --filter @workspace/api-server exec vitest run src/services/marketplace/ranking.test.ts src/routes/service-marketplace-partner.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit discovery and ranking**

```bash
git add artifacts/api-server/src/services/marketplace/ranking.ts artifacts/api-server/src/routes/serviceMarketplace.ts artifacts/api-server/src/services/marketplace/ranking.test.ts artifacts/api-server/src/routes/service-marketplace-partner.test.ts lib/api-spec lib/api-client-react lib/api-zod
git commit -m "feat: rank marketplace vendors transparently"
```

### Task 7: Redesign the Partner Catalog and Vendor Comparison Experience

**Files:**
- Create: `artifacts/vndrly/src/components/service-marketplace/PartnerVendorResults.tsx`
- Create: `artifacts/vndrly/src/components/service-marketplace/VendorComparisonCard.tsx`
- Create: `artifacts/vndrly/src/components/service-marketplace/JobOfferComposer.tsx`
- Modify: `artifacts/vndrly/src/pages/partner-catalog.tsx`
- Modify: `artifacts/vndrly/src/lib/locales/en.json`
- Modify: `artifacts/vndrly/src/lib/locales/es.json`
- Test: `artifacts/vndrly/src/pages/partner-catalog.marketplace.test.tsx`

**Interfaces:**
- Consumes: generated partner search/detail hooks from Task 6; offer composer initially produces `CreateJobOfferInput` for Task 8.
- Produces: site/date/capacity-scoped vendor discovery, explainable cards, compare/sort/filter controls, Out of Service Area treatment, and job-offer draft UI.

- [ ] **Step 1: Write failing partner-flow tests**

Cover selecting Gatekeeping and a site; eligible MidCon card; displayed price, rating, safety freshness, distance, history, compliance, and capacity; explicit unknown labels; sorting; comparison; out-of-area visibility and disabled offer; missing-site-coordinates remediation; and no hidden internal evidence in rendered data.

- [ ] **Step 2: Run the component test and verify failure**

Run: `pnpm --filter @workspace/vndrly exec vitest run src/pages/partner-catalog.marketplace.test.tsx`

Expected: FAIL because marketplace components are absent.

- [ ] **Step 3: Implement the partner marketplace components**

Keep partner catalog editing intact. Place vendor discovery inside each catalog item, require site selection before eligibility, display reasoned ranking facts, and make the offer composer capture scope, dates, crew count, rate basis, AFE/PO, attachments, and expiration.

- [ ] **Step 4: Add locale copy and validate**

Run: `pnpm lint:i18n && pnpm --filter @workspace/vndrly exec vitest run src/pages/partner-catalog.marketplace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the partner experience**

```bash
git add artifacts/vndrly/src/components/service-marketplace artifacts/vndrly/src/pages/partner-catalog.tsx artifacts/vndrly/src/pages/partner-catalog.marketplace.test.tsx artifacts/vndrly/src/lib/locales
git commit -m "feat: add partner vendor marketplace"
```

### Task 8: Implement Job Offers and Transactional Ticket Creation

**Files:**
- Create: `artifacts/api-server/src/services/marketplace/job-offers.ts`
- Modify: `artifacts/api-server/src/routes/serviceMarketplace.ts`
- Modify: `artifacts/api-server/src/routes/tickets.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Test: `artifacts/api-server/src/services/marketplace/job-offers.database.test.ts`
- Test: `artifacts/api-server/src/routes/service-marketplace-offers.test.ts`
- Modify: `artifacts/vndrly/src/components/service-marketplace/JobOfferComposer.tsx`
- Create: `artifacts/vndrly/src/components/service-marketplace/VendorJobOfferInbox.tsx`
- Test: `artifacts/vndrly/src/components/service-marketplace/job-offer-flow.test.tsx`

**Interfaces:**
- Consumes: `evaluateMarketplaceEligibility`, partner offer records, saved sites, existing ticket insert/status rules, and existing notification/event patterns.
- Produces: `createJobOffer`, `withdrawJobOffer`, `declineJobOffer`, `expireJobOffers`, and `acceptJobOffer(input: AcceptJobOfferInput): Promise<{ offerId: number; ticketId: number; replayed: boolean }>`.

- [ ] **Step 1: Write failing database tests for the offer lifecycle**

Test draft/send/review/decline/withdraw/expire; partner and vendor authority; immutable sent version; changed compliance, coverage, capacity, rate version, mapping, and authorization; stale offer version; accepted commercial snapshot; original partner `workTypeId`; correct initial ticket `status`/`lifecycleState`; exact-one ticket under duplicate clicks, retries, and simultaneous acceptance; rollback when ticket creation fails; and stable result readback.

- [ ] **Step 2: Run offer tests against the isolated test database and verify failure**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/marketplace/job-offers.database.test.ts src/routes/service-marketplace-offers.test.ts`

Expected: FAIL because job-offer services and routes are absent.

- [ ] **Step 3: Implement the transactional domain service**

Lock the offer row, compare the submitted offer version, perform authoritative revalidation, insert the immutable snapshot, create a ticket through a shared ticket-creation helper, write nullable ticket lineage, transition the offer, and return the stored ticket for idempotent replay. Emit notifications only after commit.

- [ ] **Step 4: Implement routes, expiration worker hook, and OpenAPI contract**

Use explicit partner/vendor authorization and existing API errors. Expiration is an idempotent status transition selected by `expiresAt <= now()`; it never modifies tickets.

- [ ] **Step 5: Wire web offer composition and vendor inbox**

Require a confirmation summary before sending and accepting. On acceptance, navigate to the canonical ticket returned by the API. Disable stale versions and refresh facts rather than guessing.

- [ ] **Step 6: Regenerate clients and run focused tests**

Run: `pnpm generate && pnpm --filter @workspace/api-server exec vitest run src/services/marketplace/job-offers.database.test.ts src/routes/service-marketplace-offers.test.ts && pnpm --filter @workspace/vndrly exec vitest run src/components/service-marketplace/job-offer-flow.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit the offer-to-ticket flow**

```bash
git add artifacts/api-server/src/services/marketplace/job-offers.ts artifacts/api-server/src/routes/serviceMarketplace.ts artifacts/api-server/src/routes/tickets.ts artifacts/api-server/src/services/marketplace/job-offers.database.test.ts artifacts/api-server/src/routes/service-marketplace-offers.test.ts artifacts/vndrly/src/components/service-marketplace lib/api-spec lib/api-client-react lib/api-zod
git commit -m "feat: create tickets from accepted offers"
```

### Task 9: Add Mobile Marketplace Parity

**Files:**
- Create: `artifacts/vndrly-mobile/components/service-marketplace/VendorCapabilityEditor.tsx`
- Create: `artifacts/vndrly-mobile/components/service-marketplace/PartnerVendorResults.tsx`
- Create: `artifacts/vndrly-mobile/components/service-marketplace/JobOfferSheet.tsx`
- Create: `artifacts/vndrly-mobile/app/service-marketplace.tsx`
- Modify: `artifacts/vndrly-mobile/lib/locales/en.json`
- Modify: `artifacts/vndrly-mobile/lib/locales/es.json`
- Test: `artifacts/vndrly-mobile/app/__tests__/service-marketplace.test.tsx`

**Interfaces:**
- Consumes: generated marketplace hooks and exact server behavior from Tasks 4, 6, and 8.
- Produces: mobile vendor capability/rate management, partner comparison, offer creation, vendor accept/decline, and canonical ticket navigation.

- [ ] **Step 1: Write failing mobile screen tests**

Exercise role-specific rendering, 500-mile coverage editing, partner demand, eligible and out-of-area states, unknown rating/safety labels, send confirmation, accept confirmation, stale refresh, and ticket navigation.

- [ ] **Step 2: Run the mobile test and verify failure**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run app/__tests__/service-marketplace.test.tsx`

Expected: FAIL because the mobile marketplace screen does not exist.

- [ ] **Step 3: Implement mobile parity using existing primitives**

Reuse generated types and VNDRLY mobile components; do not duplicate distance, eligibility, ranking, or authorization logic on-device.

- [ ] **Step 4: Validate mobile and locale parity**

Run: `pnpm lint:i18n && pnpm --filter @workspace/vndrly-mobile exec vitest run app/__tests__/service-marketplace.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit mobile parity**

```bash
git add artifacts/vndrly-mobile/components/service-marketplace artifacts/vndrly-mobile/app/service-marketplace.tsx artifacts/vndrly-mobile/app/__tests__/service-marketplace.test.tsx artifacts/vndrly-mobile/lib/locales
git commit -m "feat: add mobile service marketplace"
```

### Task 10: Add AskV and ChatGPT Marketplace Tools

**Files:**
- Modify: `artifacts/api-server/src/assistant/tool-names.ts`
- Modify: `artifacts/api-server/src/assistant/tools.ts`
- Modify: `artifacts/api-server/src/assistant/tool-registry.ts`
- Modify: `artifacts/api-server/src/assistant/tool-packs.ts`
- Create: `artifacts/api-server/src/assistant/marketplace-tools.ts`
- Modify: `artifacts/api-server/src/assistant/data-tools-ops.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Modify: `artifacts/api-server/src/routes/assistantConnection.ts`
- Modify: `artifacts/api-server/src/assistant/chatgpt-workspace.ts`
- Modify: `artifacts/api-server/src/assistant/chatgpt-read-capabilities.ts`
- Modify: `artifacts/api-server/src/assistant/chatgpt-write-capabilities.ts`
- Modify: `docs/chatgpt-v-connection.md`
- Test: `artifacts/api-server/src/routes/assistantConnection.test.ts`
- Test: `artifacts/api-server/src/assistant/marketplace-tools.test.ts`
- Test: `artifacts/api-server/src/assistant/__evals__/marketplace-tool-use.eval.ts`

**Interfaces:**
- Consumes: authoritative marketplace search, eligibility, capability/offer, and job-offer services from prior tasks.
- Produces: permission-scoped AskV tools and matching MCP tools/resources for service search, match explanation, partner demand, vendor comparison, capability/rate drafts, job-offer drafts/send, and vendor accept/decline.

- [ ] **Step 1: Write failing permission and confirmation tests**

Assert vendor reads show every partner’s approved demand projection but no competitor data; partner reads show authorized vendor comparisons only; field employees are denied office marketplace tools; match explanations cite stored mappings; writes require exact action-bound confirmation; model-supplied coordinates/compliance/confidence are ignored; retries return canonical results; and acceptance returns the created ticket ID.

- [ ] **Step 2: Run assistant tests and verify failure**

Run: `pnpm --filter @workspace/api-server exec vitest run src/assistant/marketplace-tools.test.ts src/assistant/__evals__/marketplace-tool-use.eval.ts`

Expected: FAIL because marketplace tools are absent.

- [ ] **Step 3: Implement shared service-backed tools**

Do not reproduce SQL or policy inside assistant handlers. Read tools call marketplace projections; write tools create a confirmation-bound action fingerprint and execute the same domain service as web/mobile after confirmation.

- [ ] **Step 4: Update the existing ChatGPT VNDRLY MCP package**

Extend `assistantConnection.ts` tool listing/calling, `chatgpt-workspace.ts` embedded workspace views, and the existing read/write capability registries. Update the connection runbook with the new scopes and live verification. Preserve OAuth account linking and grants; the release process must update the existing installed VNDRLY catalog entry rather than creating a duplicate.

- [ ] **Step 5: Run focused assistant and contract verification**

Run: `pnpm generate && pnpm --filter @workspace/api-server exec vitest run src/assistant/marketplace-tools.test.ts src/assistant/__evals__/marketplace-tool-use.eval.ts src/routes/assistantConnection.test.ts`

Expected: PASS with no tool-name or schema drift.

- [ ] **Step 6: Commit assistant and plugin parity**

```bash
git add artifacts/api-server/src/assistant artifacts/api-server/src/routes/assistant.ts artifacts/api-server/src/routes/assistantConnection.ts docs/chatgpt-v-connection.md lib/api-spec lib/api-client-react lib/api-zod
git commit -m "feat: add AskV marketplace tools"
```

### Task 11: Backfill Existing Catalogs and Prove Migration Reconciliation

**Files:**
- Create: `artifacts/api-server/scripts/backfill-semantic-service-marketplace.ts`
- Modify: `artifacts/api-server/package.json`
- Test: `artifacts/api-server/src/lib/semantic-service-marketplace-backfill.database.test.ts`
- Create: `docs/semantic-service-marketplace-operations.md`

**Interfaces:**
- Consumes: schemas and matching interfaces from Tasks 1–2 plus current `work_types`/`vendor_work_types` rows.
- Produces: guarded, resumable classification/projection with lineage and a reconciliation report; no user-facing behavior changes by itself.

- [ ] **Step 1: Write failing disposable-database backfill tests**

Seed global and partner-owned work types, duplicate synonyms, existing vendor prices, removed selections, tickets, and partial prior runs. Assert no IDs or historical rows change; every projected row has lineage; reruns are no-ops; removed selections are not recreated; conflicts stop activation rather than guessing; and before/after/reconciliation counts agree.

- [ ] **Step 2: Run the backfill test and verify failure**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/semantic-service-marketplace-backfill.database.test.ts`

Expected: FAIL because the backfill does not exist.

- [ ] **Step 3: Implement guarded resumable backfill**

Require `APPLY_SEMANTIC_SERVICE_MARKETPLACE_BACKFILL=1`, advisory lock, batches, durable lineage, dry-run report, and explicit thresholds. Never delete, renumber, or overwrite current catalog/ticket rows. Classification failures remain pending and do not roll back already verified prior batches.

- [ ] **Step 4: Write the operations runbook**

Document dry run, evaluation review, guarded apply, reconciliation queries, feature-flag activation, rollback by disabling the feature flag, and the prohibition on destructive database recovery.

- [ ] **Step 5: Rerun the disposable-database test**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/semantic-service-marketplace-backfill.database.test.ts`

Expected: PASS with stable rerun counts.

- [ ] **Step 6: Commit backfill and runbook**

```bash
git add artifacts/api-server/scripts/backfill-semantic-service-marketplace.ts artifacts/api-server/package.json artifacts/api-server/src/lib/semantic-service-marketplace-backfill.database.test.ts docs/semantic-service-marketplace-operations.md
git commit -m "feat: backfill semantic marketplace safely"
```

### Task 12: Complete Cross-Surface Verification and Release Readiness

**Files:**
- Create: `lib/e2e/tests/semantic-service-marketplace.spec.ts`
- Create: `docs/semantic-service-marketplace-verification.md`
- Modify: `lib/db/src/schema/capabilityFlags.ts`
- Create: `artifacts/api-server/src/services/marketplace/feature.ts`
- Test: `artifacts/api-server/src/services/marketplace/feature.test.ts`
- Modify: `artifacts/api-server/src/routes/serviceMarketplace.ts`

**Interfaces:**
- Consumes: the completed marketplace across database, API, web, mobile, AskV, and ChatGPT plugin surfaces.
- Produces: release evidence and a disabled-by-default production capability flag ready for a separately requested ship.

- [ ] **Step 1: Add the disabled-by-default marketplace flag contract**

Define `SEMANTIC_SERVICE_MARKETPLACE_FLAG = "semantic_service_marketplace"` and `isSemanticMarketplaceEnabled(scope): Promise<boolean>` using existing organization/site capability flags. Test missing rows, disabled rows, partner scope, vendor scope, admin support scope, and route denial while disabled.

- [ ] **Step 2: Add end-to-end tests for the approved scenario**

Automate Flywheel “Gatekeeping,” Warwick “Perimeter Security,” MidCon “Gate Services,” high-confidence canonical mapping, 500-mile coverage, partner-specific rates, partner comparison, Out of Service Area blocking, offer send, vendor acceptance, and exactly-one ticket readback.

- [ ] **Step 3: Add isolation and adverse-flow E2E coverage**

Verify vendors cannot see competitors/budgets/private notes; partners cannot see unrelated private rates; a changed eligibility condition blocks acceptance; unknown score labels render; and direct API requests cannot bypass coverage.

- [ ] **Step 4: Run focused suites, then mandatory repository gates**

Run:

```bash
pnpm lint:i18n
pnpm run typecheck
pnpm run test:web
pnpm run test:api
pnpm test
```

Expected: all mandatory gates PASS. Fix root causes; do not reduce coverage or hide failures.

- [ ] **Step 5: Run the marketplace E2E suite**

Run: `pnpm --filter @workspace/e2e exec playwright test tests/semantic-service-marketplace.spec.ts`

Expected: PASS on desktop and configured mobile viewport projects.

- [ ] **Step 6: Record verification and feature-flag posture**

Document exact commit, test counts, migration dry-run counts, semantic evaluation precision/conflict results, UI evidence, AskV permission tests, plugin contract status, and that production activation/deployment has not occurred unless separately requested.

- [ ] **Step 7: Commit release-readiness evidence**

```bash
git add lib/db/src/schema/capabilityFlags.ts artifacts/api-server/src/services/marketplace/feature.ts artifacts/api-server/src/services/marketplace/feature.test.ts artifacts/api-server/src/routes/serviceMarketplace.ts lib/e2e/tests/semantic-service-marketplace.spec.ts docs/semantic-service-marketplace-verification.md
git commit -m "test: verify semantic service marketplace"
```

## Execution Boundary

Completing this plan produces a verified, feature-flagged implementation. It does not itself authorize production database migration, flag activation, push, deployment, TestFlight, or ChatGPT public-submission changes. If the user later requests **full ship**, follow the repository’s eight-track release rule and verify each lane rather than treating the implementation commits as the release.
