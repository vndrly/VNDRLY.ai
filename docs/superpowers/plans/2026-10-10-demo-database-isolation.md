# Demo database isolation implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Preserve the Prairie Horizon fictional ecosystem while separating its records and effects from real companies.

**Architecture:** Distinct database and pool, authenticated server-derived request realm, production-only workers, and explicit demo side-effect restrictions.

**Tech Stack:** Existing Node.js, PostgreSQL, Drizzle, Express, AsyncLocalStorage; no new dependency.

**Spec:** ../specs/2026-10-10-demo-database-isolation-design.md (approved by the user's "Do it").

## Global constraints

- Preserve all demo passwords, IDs, and history. No production reset, schema destruction, or broad deletion.
- Apple submission remains on hold. Preserve unrelated working changes.
- Provision only an empty distinct destination. Verify its identity and connectivity before copying or routing.
- Export only validated synthetic roots and dependencies; stop on real cross-references.
- Production removal requires the separately presented exact primary-key manifest and approval.

## Review focus

Signed session provenance; middleware order; direct pool calls and transactions; concurrent requests; fail-closed outages; provider/storage/event leakage; startup/background context; synthetic-only copy completeness; real account preservation.

## Tasks

1. [x] Preflight existing hosting for a reachable separate database; record identity and capability evidence privately.
2. [x] Build synthetic-only dependency manifest, private recovery export, and cross-reference report. Verify counts and unchanged password hashes.
3. [x] Implement and test database realm dispatch for queries and transactions, concurrent context isolation, unavailable demo configuration, and default production workers.
4. [x] Add exact demo login registry and signed session realm routing before database guards; reject legacy demo sessions and forged hints.
5. [x] Audit and restrict demo providers, uploads/downloads, external connectors, and events; test denied side effects.
6. [x] Create empty schema and import the manifest; verify accounts, history, foreign keys, and checksums.
7. [x] Review and deploy only the intended API changes; verify production health, real access, and every demo role against the separate database.
8. [x] Present exact old-row removal manifest; after its separate approval, reconcile cleanup and verify production discovery and worker inputs exclude demo records.

## Execution ledger

- Design approved; no isolation cutover performed yet.
- Existing dataset: one partner, three vendors, twenty accounts, thirty days of history.
- Separate database created and reachable: vndrly_prairie_demo; source untouched.
- Verified 2,557 rows in 53 tables, identical contents, no outbound cross-references.
- Ruling: user/active-membership references form a legitimate cycle. Destination-only constraints are deferrable initially immediate; import defers checks until its successful COMMIT. Production constraints unchanged.
- Connection and boundary tests: six passing, including concurrency, no fallback, exact identity matching, legacy-session rejection and provider blocking.
- Final review: fresh reviewer found legacy-cookie login lockout and legacy custom OAuth grants; both reproduced by failing tests and fixed. Five regression tests passed.
- Provider regressions and event isolation: 26 tests passed. Shared production buses now suppress demo publication, including fallback paths.
- Dedicated new demo service login tested: reads three demo vendors and is denied SELECT on production public.users. No existing credentials rotated.
- Live API: all seven role checks passed; directory/dashboard show three vendors; synthetic Work Hub action read back and absent in production; real canonical admin login and health pass.
- Destination delta: three newly created synthetic approval-history events copied additively; 2,560 baseline rows preserved. Existing demo rows not overwritten.
- Old production removal completed after explicit approval: 2,560 exact rows across 54 tables; only nullable cycle break was users.active_membership_id. Transaction reconciled zero unreviewed rows removed. Post-cleanup demo reads, isolated synthetic task readback, real administrator login and health checks passed.
