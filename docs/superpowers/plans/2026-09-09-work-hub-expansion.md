# Work Hub Expansion Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for independent implementation tasks and review each result before integration.

**Goal:** Implement and ship the agreed Work Hub expansion, preserving existing data and clearly distinguishing external setup from completed transactions.
**Architecture:** Extend the existing Express/Drizzle Work Hub domain, existing authorization and command idempotency. Keep domain components separate and reuse current working modules rather than replacing them with mock data.
**Tech Stack:** TypeScript, React/Vite, Express, PostgreSQL/Drizzle, Expo, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-09-09-work-hub-expansion.md

## Global constraints
No screenshot data, database resets, credential changes, fake success responses, force pushes or blanket staging. Preserve pre-existing local artifacts. Validate tenant membership and role on every server request. Financial actions awaiting external execution are unavailable and visibly explained. Web is the full-suite surface.

## Task 1: Collaboration domain and interfaces
- [ ] Extend `artifacts/api-server/src/routes/workHubChannels.ts` and domain helpers with persistent collaboration Crews, channel classification, invitations, preferences and activity/chat views.
- [ ] Implement additive schema/migrations in dedicated files, exports and migration registration; distinguish collaboration from field crews.
- [ ] Exercise unauthorized/foreign tenant access, accepted-invitation rules, ownership controls, idempotency and existing channel regression tests.
- [ ] Publish exact endpoint contracts to the interface implementer; no client-supplied role authority.

## Task 2: Billing/payroll domain and screens
- [ ] Create focused finance policy/calculation helpers and tests for 50 basis points, partial payments, fee cap, proportional refunds and zero-fee outside payments.
- [ ] Add scoped persistent finance records, role grants, invoice and payroll drafts, status transitions and audit, preserving existing invoice authority.
- [ ] Create `artifacts/vndrly/src/components/work-hub/finance.tsx` with `WorkHubFinance` and `WorkHubAdministration` exports; enforce server authorization independently of UI.
- [ ] Implement printable/exportable real records and provider readiness; do not synthesize tax/net-pay/payment results.
- [ ] Test role assignment, no implicit admin payroll access, duplicate payment prevention and web-only financial actions.

## Task 3: Workspace interface
- [ ] Extend `artifacts/vndrly/src/lib/work-hub-nav.ts`, `components/layout.tsx` and `pages/work-hub.tsx` using existing flat icons and brand components.
- [ ] Build focused collaboration panes, activity/chat, calendar views, Calls/Meetings, Files/Notes, AskV voice, Import & Export; retain existing working mutations and add honest error/empty/loading states.
- [ ] Add user-specific pin/order preferences and More, keyboard/accessibility behavior, responsive phone/tablet navigation without full payroll/payment actions.
- [ ] Test navigation, drafts, deep links, calendar and permission-dependent controls.

## Task 4: Integration and verification
- [ ] Review task patches together; reconcile schema/API/UI contracts and protect private file and financial access.
- [ ] Run required verification for exact tree; inspect real browser surfaces at desktop and narrow widths using fictional fixtures only.
- [ ] Repair failures and record pass/fail evidence; inspect missing scope against every specification section.

## Task 5: Full ship
- [ ] Recheck remote parent, commit only scoped changes, publish branch/main non-force via GitHub integration.
- [ ] Monitor web, API/migrations, OTA and exact native TestFlight build/submission; inspect failed job logs and retry safe fixes.
- [ ] Verify public web/API, authenticated Work Hub, Expo update and exact TestFlight submission; report external setup limitations explicitly.

## Execution ledger
Initial baseline: main `931b7e5f`; pre-existing deleted shortcut and untracked `artifacts/list-one-verification/` retained. User has approved implementation, architectural changes, dependencies and full ship unattended. No renewed approval needed for this scope.
