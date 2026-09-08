# List One: combined Gate Log report

## Implemented

- `GET /api/gate-report` and AskV `query_gate_report` share
  `artifacts/api-server/src/lib/gate-report.ts`.
- A single database statement combines `site_visits` visitor records with
  `ticket_check_ins` employee time records. Record IDs include their source to
  avoid collisions. Both branches authorize before combining: platform admins
  see all; partners see only their owned sites; vendors see their hosted visitors
  and own workforce. Missing office/company scope fails closed.
- Site, partner, company substring, purpose substring, record source, activity
  category, and timezone-qualified date filters are server-side. Intervals use
  half-open overlap: entry before the exclusive end and departure after the
  start (or no departure). Earlier arrivals that overlap the period are included.
- Visitor-only reporting is independent of historical role classification.
  Employee check-ins represent routine vendor work. Visitor categories use only
  explicitly recorded `entry_category`; legacy NULL values remain unclassified
  and purpose is preserved verbatim. Current memberships and free text are never
  used to invent partner/vendor admin history.
- Totals cover the entire filtered snapshot: entries, visitor entries, employee
  check-ins, on-site entries at generation, unique recorded identities,
  unidentified entries, incomplete entries, and pending admissions. Pending
  admission is not on site. Identity counts use employee IDs and guest session
  IDs, so they are explicitly not a deduplicated count of physical people.
- Snapshot pages are immutable and bound to user, role, active organization,
  membership, and session version. Current account suspension/session version
  and office membership are checked on each request. Continuation also checks
  current site ownership, visitor host, and employee/ticket company ownership
  for every cached source record. Access changes invalidate the snapshot rather
  than returning stale cached records or totals.
- Snapshots expire after ten minutes. Each owner can retain two snapshots;
  replacing an owner's older snapshot cannot evict another user's snapshot.
  Global capacity is 32 snapshots / 32 MiB of serialized row payload, with an
  explicit busy error when full. Expired entries are removed on requests.
- API pages contain at most 250 rows. The web loader collects and verifies all
  pages, totals, unique record IDs, and snapshot consistency before displaying
  the completed report or enabling Print. On-screen pages show 50 rows.
- Default range is seven days, maximum 31 days. Reports larger than 25,000
  filtered records return an explicit 413 requiring narrower filters; there is
  no silent 2,000-row cap or partial report presented as complete.
- Gate Log Reports now uses the combined report component. Filters submit
  explicitly, without 30-second report polling. Legacy visitor browsing also
  defaults to a bounded date range and no longer polls complete history.
- Print uses a separate document containing all rows, filters, generation time,
  totals, and coverage notes. Fixed-height application ancestors cannot clip it.
  Pagination controls are omitted, table headers repeat, and entrant text is
  escaped by cloning rendered DOM rather than interpolating raw visitor HTML.
- Added 49 matching English/Spanish report locale keys. Existing Operations,
  navigation, public-site lookup, and GateOps changes were preserved.

## Verification

- API: 2 focused files, **58 tests passed**, combining Gate Log report tests and
  all prior company-isolation scenarios. Includes tenant SQL predicates,
  half-open bounds, 3,001-row totals/paging, cache expiry/capacity, cross-user
  isolation, revoked membership and record access, and unknown classifications.
- Web: 4 focused files, **8 tests passed**, covering explicit submit/source
  selection, complete pagination, duplicate/incomplete result rejection, 120-row
  standalone print document, escaping, and existing Gate Log rendering.
- API and web typechecks passed before the final cache/print refinements; final
  whole-tree typecheck is being rerun by the root task after handoff.
- English/Spanish report locale keys match (48 each).
- These tests used mocked databases/APIs with local environment loading disabled.
  No reset wrapper, live database connection, migration, or deployment was run.
- Root task is performing the browser/120-row multipage PDF verification. The
  unit print test verifies the document structure; it is not a browser PDF claim.

## Structured category capture and final checks

- Added nullable `site_visits.entry_category` with a guarded `ADD COLUMN IF NOT
  EXISTS` SQL file and `migrate:visit-entry-category` runner. No migration was
  executed locally; deployment must run this before serving the new projections.
- Authenticated gate check-in and the office visit-detail editor can explicitly
  record visitor, routine vendor work, partner admin, or vendor admin, or leave
  the classification unknown. Guests cannot self-assert a category. Partner
  edits require an owned site; vendor office edits require their hosted visit;
  gatekeeper edits require an assigned site. Ownership is checked atomically in
  the update predicate. Field employees and other unsupported roles are denied.
- GET visit detail now explicitly denies unsupported roles before reading data,
  closing the field-employee fallthrough found in independent review.
- Snapshot authorization arrays bind using `sql.param`; a PgDialect regression
  verifies populated and empty arrays are single parameters, not tuple casts.
- Final focused API run: `visitEntryCategory.test.ts` and `gate-report.test.ts`,
  **41 tests passed**. Covers enum/legacy behavior, guest/admin assertions,
  company/site mutation predicates, arbitrary field-employee detail denial,
  stored-category filtering, and snapshot SQL array compilation.
- Final focused web run: `gatekeeper.test.tsx`,
  `visit-detail.plate-display.test.tsx`, and `gate-report.test.tsx`,
  **12 tests passed**. Gate form submits the explicit category and the office
  editor saves it. Plate-state tests now scope options to their own listbox.
- DB declaration build, API and web typechecks, locale parity (49 report keys
  each), and migration-runner syntax check passed.
  Root's browser verification confirmed all 120 print fixture rows across seven
  PDF pages, including the final row. No live database operation was performed.

Historical categories are intentionally not backfilled. Empty admin-category
results do not prove no administrator visited. Security screening, clearance,
and threat assessments are not inferred from ordinary gate logs.

This work makes the available visitor/employee records reportable together. It
does not manufacture missing role history or security evidence.
