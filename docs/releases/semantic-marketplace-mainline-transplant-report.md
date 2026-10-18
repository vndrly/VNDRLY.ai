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
