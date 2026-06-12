# VNDRLY Field Operations Management

## Overview
VNDRLY is a full-stack web application designed to streamline oil & gas field operations by facilitating interactions and workflows among Partners, Vendors, Field Employees, and VNDRLY Admins. The system enables Partners to manage drilling Site Locations, Vendors to assign Field Employees, and Field Employees to track work via QR code-initiated Tickets with GPS monitoring. Its core purpose is to enhance efficiency, transparency, and accountability in field operations, providing a comprehensive solution for managing complex logistics and personnel across multiple stakeholders, ultimately driving better business outcomes and market penetration in the oil & gas sector.

## User Preferences
I prefer clear, concise explanations and an iterative development approach. Please ask before making any major architectural changes or introducing new external dependencies. I value well-documented code and a focus on maintainability.

### HARD RULE — NEVER TAKE ACTION WHEN ASKED A QUESTION
A question is not a request for action. The agent must NEVER infer intent
from a question and act on it — only answer it. The agent will follow
explicit commands only. If the user asks "do you see X", "is Y the
case", "can you fix Z" — answer the question. Do not edit files, do not
run commands, do not normalize, do not "fix". Wait for an explicit
imperative instruction before taking any action.

### HARD RULE — NEVER ROTATE DEMO CREDENTIALS
The canonical demo passwords (admin/baker/winchester/mach/exxon/joe.boggs) are
fixed by the user across **every environment and every restore**. They live in
**`docs/canonical-credentials.md`** and must be re-applied verbatim after any
DB restore, seed, or sync — never regenerated, never randomized, never
"strengthened." Match users by `LOWER(COALESCE(email, username))`, not by id.
If a login is failing the diagnosis is "the hash drifted," not "the password
is wrong."

### HARD RULE — NEVER WIPE THE DATABASE (no exceptions without explicit user instruction)
Under no circumstances may the agent destroy, blank, truncate, drop, or reset the user's database — dev or prod — unless the user explicitly and unambiguously instructs it in that same message. This rule overrides every other protocol, doctrine, recovery script, or "fix" instinct, including the `sabotage1` recovery sequence.

Forbidden without explicit per-incident user approval:
- `DROP SCHEMA … CASCADE`, `DROP DATABASE`, `DROP TABLE`, `TRUNCATE`
- `drizzle-kit push --force` against any DB containing real data (the non-`--force` push is also forbidden if it would drop columns/tables containing data)
- `db:reset`, `db:wipe`, restoring from an old backup that overwrites current rows
- Re-seeding scripts that delete-then-insert against a non-empty table
- Any `DELETE FROM <table>` without a narrow `WHERE` clause
- Replaying a `pg_dump` against the existing DB
- "Recreating" the schema from scratch as a debugging step

Required behavior when the agent thinks the DB is broken:
1. STOP. Do not run any destructive command.
2. Read-only diagnose first (counts, schema diffs, FK violations, sample rows).
3. Report findings to the user with the exact command(s) being proposed and wait for an explicit "yes, do it" before running anything destructive.
4. Prefer surgical, additive fixes (insert missing rows, add missing columns/indexes) over any reset.
5. If migrations would be destructive, surface that to the user instead of proceeding.

If the agent is ever uncertain whether an operation is destructive, treat it as destructive and ask first.

### Agent doctrines (sabotage1, sabotage2, sabotage3, vdark, vlight)
Long-form agent operating doctrines live in **`docs/agent-doctrines.md`** —
read it before invoking any of the named commands or visual presets:

- **`sabotage1`** — DB-screw-up recovery protocol. Examine first, surgical
  fixes only, the HARD RULE above still overrides every step.
- **`sabotage2`** — "you lied to me" protocol. Stop, admit, re-verify
  against the actual user-facing surface, never collapse "schema restored"
  into "data restored."
- **`sabotage3`** — "you wiped/desynced dev again, restore from prod and
  stop reseeding." Wholesale dev↔prod restore via toposorted
  `jsonb_populate_recordset` import (validated 2026-05-11). Reseeding is
  forbidden as the fix; canonical passwords from
  `docs/canonical-credentials.md` are re-applied by email/username, not id.
- **`vdark`** preset — vendor sign-in dark visual treatment. Canonical
  page is `artifacts/vndrly/src/pages/login.tsx`; full spec in
  `docs/ui-presets.md`. Pill assets via `pickPillForBrand(brand.primary)`,
  never hand-pick a PNG.
- **`vlight`** preset — snapshot of the user's last-approved vendor login
  (commit `a5ea8f4f`). Restore by `cp`'ing from
  `snapshots/vlight-vendor-login/`. Scoped to the vendor login only.

## System Architecture

### Core Technologies
The application is a pnpm monorepo using Node.js 24 and TypeScript 5.9. The frontend uses React 19 with Vite, and the API is built with Express 5. Data persistence is managed by PostgreSQL with Drizzle ORM, and Zod is used for validation. UI components are built with shadcn/ui and Tailwind CSS, with Wouter handling routing. API client code is generated by Orval from an OpenAPI spec.

### Database Schema
The database schema supports comprehensive management of users, organizations (Partners, Vendors), site locations, work assignments, detailed ticket tracking with GPS logs, financial line items, and a Hotlist marketplace for job bidding.

### Authentication
The system uses cookie-based session authentication with distinct portals and access levels for `admin`, `partner`, `vendor`, and `field_employee` roles. Users can hold multiple organizational memberships, switching their active context post-login. Passwords are hashed with bcryptjs.

### Ticket Management and Workflow
Tickets use **two axes** that must stay coherent:

- **`status`** — office/accounting workflow: `awaiting_acceptance` → `initiated` → `in_progress` → `pending_review` → `submitted` → `approved` / `awaiting_payment` → `funds_dispersed`, with `kicked_back`, `denied`, and `cancelled` branches.
- **`lifecycleState`** — field GPS phase: `pending_arrival` → `en_route` → `on_location` → `on_site` → `off_site`.

Rule of thumb: `in_progress` (on the clock) must pair with `on_site`; terminal office statuses pair with `off_site`. Live crew map and mobile location pings track `en_route`, `on_location`, and `on_site` (see `@workspace/ticket-status-meta` `LIVE_TRACKED_LIFECYCLE_STATES`).

The system supports multiple tracking tickets per work type at a site, accessible via mobile and web interfaces.

### User Interface and Design
The application features an industrial oil & gas aesthetic, utilizing a deep steel blue primary color with a safety orange accent. A custom button system employs a 5-color palette (Amber, Blue, Green, Red, Lightgrey) for all status and progress indicators, each carrying specific semantic meaning throughout the UI.

#### Pill design language (TogglePill, ImagePill, brand-color buttons)
The full pill-family doctrine — `TogglePill` / `TogglePillButton` semantics
and color palette, the read-only `ImagePill` used by status / role chips,
and the `pickPillForBrand(brand.primary, shape)` brand-color → button-PNG
resolver rule — lives in **`docs/agent-doctrines.md`**. Read that doc before
adding a new chip, action button, or brand-aware button surface; do not
re-derive the gradient strings, palette hexes, or per-shape palette rules
from scratch.

Single sources of truth in code:
- `artifacts/vndrly/src/components/toggle-pill.tsx` — `<TogglePill>` /
  `<TogglePillButton>` exports + `TOGGLE_PILL_*` constants.
- `artifacts/vndrly/src/components/image-pill.tsx` — `<ImagePill>`
  read-only PNG chip (used by `StatusBadge`, `RoleBadge`, `PecStatusBadge`,
  Lead Admin chip).
- `artifacts/vndrly/src/components/baker-pill-button.tsx` —
  `pickPillForBrand` + `BRAND_PILL_PALETTE` / `BRAND_SQUARE_PALETTE`.

### Key Features
- **Role-Based Access Control:** Tailored functionalities for different user roles.
- **GPS Tracking:** Real-time GPS logging for field employees linked to ticket activities.
- **Site Management:** QR code generation for site check-ins and location resolution for inaccurate coordinates. The Add Site Location modal supports `navigator.geolocation` "Use My Current Location", two-way Nominatim geocoding (address ⇄ lat/lng), an embedded Leaflet map preview with a draggable marker and radius circle, configurable geofence radius (default 500 m), and an optional wellhead photo upload (`site_locations.photo_url`). Site codes are auto-generated server-side as `SITE-XXXXXXXX`.
- **Analytics:** Dashboards for Vendors and Partners provide performance insights using Recharts.
- **Parts & Labor Tracking:** Detailed line item tracking on tickets, including tax calculations.
- **Live Tracking Dashboards:** Crew Map (Vendor/Admin) displays field employees and routes via Server-Sent Events (SSE); Site Map (Partner/Admin) shows all field employees near a selected site location.
- **1099 Tax Reporting:** Year-end aggregation for 1099-NEC, 1099-MISC, and 1099-K, including JSON/CSV/PDF previews, IRS FIRE-formatted TXT export, and e-delivery consent tracking. AP staff can opt admin or per-partner scopes into a scheduled email of the 1099-K monthly breakout (weekly in January, monthly otherwise) via the Reports → Dashboard1099Card UI; deliveries are recorded in `report_export_audit_log` and dedupe-guarded in `dashboard_1099_email_log`.
- **AI Assistant ("Ask VNDRLY"):** A role-aware in-app assistant powered by Anthropic Claude, offering conversation management and tool-use capabilities.
- **Background Workers:** Periodic jobs handle invoice aging, period management, scheduled notifications, and QuickBooks bulk action retention cleanup.
- **Org Branding:** Supports distinct branding for Vendors, Partners, and the VNDRLY platform with configurable logos.

### API and Code Generation
An Express-based API is consumed by an Orval-generated client. Custom React Query hooks and Zod schemas are maintained separately. A typed response bridge ensures compile-time safety for API responses.

### Vendor Catalog as Source of Truth
The `vendor_work_types` table serves as the authoritative catalog for vendor services and pricing. This catalog dictates available work types for site assignments, filters Hotlist jobs for vendors, and is manageable via vendor self-service endpoints. The system enforces invariants to ensure that work types are part of a vendor's catalog for assignments and hotlist job filtering.

### Validation Gates
The project ships five mandatory validation steps that must pass before merging:
- `typecheck` — typechecks every workspace package (`pnpm run typecheck`).
- `test-web` — runs the `@workspace/vndrly` vitest suite (`pnpm run test:web`).
- `test-api` — runs the `@workspace/api-server` vitest suite against an isolated test database (`pnpm run test:api`, added in Task #774).
- `test` — runs the full root `pnpm test` chain (`test:web && test:mobile-locales && test:api && test:e2e`).
- `lint-i18n` — runs the standalone locale parity linter (`pnpm lint:i18n`, added in Task #139).

`lint-i18n` is a fast cross-artifact check that walks `en.json` / `es.json` for both `artifacts/vndrly-mobile/lib/locales` and `artifacts/vndrly/src/lib/locales`, reporting missing keys per locale, empty values, and shape mismatches. It exits non-zero on drift and runs in well under a second, so it is suitable as a pre-check before the heavier `test` gate. The implementation lives in `scripts/src/lint-i18n.ts`; the per-artifact unit tests (`parity.test.ts`, `placeholderParity.test.ts`, `noOrphanedKeys.test.ts`) still cover richer rules like placeholder consistency and orphaned-key detection inside their respective vitest suites.

`test-api` is registered as its own gate in addition to being chained inside `test` so that an unrelated `test:web` failure cannot mask an api-server regression — the api-server suite always runs on every change.

### Testing & Validation
The root `pnpm test` command runs comprehensive tests, including `vitest` suites for web (`@workspace/vndrly`) and the full mobile (`@workspace/vndrly-mobile`) suite — covering locale parity, screen-level component flows (e.g. Disperse Funds, Mark Awaiting Payment, removed-assignment banner), and rate-limit gates — the api-server vitest suite, plus a `Playwright` suite for end-to-end browser flows, ensuring locale parity and functional correctness. API server tests run against an isolated test database to prevent interference with development data.

Mobile screen tests load the bare `expo` package transitively through `expo-router`. To keep them importable under the jsdom-based vitest config (Task #653), `artifacts/vndrly-mobile/vitest.setup.ts` stubs the `expo` async-require, winter runtime, and `Expo.fx` side-effect entrypoints — otherwise their top-level `require('./setupFastRefresh')` and similar bare-CJS imports of `.ts` files crash before any test body runs. New mobile screen tests therefore do not need per-file `vi.mock("expo", ...)` boilerplate.

#### Isolated test database (api-server)
`pnpm --filter @workspace/api-server test` no longer runs against the shared dev `DATABASE_URL`. The script is wrapped by `artifacts/api-server/scripts/run-with-test-db.ts`, which:
1. Picks a test DB URL — `TEST_DATABASE_URL` if set, otherwise derives `<dev-db>_test` on the same Postgres server as `DATABASE_URL`.
2. Creates that DB on the maintenance `postgres` server if it doesn't exist yet, then `DROP SCHEMA public CASCADE; CREATE SCHEMA public` to start fresh.
3. Pushes the current `@workspace/db` schema into it via drizzle-kit's `pushSchema(...).apply()` (same surface used by `check-schema`).
4. Spawns the inner `pnpm --filter @workspace/db run check-schema && vitest run` with `DATABASE_URL` rewritten to the isolated test DB so neither the drift gate nor the integration suites can touch dev data, and so a fresh checkout always passes the drift check (the dev DB historically had duplicate vendor rows blocking `vendors_canonical_name_unique`). Use `pnpm --filter @workspace/api-server run test:no-isolated-db` to bypass the wrapper and run against whatever `DATABASE_URL` is set if you need to debug a real-data issue.

### Notifications & Email
Outbound email (password resets, invoice delivery, digests) is not enabled yet; in-app notifications still work. When paid-tier email is added, call sites in `artifacts/api-server/src/lib/sendgrid.ts` are stubbed and ready to wire to a provider.

### Accounting Connections
Vendors connect QuickBooks Online and OpenAccountant from the Reports page. OpenAccountant ships with both an OAuth2 default flow (`GET /api/accounting/oa/connect` + `/callback`) and a long-lived API-key fallback (`POST /api/accounting/oa/connect-api-key`). Admin setup for the OAuth path — required env vars (`OPENACCOUNTANT_CLIENT_ID`, `OPENACCOUNTANT_CLIENT_SECRET`, `OPENACCOUNTANT_REDIRECT_URI`, plus optional `OPENACCOUNTANT_OAUTH_BASE_URL` / `OPENACCOUNTANT_OAUTH_SCOPE`), how to register the OA OAuth client, and the API-key fallback are documented in `docs/accounting-oauth.md`.

## External Dependencies
- **PostgreSQL (Supabase):** Primary relational database — project `bihjmgbdzbhcnsuhzzwo`, us-west-2. Local `.env.local` and production `.env.production` both point at the same Supabase instance. See **`docs/database.md`**.
- **Drizzle ORM:** TypeScript ORM.
- **Zod:** Schema validation library.
- **Orval:** OpenAPI client code generator.
- **Recharts:** React charting library.
- **shadcn/ui:** UI component library.
- **Tailwind CSS:** Utility-first CSS framework.
- **Vite:** Frontend build tool.
- **React:** Frontend JavaScript library.
- **Express:** Node.js web application framework.
- **Wouter:** React routing library.
- **bcryptjs:** Password hashing library.
- **Anthropic Claude:** AI model.
