# List One: partner-owned catalogs

Implementation only. No database mutations, credential changes, commits,
pushes, or deployments were performed by the catalog task.

## Implemented

- Partner catalog lists contain only the active partner's owned items. Vendor
  lists contain only items belonging to approved relationships; All Partners
  combines those accessible catalogs and labels the owning partner.
- Vendor selections and prices continue to use `(vendor_id, work_type_id)`.
  Each partner has independent work-type IDs. Saves with `partnerId` replace
  only that partner's selections; other partners and historical global rates
  are preserved. Unknown/inaccessible IDs are rejected before mutations.
- Partner admins can add and edit their own products and services. The partner
  page says Services & Pricing. Positive vendor counts resolve the live brand
  pill asset; zero uses the existing neutral image. Counts/offers include
  approved relationships only.
- Historical catalog endpoints require the vendor's active organization,
  system admin, or a related partner. Partner snapshots project to owned IDs
  and explicit source mappings and omit global payroll rates and publication
  commentary. Live pricing uses the scoped service endpoint.
- Independent vendor publish endpoints return 410; the publish panel is removed.
  Price/catalog changes no longer revoke unrelated partner approvals.
  Compliance expiration and qualified-employee gates remain in derivation.
- Existing EULAs, immutable versions, acceptance rows, and approval event history
  remain. When a never-published vendor's EULA is explicitly accepted, a locked
  transaction creates the platform agreement record needed by existing history
  relationships. It does not invent an acceptance. The existing EULA button
  stays; approval's modal displays the platform EULA when no version exists.
- Partner 1099 totals and email template editing are gated by the root task's
  reversible `TAX_REPORTING_ENABLED` switch.

## Additive migration

`artifacts/api-server/scripts/migrate-partner-owned-catalogs.ts` is explicitly
guarded by `APPLY_PARTNER_OWNED_CATALOGS=1` and an externally supplied
`DATABASE_URL`. It uses a transaction and advisory lock, executes the companion
SQL, and verifies there are no missing partner/source pairs before committing.

It adds `work_types.source_work_type_id` and its partner/source unique index,
copies every global item for every current partner, and records source lineage.
An existing owned item with the same canonical name is retained, with only its
source mapping filled. Existing prices/fields are never overwritten. It copies
legacy vendor selections/rates for approved relationships and copies AFEs and
work-type approvals with conflict-do-nothing. Tickets, site assignments, and
historical work-type references remain on their original IDs.

Run the explicitly requested Midcon relationship correction before this copy
so Warwick and Flywheel prices are included. Apply the schema migration before
serving code that selects the new column. No migration was executed here.

## Verification and remaining gaps

- TypeScript syntax parsing passed: zero diagnostics across 15 edited API/UI
  files. `git diff --check` passed for catalog-owned tracked changes.
- After dependency restoration, the focused catalog runs passed 21 tests across
  five files: catalog access/projection and derivation, approval readiness,
  single-price route isolation, actual approval routes, and the AskV catalog query. One disposable
  PostgreSQL regression test was skipped because no local test database was
  configured. The successful run used installed Vitest directly with elevated
  sandbox execution, a dummy local `DATABASE_URL`, and `VNDRLY_LOAD_ENV_LOCAL=0`.
  Ordinary sandbox attempts failed in the package launcher / esbuild before
  tests ran. Full typechecks and root validation gates remain root-owned.
- The migration has not been tested against disposable PostgreSQL, nor applied
  to the configured shared database. No claim of live catalog readiness is made.
- Browser validation of the edit modal, partner switching, scoped price saves,
  brand pills, and the EULA approval flow remains required.
- New partners created after this migration start with their own empty catalog
  unless the guarded migration is rerun or their admin adds items. Real customer
  catalogs are still pending as requested.
- Historical assignments/tickets deliberately retain legacy IDs. Catalog AFE
  badges for newly copied IDs therefore do not rewrite or invent links to those
  historical assignments. Existing historical records remain unchanged.
- Removal/archival of partner work types is not added; editing is additive and
  avoids deleting products referenced by history.

## Review corrections

- AskV `query_vendor_catalog` now calls the same approved-relationship scope
  helper as the UI API, applies the partner-ID restriction in its actual SQL,
  and returns no prices for inaccessible vendors or an empty approved scope.
- The vendor-detail price modal uses a dedicated one-record price endpoint
  with `partnerId`. It never sends cached sibling selections or prices. The
  route verifies active vendor authority, approved partner access, ownership
  of the work type, and an existing selection before returning success.
- Initial copying now uses the additive `partner_catalog_initializations`
  ledger, keyed by kind, partner, vendor, and source work type. Each selection,
  AFE, and approval mapping is claimed once inside the migration transaction.
  Claims are recorded even when the source is absent. Later reruns cannot
  recreate records deliberately removed by users, or import later global edits
  into an already initialized partner/vendor mapping.
- An already-mapped catalog with no ledger causes a preservation error and
  rollback. Such a database needs an explicitly reviewed baseline recording
  current mappings as initialized without copying historical selections again.
  Do not bypass this guard. This task never applied the earlier unledgered SQL.
- Required federal tax ID, COI document, and a valid current COI expiration are
  checked for EULA acceptance, single approval and bulk approval, independently
  of publication. The agreement-creation transaction also checks those fields.
  Existing agreement/acceptance/history rows are not changed by these checks.
- The brand count uses the actual current `brandImagePillSrc` resolver; the
  doctrine's older `baker-pill-button` module no longer exists.
- Obsolete publish-panel and no-catalog messages were removed from both web
  locales after the full-suite orphan-key check identified them. The focused web
  locale checks then passed all 11 tests (parity, placeholders, orphaned keys).
