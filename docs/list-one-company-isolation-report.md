# List One: company isolation implementation

## Findings and changes

- `siteLocations.ts` explicitly allowed all vendors and active field employees
  to enumerate every visible site and read arbitrary site IDs. Lists now use
  approved partner relationships; detail, QR, and assignment endpoints use the
  same approval rule. Field employees additionally require their own ticket or
  active crew assignment at that specific site, not a vendor-wide assignment.
  Cancelled/denied tickets and removed/declined/rejected crew rows do not grant
  access. Partners remain restricted to their session company.
  An unscoped partner can no longer bypass authorization with `partnerId` query
  parameters. Admin access remains available.
- `approved-partner-sites.ts` shares the relationship predicate with AskV.
  `data-tools-ops.ts` now applies it to site list, detail, and operational-status
  tools. Missing company scope fails closed. The field operational-status tool
  resolves an active, nondeleted vendor employee before applying both approval
  scope and the employee-specific ticket/crew site assignment rule.
- Vendor notes previously had no authoring company. `vendorNotes.ts` adds nullable
  `ownerOrgType` and `ownerOrgId`. Routes derive ownership from the signed session:
  partner company ID, the vendor company ID, or the platform's `platform:0` scope. Reads and deletes include
  that owner, and creates cannot accept client-supplied ownership. Existing role
  permissions now also allow vendors to author/read/delete their own private notes
  only on their own vendor subject. Legacy NULL ownership is preserved and hidden
  from all company-facing note routes, including the normal platform notes view.
- Partner callers cannot enumerate the internal `/vendor-contacts` directory.
  `/vendors/:id/contacts` retains only active, nondeleted office contacts explicitly
  designated by the vendor profile's primary business contact email. Office role
  alone no longer exposes a person's name/email/phone. A missing primary email
  yields an empty contact collection; primary business details remain on the vendor
  profile. This uses existing designation fields and does not invent a new role.
  The endpoint
  returns only identity, business contact, role, and active/created fields for
  partners. Certification, review, and other internal employee fields are omitted.
- Field-employee APIs and vendor-wide partner approval APIs already denied partner
  callers. The vendor-facing relationship response now also withholds the partner's
  private relationship notes.
- The partner vendor-detail page no longer mounts internal employee, membership,
  or unrelated partner approval sections. Its employee query is disabled using a
  backwards-compatible optional hook argument. Vendor note cache keys include
  active role, partner ID, and vendor ID so switching companies cannot reuse another
  company's cached notes. Own-vendor note queries are now enabled. Business contacts
  and existing business details remain visible.

## Migration

- `lib/db/drizzle/list_one_vendor_note_ownership.sql` only adds the two nullable
  columns using `ADD COLUMN IF NOT EXISTS`; no rows are changed or deleted.
- `artifacts/api-server/scripts/apply-vendor-note-ownership-migration.mjs` runs
  those additions transactionally with a five-second lock timeout and verifies
  resulting names, types, and nullability before commit.
- `migrate:vendor-note-ownership` is registered in the API package and included
  in the API deployment workflow alongside its existing guarded migrations.
- Migration has NOT been run. It must run before this API version starts.
  Any future legacy-note attribution requires evidence of authoring company;
  vendor subject or current membership alone is insufficient.

## Verification

- Authored 35 scenarios in `artifacts/api-server/src/routes/company-isolation.test.ts` with mocked
  database access for note read/create/delete ownership, legacy exclusion SQL,
  company query-parameter bypass, approved vendor site filtering, direct site/
  QR/assignment denial, partner employee/approval denial, contact redaction, and
  AskV site authorization. The review follow-up adds approved vendor and assigned
  employee success cases, other-site/same-partner denial, pending/revoked approval
  denial, field list assignment predicates, contact designation and redaction,
  reciprocal Warwick/Midcon ownership scopes, vendor note create/delete scoping,
  foreign vendor subject denials, and assigned/unassigned AskV operational status.
- `git diff --check` passed.
- Focused Vitest run could not load its configuration in the filesystem sandbox.
  An escalated attempt passed that boundary but failed with `ERR_MODULE_NOT_FOUND`
  for the workspace's missing Vitest link. No test body ran.
- Migration runner `node --check` passed (syntax only, no database connection).
- Direct API typecheck exited with 555 lines of diagnostics including missing Vitest and
  workspace packages and stale workspace schema exports. This is not a passing
  validation result. Root task is restoring the existing locked dependencies.
- Required remaining checks: run the new mocked route test, API/web typechecks
  with restored workspace dependencies, relevant existing hook tests, and browser
  checks for partner vs vendor/admin vendor-detail visibility. Keep
  `VNDRLY_LOAD_ENV_LOCAL=0` and a dummy local `DATABASE_URL` for mocked tests;
  never use the reset-based API test wrapper against shared data.
- Follow-up verification after dependency restoration: the company-isolation
  suite passed alongside Gate Log report tests (58 tests across two files).
  API/web typechecks also passed after the initial dependency failures. Root is
  rerunning whole-tree validation as the remaining List One work completes.

## Boundaries

- No commit, deployment, live DB writes, secret access, credential changes, or
  changes to the user's deleted shortcut were performed.
- Partner catalog prices and catalog snapshots are part of the separate catalog
  task. The existing vendor Services & Pricing card is retained pending that work;
  this report does not claim its partner-specific pricing behavior is completed.
- This is bounded site/vendor/notes/people isolation work, not a full audit of all
  reporting, export, portal, ticket, and AskV operations. Broader checks remain part
  of List One's final independent review.
