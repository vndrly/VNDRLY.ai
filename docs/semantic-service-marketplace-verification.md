# Semantic service marketplace verification

Date: 2026-10-18. Implementation commit: `79dd78212bffae1127122fd202fcf5179bd428fb`
(`test: verify semantic service marketplace`). Reviewed integration base:
`66e1a838d980b72f4041e4b3c39e14bb80d2d72f`. This evidence document follows
the implementation in a documentation-only commit; it does not change the tested code.

The implementation is ready for the controller's integrated verification gate.
It is **not production activation evidence**. No shared/production database,
deployment, TestFlight, plugin installation/publication, or external model was used.

## Feature posture

`SEMANTIC_SERVICE_MARKETPLACE_FLAG = "semantic_service_marketplace"` uses the
existing `capability_flags` table. The table's `enabled` default stays `false`;
no enabling rows or database migration were added by Task 12. Missing rows,
disabled rows, invalid/missing organization identity, and invalid site identity
cannot enable the feature. A site row takes precedence over its organization's
row; a missing site row inherits the organization. There is no cross-organization
or global-administrator fallback.

The commercial marketplace HTTP handlers check the flag before their domain
operation: vendor capability/preview/coverage/rate/demand, partner comparison,
offer creation/list/read/send/review/withdraw/decline/accept. Offer actions load
the authorized saved offer to select its saved site; body-supplied identities do
not override that saved scope. Ordinary callers use their signed active
organization, and support administrators use the endpoint/offer target
organization. Existing membership authorization still applies after the rollout
check. Disabled requests return `403 / marketplace.disabled`; flag storage
errors fail closed through the existing unavailable response.

AskV and ChatGPT marketplace adapters use the same HTTP handlers. Mapping-review
administration remains available for preparation before commercial activation.
Web UI additionally requires `VITE_SEMANTIC_SERVICE_MARKETPLACE_ENABLED=true`.
The expiry worker's existing `SEMANTIC_SERVICE_MARKETPLACE_ENABLED` environment
switch is separate; enabling a UI/worker switch does not enable an organization's
commercial API. Mobile requests remain subject to that same API gate.

No production state was inspected or changed. “Disabled by default” describes
the shipped policy; it is not a claim about a queried live capability row.

## Verification performed

API unit verification used the existing ignored `.local/transplant-unit.mjs`
runner. It calls `freshLocalChildEnvironment`, strips inherited provider and
PostgreSQL fallback credentials, sets the required provenance variables, and uses
the deliberately unusable loopback `127.0.0.1:9` database. It creates no database.
Database integration files were excluded, except the explicit name-filtered pure
backfill-planner run below, whose persisted tests were skipped.

| Scope and command | Result |
| --- | --- |
| `node .local/transplant-unit.mjs run src/services/marketplace src/services/service-matching src/routes/service-marketplace-vendor.test.ts src/routes/service-marketplace-vendor-store.test.ts src/routes/service-marketplace-partner.test.ts src/routes/service-marketplace-partner-store.test.ts src/routes/service-marketplace-offers.test.ts src/routes/service-marketplace-admin.test.ts src/assistant/marketplace-tools.test.ts src/routes/assistantConnection.test.ts src/assistant/chatgpt-workspace.test.ts src/lib/semantic-service-marketplace-schema.test.ts --exclude '**/*.database.test.ts'` | 20 files, 355 tests passed |
| After the flag-scope readability refactor: feature, offer HTTP, and marketplace assistant tests | 3 files, 36 tests passed |
| `node .local/transplant-unit.mjs run src/lib/semantic-service-marketplace-backfill.database.test.ts -t 'semantic marketplace legacy backfill'` | 7 pure tests passed; 2 persisted PostgreSQL tests skipped by the name filter |
| `node .local/transplant-unit.mjs run --config vitest.eval.config.ts src/assistant/__evals__/marketplace-tool-use.eval.ts` | 3 deterministic tool-contract tests passed; no model call |
| `pnpm --filter @workspace/vndrly exec vitest run src/pages/partner-catalog.marketplace.test.tsx src/pages/vendor-catalog.marketplace.test.tsx src/components/service-marketplace/job-offer-flow.test.tsx` | 3 files, 39 tests passed |
| `pnpm --filter @workspace/vndrly-mobile exec vitest run app/__tests__/service-marketplace.test.tsx` | 1 file, 14 tests passed |
| `pnpm exec tsc --build lib/db` and `pnpm --filter @workspace/api-server run typecheck` | Passed |
| `pnpm --filter @workspace/e2e exec tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --types node --skipLibCheck --strictNullChecks --noImplicitAny tests/semantic-service-marketplace.spec.ts` | New E2E spec and imported helpers passed |
| `pnpm --filter @workspace/api-spec run codegen` | Passed; regenerated files unchanged |
| `pnpm lint:i18n` | Passed; web 5,531 keys and mobile 3,406 keys per language |
| `node --test scripts/tests/fresh-test-database.test.mjs scripts/tests/verify-release-workflow.test.mjs` | 22 safety/workflow tests passed |
| `pnpm --filter @workspace/e2e exec playwright test semantic-service-marketplace.spec.ts --list` with explicit inert fresh-local provenance | All 3 scenarios discovered; listing starts no database or application server |
| `git diff --check` | Passed |

The optional whole E2E package typecheck, `pnpm --filter @workspace/e2e exec
tsc --noEmit -p tsconfig.json`, fails in the unchanged
`tests/fleet-commercial-offline.spec.ts`: line 3 uses a callback incompatible with
the installed Playwright `TestDetails` overload, with implicit-any errors at
lines 3, 8, 9, 10, and 13. No Task 12 file diagnostics were reported. The focused
new-spec typecheck above passed. This existing failure is retained as an explicit
controller follow-up, not suppressed or excluded from the package.

TDD: the initial feature module was absent; after adding its inert function
signature, 5 expected assertions failed (enabled organization results and
disabled-route denial). Implementing the scoped lookup and route gate made the
tests green. The feature suite now has 21 tests. A subsequent assistant readback
test caught an absent GET request body; optional body access corrected it and
the assistant/HTTP suites passed. A test run overlapped code generation's output
cleanup and failed to import a temporarily absent generated file; after
generation completed, the full focused selection above passed.

## Browser and PostgreSQL gate still required

This host has no local PostgreSQL/Docker. The marketplace browser suite was
authored, typechecked and listed, **not executed**. It has a top-level
`assertFreshLocalTestDatabaseEnvironment` before opening a pool. The shared pool
and browser configuration independently enforce isolation and loopback origins.
The fixture inserts synthetic rows into the fresh wrapper-owned database, does
not delete/reseed existing rows, and closes its browser contexts and pool.

`.github/workflows/verify-release.yml` already provisions a new loopback-only
PostgreSQL cluster without deployment secrets, runs the safe wrapper, and retains
Playwright results. The existing root `pnpm test` chain discovers the new spec.
The test-browser frontend enables its presentation switch; each synthetic
organization still needs an explicit database capability row. In that workflow,
the marketplace-only command is:

```text
pnpm --filter @workspace/api-server exec tsx scripts/run-with-test-db.ts -- corepack pnpm --dir ../.. --filter @workspace/e2e exec playwright test semantic-service-marketplace.spec.ts
```

Run that only in the workflow's `VNDRLY_TEST_DB_MODE=fresh-local` environment
with its explicit maintenance URL, never by borrowing a local/shared URL.

The three scenarios cover:

1. Synthetic Flywheel **Gatekeeping**, Warwick **Perimeter Security**, and MidCon
   **Gate Services**, reviewed 0.99 mappings to the same canonical service,
   vendor discovery of both partner wordings, 500-mile saved-base coverage,
   partner-specific $75/$125 rates, two-vendor comparison, unknown rating/safety
   labels, visible Out of Service Area and disabled action, direct API coverage
   bypass rejection, browser draft/send/confirmation/review/accept, ticket
   navigation, repeated acceptance returning the same ticket, and authoritative
   ticket/snapshot counts of exactly one with original catalog and lifecycle
   lineage.
2. Competitor identity/notes and partner budget/private-note exclusion from vendor
   discovery, denial of foreign-vendor rates, partner projection excluding
   unrelated terms, denial of a foreign partner comparison, and coverage reduced
   after send blocking acceptance without a ticket or snapshot.
3. Disabled organization rejection, a site-specific denial overriding an enabled
   partner, inheritance for another site, and missing-flag support-admin denial.

No API responses are intercepted. Canonical mappings are reviewed deterministic
fixtures, not a real-model semantic-quality result. On successful CI execution,
the happy scenario saves `partner-comparison.png` and `accepted-ticket.png` in
Playwright output; failed runs retain traces/screenshots. **Those screenshots do
not exist yet and no live UI evidence is claimed.** The existing PostgreSQL
offer/backfill suites must also pass to establish actual locking, concurrent
acceptance, transactional rollback, and persisted migration/replay behavior.

## Migration and semantic evaluation evidence

The schema contract suite verifies additive opt-in migration metadata and guarded
deployment wiring. No actual migration/backfill dry run or apply occurred in
Task 12. There are no current-environment production counts to report.

The passing pure backfill fixture has 3 work types, 1 current vendor selection,
and a reconciliation fixture of 9 historical tickets. It plans 2 active exact
alias mappings, 1 review-required conflict, 1 capability and 1 partner offer;
lineage/reconciliation assertions preserve the 3/1/9 legacy counts. The ambiguous
fixture conflict rate is 1/3 (33.3%); this is a deliberately adversarial test
fixture, not a production metric or a recommended threshold. Novel unmatched
services remain pending; mismatched prior capability lineage prevents offers.

Semantic matching tests exercise the three gate/security wordings, operationally
different gate-actuator repair, inclusive configured confidence thresholds,
conflicting/remapped/manual mappings, stale saved subjects and classifier
outages. They inject classifier outputs. **Measured category precision, real
model conflict rate, production catalog coverage and calibrated activation
threshold are unavailable.** No 100% model-precision claim follows from passing
fixture tests. Activation must wait for the labeled evaluation and guarded
dry-run/reconciliation evidence described in
`docs/semantic-service-marketplace-operations.md`.

## AskV and ChatGPT status

The focused 355-test API selection includes marketplace AskV authorization,
privacy projection, rejected foreign/missing/field-employee scope, saved
action-bound confirmation, changed-action invalidation, idempotent canonical
readback, plus the existing ChatGPT connection/workspace contracts. The separate
3-case deterministic tool evaluation checks vendor versus partner read tools,
separate write grants, field-employee exclusion, and marketplace workspace
projection. HTTP flag denial is shared by these adapters.

These are local contract tests. The installed plugin version, linked-account
grants, real scoped read/synthetic action/readback, public submission/review
status and public availability were **not inspected or changed**. No installed,
submitted, approved or publicly available update is claimed. Those checks belong
to the later authorized full ship.

## Controller handoff

The mandatory whole-tree gates are intentionally reserved for the controller on
the exact integrated tree: `pnpm lint:i18n`, `pnpm run typecheck`,
`pnpm run test:web`, `pnpm run test:api`, and `pnpm test`. The locale and scoped
checks above do not substitute for that batch. Record its SHA/results, real
fresh-local PostgreSQL/E2E evidence, actual migration/reconciliation output and
semantic calibration before activation. Keep organization/site flags disabled
until those conditions pass. The deployment and all eight full-ship tracks are
outside Task 12's local implementation authorization.

## Task 12 review fix, round 1

The review found that an offer-list GET body could select a site flag while
returning an organization-wide list. Scope resolution now explicitly distinguishes
creation, organization lists, and saved offers. List requests ignore site IDs in
both body and query and check only the signed organization (or administrator's
endpoint target). Creation takes its site from schema-validated creation input;
detail/actions take it from the authorized saved offer. Existing domain
authorization still applies.

The regression first reproduced 16 body/both-site bypass cases returning 200
instead of 403. After the fix, the feature suite contains 50 passing cases,
including missing/disabled organization flags plus an enabled site for partner
and vendor lists, owner and administrator sessions, forged body/query/both,
enabled organization lists ignoring a disabled forged site, and legitimate
site-scoped creation/detail. The five affected feature/vendor/partner/offer/AskV
suites pass **93 tests**. The new E2E scenario also exercises forged partner and
vendor list bodies/queries against persisted flags when fresh-local CI runs;
it remains authored, not locally executed. API typecheck, focused E2E typecheck,
and `git diff --check` pass. Full repository/database/browser gates remain
reserved for the controller as above.
