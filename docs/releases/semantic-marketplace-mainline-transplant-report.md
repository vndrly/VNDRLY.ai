# Semantic marketplace mainline transplant

## Scope and provenance

Integrated onto `fc8ad8d2039e9d43512fed898cc8d5f301b40c3a` (current main at start), on `codex/semantic-marketplace-mainline`. The target initially had a detached HEAD; the named branch was created at that exact base.

Applied these reviewed source commits in order, using sequential no-commit cherry-picks and explicit conflict adaptation:

1. `7466e232` — design document
2. `835e7b3d` — implementation plan
3. `410f4056` — additive semantic marketplace schema
4. `64b57fde` — canonical classification
5. `22f83ecb` — operational meaning of service snapshots
6. `66f4175f` — administrative mapping review
7. `ccb28b37` — vendor capabilities
8. `791bde9b` — coverage bound to current saved address
9. `7477f4e7` — vendor catalog UI
10. `df786ef3` — capability preview before creation
11. `f4a76c00` — transparent vendor ranking
12. `d93e396a` — partner marketplace UI
13. `5692b7c9` — accepted offers create canonical tickets
14. `8eeb0738` — lineage and peak crew capacity
15. `84486113` — mobile marketplace
16. `7ceefc6c` — AskV and ChatGPT marketplace tools
17. `3abfd328` — guarded, resumable backfill
18. `c951d409` — reviewed backfill lineage requirement

No wholesale merge or rebase of the stale source branch was performed. Pre-market commit `c7451243` and its ancestors were not transplanted. The reviewed design and plan under `docs/superpowers/` remain. The source `.superpowers/sdd/.../task-8-report.md` scratch file was excluded from the index.

## Conflict resolution and adaptations

- Ticket schema retains main's `fleetPlan` and ticket-number reservation table while adding marketplace lineage fields and the unique job-offer index.
- API startup retains every main worker, including native operations, Gate monitoring/daily billing, onboarding, and Work Hub workers; marketplace expiry is added under its feature flag.
- Auto labor keeps main's transaction and ticket-row lock. Accepted commercial snapshot reads now use that same transaction connection.
- Main's authorized, optimistic-concurrency-controlled, idempotent ticket labor-finalization service remains the only close path. The old source inline close implementation was not restored. Manual marketplace billing is handled in the service without inventing hourly charges; ordinary regeneration/audit failures still roll back. Added a behavioral replay/receipt test for this adaptation.
- Ticket creation retains `assertRequiredWorkClear` and delegates the insert/history operation to the shared marketplace helper. Native measured arrival, live assignment checks, ticket photo association, labor-finalization capability, and current financial behavior remain.
- Site access changes add accepted engagement access to current main. Its newer session handling, hidden-site protections and other route behavior remain.
- Web/mobile translations combine marketplace keys with current SMS enrollment, Work Hub, and navigation/localization strings. No current locale section was replaced wholesale.
- Assistant tool registries, tool packs, read/write scopes, and workspace view lists combine current main and marketplace. All current Fleet commercial/safety/availability tools, operational views, library/live-meeting views and native-work views remain.
- ChatGPT execution continues through main's `executePreparedAction`, action-panel proof, grant/session checks, claimed execution, durable result and audit boundaries. Marketplace tools receive server authorization only through the existing bound execution path. Model confirmation and replay keys remain stripped from prepared payloads.
- ChatGPT tests retain all current main scenarios and add the two marketplace scope/approval scenarios. The existing My Workday navigation test now mocks its separate branding query, so it can run without a real organization database.
- OpenAPI was merged as source of truth, resolving line-ending-only overlaps separately. Both generated clients were regenerated once from the combined definition, not hand-merged. All 142 original main operation IDs remain; the integrated definition has 173. The reviewed paginated ticket response correction is retained.
- Original CRLF encoding is retained for the existing OpenAPI and site-location files to avoid whole-file line-ending churn. Generated formatting changes follow the reviewed generator formatting scripts.

## Mainline behavior preserved

The integration starts from main, adds only the selected marketplace patches, and does not replace the following modules or release configuration:

- Native bearer-over-cookie session precedence (`src/lib/session.ts` unchanged).
- Gate daily billing, shared duty-clock, GPS and native operations services.
- Ticket-backed Fleet billing and commercial reconciliation (`services/fleet-commercial.ts` unchanged).
- Offline ticket/photo recovery and canonical photo association (`services/ticket-photo-association.ts` unchanged).
- Work Hub/Teams implementations, Fleet safety/compliance/availability services.
- Current mobile navigation/runtime/TestFlight fixes; profile gains only the marketplace entry, and locale additions are additive.
- SMS/legal/demo-isolation implementations and canonical credentials.
- Assistant consent, grant validation, action-panel authorization, idempotency, audits and current-main tool registrations.

These statements describe source preservation and focused contract verification, not a claim that every existing feature was exercised end to end.

## Verification and results

No live/shared database was accessed. No migration, backfill, seed, destructive database operation, push, deployment, OTA, TestFlight or plugin publication was performed.

For API unit tests, the local runner uses `freshLocalChildEnvironment` with a deliberately unusable loopback database URL at `127.0.0.1:9`, strips provider credentials, and excludes `*.database.test.ts`. It provisions no database. The runner and detailed local log are ignored files under `.local/`.

| Command / scope | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed; existing lockfile unchanged, no dependency introduced |
| `pnpm --filter @workspace/api-spec codegen` | Passed; Orval plus reviewed formatting/deduplication scripts |
| `pnpm --filter @workspace/api-spec test` | 3 tests passed |
| Focused API selection: marketplace/service-matching services, marketplace routes, marketplace assistant, wiring, connection boundary, commercial rates, schema contract, safety score, auto labor and finalization | Initial run: 19 files passed, 1 file failed; 303 passed and 1 failed. Failure was the existing unmocked My Workday branding query, corrected as described above |
| Rerun: `assistantConnection.test.ts`, `chatgpt-workspace.test.ts`, `marketplace-tools.test.ts`, `auto-labor-marketplace.test.ts`, `ticket-labor-finalization.test.ts` | 5 files, 166 tests passed |
| `vitest run --config vitest.eval.config.ts src/assistant/__evals__/marketplace-tool-use.eval.ts` | 3 deterministic tests passed; no model call |
| Web focused marketplace files: job-offer flow, admin mappings, partner catalog, vendor catalog | 4 files, 49 tests passed |
| Mobile `app/__tests__/service-marketplace.test.tsx` | 1 file, 14 tests passed |
| `pnpm lint:i18n` | Passed: 3,405 mobile keys and 5,530 web keys per language |
| `pnpm exec tsc --build` | Passed shared-library reference build |
| `pnpm --filter @workspace/api-server exec tsc --noEmit -p tsconfig.json` | Passed after building the shared references; first attempt failed because this fresh worktree had no reference declaration outputs |
| OpenAPI operation inventory comparison | All 142 main operation IDs retained; 173 after integration |
| Conflict and index inspection | No unresolved conflicts; `.superpowers` scratch excluded |
| `git -c core.autocrlf=false -c core.whitespace=cr-at-eol diff --cached --check` | Passed, respecting the existing CRLF files |

## Remaining release work and risks

- Final full repository gates are intentionally deferred to the coordinating release workflow. In particular, the isolated PostgreSQL acceptance-race/backfill integration suites, broader web/mobile suites and E2E suite have not run on this integrated tree.
- The marketplace migration and backfill were retained but not applied. Backfill requires the reviewed lineage artifacts and explicit guarded invocation documented in `docs/semantic-service-marketplace-operations.md`; no production behavior is claimed from local tests.
- Regenerated artifacts include the reviewed formatting changes and paginated ticket contract correction; full frontend typechecks and broader regression gates still belong to final validation.
- Local review cannot establish deployed plugin installation, linked-account grants, provider behavior, native runtime or live availability. Those remain separate verification tasks under any later authorized full ship.

## Independent review follow-up: integration fix wave 1

Starting tree: `80d7ba6547977f85357f5c5fe2a4bacbcea3dc4d`. This follow-up addresses all four Important findings without adding a dependency, changing the database schema, publishing, or accessing any live/shared database.

### Fixes and preserved boundaries

1. **Backfill runtime fingerprints.** Both demand and capability mappings now write `evidence.serviceMatching.subjectFingerprint` through the runtime's shared fingerprint function. The backfill takes the normal subject advisory lock and locks/reloads the saved subject; changed planning inputs fail closed rather than being stamped as current. Admin approval/remapping now binds the appended reviewed version to the exact locked saved subject, including older backfill proposals without this metadata. Existing evidence/history remains intact. Previously deficient persisted rows are not silently blessed by rewriting history: they require deliberate review or successful reclassification. New coverage tests exercise backfill evidence through discovery, and a fresh-local PostgreSQL regression exercises actual backfill inserts through the real discovery adapter.
2. **Address-derived coverage retirement.** Vendor physical-address changes now retire all active default and capability-specific service areas in the same transaction that clears geocoding. Unchanged addresses retain coverage; failure rolls everything back; other vendors are untouched. Offer validation locks the vendor row before reading current eligibility, so acceptance cannot race an address change and use retired coverage. Acceptance still reruns the authoritative discovery/eligibility path before snapshots, relationship engagement, or ticket creation.
3. **Durable catalog classification retry.** Partner create/edit/AFE-import and existing administrator work-type create/edit/import routes use one shared saved-row classification service. AFE import still updates only existing partner AFEs; it does not create unknown services or change scope. Missing or stale decisions remain discoverably pending/ineligible by the existing exact-fingerprint check. Saved catalog rows are the durable retry source: a feature-flagged startup/60-second worker scans bounded pages and retries after outages or restarts, without an ephemeral-only queue or schema change. Current reviewed/rejected decisions are terminal and are not overwritten. Provider/configuration failures do not undo successful catalog saves. All existing role checks, partner scoping, duplicate handling, vendor selections and AFE semantics remain.
4. **Explicit relationship restrictions.** Discovery and create/send/accept validation block `revoked`, `rejected`, and `suspended` relationships, while absent, pending-review, and approved relationships retain the marketplace's no-preapproval behavior. Validation takes a relationship share lock inside the existing serializable offer transaction; restricted acceptance cannot create an acceptance snapshot, ticket, or engagement. The existing deliberate partner re-evaluation action can reopen a revoked relationship to `pending_review`; marketplace engagement itself cannot clear a restriction. Existing accepted-offer idempotent readback remains unchanged. Added `RELATIONSHIP_RESTRICTED` to source OpenAPI, regenerated clients once, and supplied web/mobile EN/ES explanations.

No native auth, Gate duty-clock/billing/GPS, Fleet billing/reconciliation, offline recovery, Work Hub/Teams, mobile runtime/release, SMS/legal/demo, or assistant consent/grant/idempotency implementation was replaced.

### Wave 1 verification evidence

The same credential-stripped loopback-port-9 unit runner described above was used. No database was provisioned or contacted successfully. Database tests were added, not executed. Full repository gates remain deferred to the coordinating task.

| Command / scope | Result |
| --- | --- |
| `node .local/transplant-unit.mjs run src/services/service-matching/catalog-classification.test.ts src/services/marketplace/vendor-address.test.ts src/services/marketplace/job-offer-restrictions.test.ts src/routes/service-marketplace-partner-store.test.ts src/routes/service-marketplace-admin.test.ts src/routes/catalog-classification-wiring.test.ts src/services/marketplace/job-offers.test.ts src/services/service-matching/service-matching.test.ts src/services/marketplace/eligibility.test.ts src/services/marketplace/ranking.test.ts src/routes/service-marketplace-vendor-store.test.ts src/routes/service-marketplace-vendor.test.ts src/routes/service-marketplace-partner.test.ts src/routes/service-marketplace-offers.test.ts` | 14 files, 157 tests passed |
| Same wider API selection, first run | 156 passed / 1 failed: an existing test explicitly expected revoked relationships to remain offerable. Expanded its assertions to preserve null/pending/approved coverage and assert all three explicit restrictions; no test removed or skipped |
| Mutation verification: temporarily disabled new backfill fingerprint, coverage retirement, classification runner and relationship guard, then ran their four focused files | 13 expected failures / 11 passed; restored all fixes and reran the green selection above |
| `node .local/transplant-unit.mjs run src/lib/semantic-service-marketplace-backfill.database.test.ts -t "semantic marketplace legacy backfill"` | 7 pure tests passed; the 2 persisted tests intentionally not selected |
| `pnpm --filter @workspace/api-spec codegen` | Passed; only the new reason-code enum added to generated output |
| `pnpm --filter @workspace/api-spec test` | 3 tests passed |
| `pnpm exec tsc --build` then `pnpm --filter @workspace/api-server exec tsc --noEmit -p tsconfig.json` | Both passed |
| `pnpm --filter @workspace/vndrly exec vitest run src/pages/partner-catalog.marketplace.test.tsx src/pages/vendor-catalog.marketplace.test.tsx src/components/service-marketplace/job-offer-flow.test.tsx` | Final selection: 3 files / 39 tests passed, including the new restriction-display test |
| `pnpm --filter @workspace/vndrly-mobile exec vitest run app/__tests__/service-marketplace.test.tsx` | 14 tests passed |
| `pnpm lint:i18n` | Passed: 3,406 mobile keys and 5,531 web keys per language |
| `git -c core.autocrlf=false -c core.whitespace=cr-at-eol diff --check` | Passed; original OpenAPI CRLF preserved |

New persisted regressions are in `semantic-service-marketplace-backfill.database.test.ts` (actual backfill-to-discovery) and `job-offers.database.test.ts` (revocation/re-engagement and address-change acceptance). They still require the repository's fresh-local PostgreSQL wrapper in final validation. Provider-backed classification, worker performance on a production-sized catalog, actual database locking/concurrency, and deployed UI/plugin behavior are not established by these focused local checks.

## Independent review follow-up: integration fix round 2

Starting tree: `d3d7bbee742afb072a26581470d3fb027493569a`. Closed the remaining canonical vendor-address writer gap without changing onboarding validation, authorization, legal consent, catalog selection, optional compliance/branding preservation, first-employee resume safety, or AskV's canonical endpoint delegation.

- Extracted the shared address/coverage operation's transaction body so callers with an existing transaction can reuse it. Onboarding completion now uses that body inside its existing canonical-write transaction, with no nested transaction or separately committed invalidation. A later employee/catalog failure rolls back the address, geocoding reset and retired areas together.
- `onboarding-step-sync.ts` routes vendor tax/address Save & Quit persistence through the transactional helper. Address-omitting tax patches and unchanged-address reruns preserve verified coordinates and coverage; changed addresses clear coordinates/geocoding and retire all active default/override areas for that vendor only.
- Audited canonical `physicalAddress` references and vendor update sites in API runtime and scripts. Besides the already-fixed vendor PATCH and the two onboarding paths, `seed-permian-basin.ts` can enrich a blank address on an existing vendor; that write now also uses the shared helper. The seed script was edited only, never run. New-vendor inserts have no existing coverage to invalidate; partner-address writers and geocode-only writes were not changed.
- Added `onboarding-marketplace-coverage.test.ts`, exercising real onboarding routes and the actual AskV `finalize_onboarding` delegation. Only external persistence and loopback transport are replaced. Assertions cover changed-address Save & Quit, completion of an already-completed onboarding record through wizard and AskV, loss of marketplace eligibility after default/override retirement, unaffected other-vendor coverage, unchanged-address repeat completion, optional-field preservation, first-employee reuse, and outer-transaction rollback. Added an address-omitting tax-patch regression to the shared helper suite.

Verification used the existing credential-stripped loopback-port-9 runner; no live/shared database, seed, migration, provider, push or deployment was used. The test-driven-development skill prompted failing tests before implementation: after correcting a missing `pool` export in the test persistence fixture, all three new changed-address onboarding/AskV cases failed on retained coordinates, and the omitted-address helper test failed on unnecessary retirement. The fixes then passed.

| Command / scope | Result |
| --- | --- |
| `node .local/transplant-unit.mjs run src/routes/onboarding-marketplace-coverage.test.ts src/services/marketplace/vendor-address.test.ts src/lib/onboarding-step-sync.test.ts src/routes/onboarding-optional-compliance.test.ts src/assistant/onboarding-parity.test.ts src/lib/onboarding-catalog.test.ts src/routes/service-marketplace-vendor-store.test.ts src/routes/service-marketplace-partner-store.test.ts src/services/marketplace/job-offer-restrictions.test.ts src/services/marketplace/eligibility.test.ts src/services/marketplace/job-offers.test.ts` | 11 files / 86 tests passed |
| `pnpm --filter @workspace/api-server exec tsc --noEmit -p tsconfig.json` | Passed |
| `git diff --check` and staged diff check | Passed; no OpenAPI/generated contract changes in this round |

Final full repository and actual isolated PostgreSQL gates remain the coordinating task's responsibility. The untracked review package files were not changed or committed.

## Consolidated final review fix wave

Starting tree: `143fd5bbfd8907566ddedf93e44d963e92863f1a`. Addressed the final three Important findings in one local fix wave. No live/shared database, migration, seed, push, deployment, provider, or plugin publication was used.

1. **Preserve review decisions during backfill.** The planner now honors the latest existing decision, including rejected and review-required states. Only an active decision with a current saved-subject fingerprint can supply projection. Under the same subject advisory lock used by reviewers, apply reloads subject ownership/content and the decision history (identity, version, state, canonical service, reviewer metadata, and fingerprint). It rechecks before mapping insertion and before capability/partner-rate projection; any intervening review aborts the affected transaction. Capability projection cannot append a new activation over existing mapping history. Legacy source selections are share-locked and compared with planning inputs so an intervening catalog deletion/replacement/edit cannot produce stale new supply. Existing committed batches remain resumable; missing/obsolete fingerprint evidence requires deliberate review, never silent blessing.
2. **Keep durable lineage without blocking mutable catalog selections.** Since this marketplace schema has never been deployed, corrected its initial Drizzle definition: `source_vendor_work_type_id` remains a nullable historical integer and no longer declares a foreign key. The existing metadata-driven additive migration therefore creates it correctly on first apply; no data cleanup, constraint removal/alteration, or migration UPDATE was added. The persisted regression inspects PostgreSQL constraint metadata, removes/replaces the legacy selection, and verifies that the old offer ID, rate and capability lineage survive unchanged. Current legacy writers themselves remain unchanged.
3. **Project accepted AFE into tickets and accounting.** Canonical ticket list/detail AFE now reads the immutable acceptance `scopeSnapshot.afeCode` for marketplace tickets. The acceptance loader also exposes that value in `marketplaceCommercialTerms.afe`; invoice generation uses it, including accepted absence, instead of assignment/site defaults. Non-marketplace assignment/site and Gate precedence remain unchanged, and the ticket read's existing Fleet AFE handling remains. The existing nullable ticket AFE and extensible commercial-terms API contracts suffice; regeneration produced no generated changes.

The test-driven-development skill drove initial failing regressions: four failures reproduced both existing review states, review between planning/apply, and the deletion-blocking schema FK; two invoice failures reproduced wrong AFE and mutable fallback for an accepted absence; a further failing regression reproduced projection after a legacy selection disappeared. All were made green without deleting or skipping those cases.

### Final wave focused verification

The existing credential-stripped loopback-port-9 unit runner was used. PostgreSQL integration tests were authored and typechecked, not run locally; the coordinating task owns the full isolated CI batch.

| Command / scope | Result |
| --- | --- |
| `node .local/transplant-unit.mjs run src/services/service-matching src/services/marketplace src/lib/semantic-service-marketplace-schema.test.ts src/lib/ticket-commercial-rate.test.ts src/lib/auto-labor-marketplace.test.ts src/lib/invoice-marketplace-afe.test.ts src/lib/invoice-engine.test.ts src/routes/tickets-detail-shape.test.ts src/routes/tickets-list-shape.test.ts src/routes/tickets-portal.test.ts src/routes/service-marketplace-admin.test.ts src/routes/service-marketplace-offers.test.ts src/services/ticket-labor-finalization.test.ts --exclude '**/*.database.test.ts'` | 21 files / 242 tests passed |
| `node .local/transplant-unit.mjs run src/lib/semantic-service-marketplace-backfill.database.test.ts -t 'semantic marketplace legacy backfill'` | 15 pure tests passed; 3 persisted tests intentionally not selected |
| `pnpm exec tsc --build lib/db` | Passed |
| `pnpm --filter @workspace/api-server exec tsc --noEmit -p tsconfig.json` | Passed, including new persisted regressions |
| `pnpm --filter @workspace/api-spec codegen` | Passed; generated contracts unchanged |
| `pnpm --filter @workspace/api-spec test` | 3 tests passed |
| `git diff --check` | Passed |

Remaining evidence: final full repository gates and actual fresh-local PostgreSQL runs must establish real locking, legacy catalog removal/replacement, and accepted AFE canonical reads/invoice regeneration. No claim of production activation or deployed behavior is made. The initial-schema correction intentionally does not repair any independently applied older experimental schema; no destructive repair is authorized or included. The untracked final-review diff package was left untouched.
