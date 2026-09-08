# List One implementation

Authorized September 7, 2026. Implementation and verification are authorized;
deployment is not requested. Preserve all existing data and credentials.

## Progress

Local implementation covers company isolation, partner catalogs, Gate Employees,
combined Gate Log reporting/category capture, map tools, persistent AskV voice,
branding and release feature controls. Schema-dependent features are not ready
for live use until migrations pass. Payroll remains a gross-pay draft rather
than a finished payroll/accounting integration. No deployment was requested.

- [ ] 1. Company isolation: sites, vendor detail, private company notes, direct access and exports.
- [ ] 2. Correct Midcon relationships with Warwick and Flywheel using guarded updates.
- [ ] 3. Partner-owned catalogs: temporary independent copies for all partners; contracted vendors select services and partner-specific prices; preserve existing rates; partner-only product management; change vendor approval catalog view.
- [ ] 4. Gate Employees grouping and gatekeeper assignments; preserve existing roles.
- [ ] 5. Shared Visitors / Gate Log workflows, all-partner navigation, remove Visitors navigation, site/date/company/purpose filters and printable reports.
- [ ] 6. Data-backed gate operations/security and authorized AskV questions.
- [ ] 7. Restore vendor/partner maps and add crew selectors, activity, freshness, trip/site duration, mileage and supported ETA.
- [ ] 8. Persistent opt-in AskV voice across routes and modal closure with accurate visible state and off switch.
- [x] 9. Brand vendor-count pills; zero remains gray. Local rendering regression passed; not deployed.
- [x] 10. Hide tax/1099/FIRE and unfinished accounting using reversible feature controls; keep payroll visible. Local flag tests passed; not deployed. Payroll integrations remain item 11.
- [ ] 11. Payroll calculation, review, CSV and supported QuickBooks/OpenAccountant transfers, reconciliation and duplicate prevention.
- [ ] 12. Focused tests, required checks, application verification and final independent review.

## Clarifications

- EULA button stays unchanged.
- Warwick site-list exposure is uncertain; investigate rather than assume a defect.
- Notes belong to the authoring organization, not the organization discussed.
- Partner-facing vendor details retain business and designated contact information,
  but not internal employee lists or unrelated partner approvals/prices.
- Vendors do not publish independent catalogs. All Partners means accessible
  partner selections only. Midcon intends to work with Warwick and Flywheel;
  the live records do not yet reflect both approved relationships.
- Discovering public Hotlist work does not grant access to full private site lists.
- Real partner catalogs are pending. Temporary catalogs derive from existing data.
- Additional partner employee roles require customer discovery, not invented roles.
- AskV service editing is a capability to assess; avoid claiming unsupported actions.
- Payroll is priority and remains in product scope; it must be verified before use.
- Preserve ambiguous legacy note ownership without exposing it to other companies.

## Execution record

- Baseline: existing deleted `artifacts/vndrly/public/assets/buttons/buttons - Shortcut.lnk` is user work and must remain untouched.
- Dedicated local branch created: `codex/list-one-implementation`.
- Ruling: work in the existing checkout on a dedicated branch; preserve its installed dependencies and existing local configuration. No merge/push/deployment is implied.
- Preliminary finding: vendor note routes currently filter only by subject vendor, not authoring company. This requires an ownership migration and permission tests.
- Company isolation first patch authored; independent review found required follow-ups: vendor-owned internal notes, designated contacts rather than office directory, and employee-specific site authorization. None is marked complete yet.
- Partner catalog implementation assigned to focused implementer; existing work_types.partnerId and vendor_work_types can preserve per-partner rates without an unrelated catalog storage redesign.
- Map runtime public-token configuration, crew employee/activity filters, persistent explicit AskV voice mode, and financial visibility controls authored by root. Tests pending dependency restoration.
- Local pnpm was blocked by sandbox subprocess/network behavior; escalated pnpm resolved locked version 9.15.9. Frozen-lockfile dependency repair underway; no new dependencies requested.
- Supabase connector read query was denied by connector permissions; no SQL executed through it. Alternative local read-only connection remains to verify.
- Ruling: payroll provider integrations currently send invoices, not payroll. Implement separate payroll workflow and verify provider capability rather than rename invoice export. Full provider behavior remains unverified.

## Verification constraints

Do not run the existing reset-based API test wrapper against shared databases.
Inspect test tooling and use isolated disposable infrastructure or mocked route tests.
Do not print environment secrets. Live changes must be additive or narrowly scoped,
idempotent, and read back. No database wipe, restore, reseed, or credential rotation.

## Current implementation evidence

These are local implementation results, not production completion. The checklist
above remains open where a required migration, live verification or provider
integration has not been completed.

- Dependencies restored with the existing lockfile; no new application dependency.
- Company isolation: 35 mocked route tests passed. Independent review follow-ups
  for internal vendor notes, designated contacts and employee-specific site access
  were fixed. Three exact-code public-site lookup tests passed; anonymous site
  directory enumeration is removed. Partner day-track isolation passed with the
  existing locations suite (44 tests).
- Partner catalogs: 21 focused API tests and 11 locale tests passed. Four review
  findings were fixed: AskV scope, single-price updates, migration resurrection,
  and approval readiness. The disposable-Postgres migration test remains skipped.
- Mapbox public-token provider check returned a valid map style. Real map tiles
  rendered in desktop/mobile browser checks with mocked company data. The local
  map/voice regression suite passed seven tests including selected-ticket mileage,
  invalid/future GPS times, microphone cleanup and duplicate tool events.
- Full web tests previously passed 745 tests; the assistant suite was rerun with
  its required test session configuration and passed 68 tests with three skips.
  Combined-tree reruns are required after the Gate Log handoff.
- Subsequent full web run: 118 files passed, 825 tests passed / three skipped.
  Shared-library suites: 45 tests passed. Full mobile suite initially had one
  timing failure; isolated rerun passed and the complete suite with two workers
  passed all 571 tests without changing mobile code.
- Workspace typecheck and local production web build passed. Locale parity passed
  across web/mobile. Final incremental Gate category changes require rechecking.
- Actual browser-generated Gate reports were extracted and rendered for review:
  both desktop and mobile versions contain all 120 unique test entries across
  seven pages, including the last entry. Fixtures are synthetic, not live records.
- Payroll: 20 focused API tests and one UI test passed. Independent review cleared
  the reversed-interval and CSV formula fixes. This is a transient gross-pay draft
  with explicit wages and overtime policy, not finished payroll processing. It
  does not calculate net taxes/deductions, persist approved payroll runs or send
  payroll to accounting providers. See payroll-draft.md.
- Gate Log unified reporting combines authorized visitor and employee check-in
  sources. Staff can explicitly capture visitor/routine work/partner admin/vendor
  admin categories through a new nullable field; guest self-assertion is rejected.
  Historical NULL categories are preserved as unclassified. The category migration
  is prepared but has not run. See list-one-gate-report.md.
- Tax/accounting UI controls default hidden; payroll remains available. Scheduled
  1099 emails also require ENABLE_TAX_REPORTING=true. See list-one-release-features.md.

## Release blockers and required follow-through

1. No DATABASE_URL, disposable TEST_DATABASE_URL, Supabase management token or
   configured VPS login is available in this session. REST read access cannot
   apply the SQL migrations. Apply and verify vendor-note ownership, visit entry
   category and partner catalog initialization before deploying these
   schema-dependent routes.
2. Read-only live check: MidCon Solutions has no tax ID, COI document or current
   insurance date on record. Warwick is pending_review; Flywheel has no relationship
   row. Do not fabricate compliance or acceptance to mark these approved. Complete
   prerequisite records or obtain an explicit business override decision.
3. QuickBooks payroll/time transfer needs verified employee/compensation mappings,
   applicable provider access and sandbox evidence. OpenAccountant's configured
   payroll contract has not been verified. Neither invoice connector is a payroll
   implementation; both payroll transfer controls remain unavailable.
4. No commit, push, deploy, mobile release, live migration or credential change has
   been performed. The local browser preview uses fixtures, not a live API login.

## Final local verification

- Whole workspace typecheck: passed.
- Full web suite: 119 files, 826 passed / three skipped.
- Full mobile suite: 83 files, 571 passed with two workers after an initial
  concurrency-sensitive timeout; no mobile source changes were needed.
- Shared libraries: 45 tests passed.
- Changed API areas: 265 mocked tests passed across the combined run and affected
  rerun. The one PostgreSQL schema contract was explicitly excluded. Its guard
  was not bypassed, and no database reset wrapper was run.
- Production web build: passed. Existing source-map warnings remain nonfatal.
- Desktop/mobile browser checks: actual public map tiles, employee selection,
  partner catalog filtering, Warwick-only price save retaining Flywheel rates,
  no map horizontal overflow or uncaught browser errors.
- Gate report PDFs: all 120 synthetic entries present over seven pages at both
  viewport sizes; first/last page rendering inspected. Evidence is under
  artifacts/list-one-verification, not a live data export.
- Independent review: all reported high-priority findings closed, including
  visitor detail role fallthrough, cached report authorization and SQL arrays.
- Full root test/API/E2E gates are NOT claimed: their existing reset-based wrappers
  require an approved disposable database that is not available in this session.
- Local frontend preview: http://127.0.0.1:5181/ (no configured live API here).
