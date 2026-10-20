# Task 5 report: Fleet Home and advisory compliance projections

Implemented locally. The Home endpoint returns capability-scoped modules for summary, Dispatch, Yard, Driver, Office, Assets, Map, History, and Compliance. Summary reads independent sources; a failing Compliance or Map read produces an unavailable module state while unrelated actions remain visible. Module conflicts include scoped canonical-reload metadata.

The score endpoint uses the existing permission-scoped operational compliance register and requires current Admin, Office, or Dispatch capability. It returns category totals, ranked deductions, remediation, owner capability, estimated resolved score, and a typed Partner preview that omits evidence identities. Unknown category coverage earns no points, and no verification is invented. History remains empty until a canonical historical score source exists.

The existing Partner compliance policy now records its preference and red warning without rejecting Dispatch, Run, or Office checkpoints. Its database expectation was updated accordingly. Office-capability readers can access scoped compliance subjects through the existing register.

TDD evidence: the new Home and score test files first failed because their services were absent. The Partner-policy regression first failed with `fleet.partner_compliance_required`; the shared-score-schema regression first failed on unrecognized projection fields; the Map isolation regression first failed because Map state was omitted. Each was implemented after the observed failure.

Verification: `VNDRLY_LOAD_ENV_LOCAL=0` with an inert loopback `DATABASE_URL`, then `pnpm --filter @workspace/api-server exec vitest run src/services/fleet-mobile-home.test.ts src/services/fleet-compliance-score.test.ts src/services/fleet-compliance-policy.advisory.test.ts --no-file-parallelism`: **3 files, 8 tests passed**. `git diff --check` passed. No shared database, migration, broad test wrapper, or API typecheck was run; the parent owns the batched typecheck and fresh-local acceptance gate. The existing Partner-policy database test was updated but not run without a fresh-local test database.

Production files: `fleet-mobile-home.ts`, `fleet-compliance-score.ts`, `fleet-compliance.ts`, `fleet-compliance-policy.ts`, `routes/fleet.ts`, and shared `fleet-mobile-workflows.ts`. Focused service tests and the Partner-policy database expectation are included.
