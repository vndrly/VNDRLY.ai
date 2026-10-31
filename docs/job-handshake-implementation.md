# Job handshake implementation — October 30, 2026

Implemented locally. No production deployment, feature activation, database migration, catalog import, or business-record mutation was performed during this work.

## Connected workflow

1. A partner administrator can preview and import a UTF-8 CSV catalog (up to 1 MB and 5,000 rows). The original bytes, checksum, original codes/units and source-row-to-service links are retained in the existing audit store. Existing services are never overwritten; ambiguous same-name entries are reported as conflicts. Imported services enter the existing classification/review process. History provides the preserved original for download.
2. Vendor comparison starts with matching service capabilities. A vendor without a current partner-specific price appears with **Quote required**. Partners can send an in-app quote request; identical retries are deduplicated. A quote is not work authorization. Award still requires applicable commercial terms and eligibility.
3. The partner must supply a nonblank AFE on new job offers. Sending and accepting revalidate it. The accepted scope and commercial snapshot preserve that partner-assigned AFE. This is partner assignment and confirmation, not verification against an external accounting system.
4. Accepted offers serve as the durable job. The original acceptance ticket and its existing unique constraint remain intact. A separate nullable engagement reference supports many subsequent tickets. Both partner and vendor have accepted-job ticket lists and shift creation. The server enforces job ownership, scope, schedule boundaries, relationship restrictions and idempotency.
5. New Gate billing configurations require an accepted daily-rate job plus the existing explicit Gate-contractor authorization. Every period inherits the job, AFE and terms. Existing legacy configurations remain grandfathered; no historical records are guessed or reassigned. Job-based agreements cannot downgrade to unlinked billing.
6. Submission saves a numbered proof revision containing job identity, AFE, charges, notes, attachments, recorded time/location evidence and Gate coverage where applicable. Associated photo receipts retain their recorded hashes/metadata. Billing-relevant tax, rate and organization context is frozen too. Linked jobs require an accepted AFE, claim lines, evidence and closed crew sessions.
7. Partner reviewers approve, return for correction, or reject an exact submission revision. Stale versions/status changes fail safely. A vendor cannot perform partner review, and a partner cannot submit the vendor's claim. Approval stores the revision it approved. Corrections produce a subsequent revision rather than replacing earlier proof.
8. Web and mobile show the submitted proof and job/AFE. Web printing/PDF includes the saved submission. Invoice generation uses approved quantities, billing context and AFE rather than later edits to live defaults.

## Data preservation and rollout

- Existing ticket IDs, original offer links, assignments, AFEs, catalogs, rates, Gate configurations and evidence are not rewritten.
- New ticket columns are nullable except the revision counter, whose default is zero for historical records. Historical submissions are not given invented proof snapshots.
- `artifacts/api-server/scripts/migrate-job-handshake.ts` adds the engagement reference, idempotency key, proof history and revision fields plus the recurring-ticket unique index. It verifies column types, the reference and the index and rolls back on mismatch. It contains no delete, reset, drop or business-data backfill.
- The migration is registered as `migrate:job-handshake` and ordered after the existing marketplace migration in API deployment. The earlier migration now limits its index handling to its own columns, avoiding an ordering failure with the later handshake index.
- Existing marketplace feature controls remain unchanged. The additive migration and normal release checks must precede deployment/activation. Do not enable the feature merely because source implementation is present.
- No new external dependency was introduced.

## Validation

- Combined focused API regression: 217 tests passed across 20 files, using mocked dependencies and an inert test connection. No database provisioning/reset occurred.
- An additional seven persisted-offer restriction tests passed after adapting their fixture to the required AFE contract (224 API tests total across these focused runs).
- Web component regressions: 13 passed across six files.
- Mobile proof/Gate/ticket regressions: 15 passed across three files.
- English/Spanish locale parity and whitespace checks passed.
- Real Edge browser verification at desktop and 390px width used actual source components with all API traffic intercepted. Verified CSV preview/import/download-link flow, matching vendor without price, quote request, disabled unpriced award and historical proof selection. Screenshots inspected; no horizontal overflow. Fixtures were explicitly synthetic and were never imported into VNDRLY.
- Evidence is saved under `.local/handshake-build-test-results.json`, `.local/handshake-discovery-results.json`, `.local/handshake-browser-results.json`, and `.local/handshake-desktop.png` / `handshake-mobile.png`.

Full repository typechecking, the full release test chain, database-backed migration/integration tests and an authenticated deployed end-to-end walkthrough have not been run. This is not a production-release verification record.

## Deliberate boundaries

CSV is supported; XLSX is not yet supported. Source-backed research catalogs have not been automatically loaded into the production master. Ambiguous equivalence still requires review. Accepted job terms are immutable; changing scope/AFE requires a new authorized offer rather than silently rewriting an accepted job. Split AFE allocations and a formal effective-dated amendment interface remain separate work. Existing unsupported commercial billing modes remain explicit manual-billing cases; accepted Gate daily billing has its dedicated supported path.

Core implementation is in marketplace discovery/job services, `partner-catalog-import.ts`, `ticket-submissions.ts`, ticket review routes, Gate billing, `invoice-generator.ts`, and the corresponding web/mobile components.
