# Ask V Gate Fast Check-In Full Ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a compact, branded Gate experience on web and iOS plus permission-safe Ask V history search and candidate resolution that prefills—but never submits—the Gate form.

**Architecture:** Extend the existing Gate tool pack and natural-voice handlers so all reads reuse the authenticated visit API and all writes remain on the current confirmed check-in/check-out endpoints. Reuse the approved shared field styles on web, mirror the compact controls in React Native, and enforce the gate-worker navigation order and cross-platform tool coverage with focused tests.

**Tech Stack:** TypeScript 5.9, React 19, React Native/Expo, Express 5, Drizzle ORM, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-18-askv-gate-fast-checkin-toolbox-coverage-design.md`

## Global Constraints

- The signed-in gatekeeper always performs the final check-in or check-out.
- All history remains scoped by the current authenticated visit endpoint and assigned-site rules.
- No destructive database action or historical rewrite.
- Web and iOS use the same server-defined permissions, confirmation class, and audit path.
- Full ship includes main, web, API, Supabase only if an additive migration exists, iOS OTA, and TestFlight.

---

### Task 1: Compact branded Gate controls and navigation

**Files:**
- Modify: `artifacts/vndrly/src/pages/gatekeeper.tsx`
- Modify: `artifacts/vndrly/src/components/plate-state-picker.tsx`
- Modify: `artifacts/vndrly/src/components/gate-portal-layout.tsx`
- Test: `artifacts/vndrly/src/pages/gatekeeper.test.tsx`
- Test: `artifacts/vndrly/src/components/plate-state-picker.test.tsx`
- Test: `artifacts/vndrly/src/components/gate-portal-layout.test.tsx`

**Interfaces:** Consumes `WORK_HUB_BRANDED_FIELD_CLASS`; produces compact branded text fields, dropdowns, tall-field exceptions, and Gate/History/Work Hub ordering.

- [ ] Write focused failing tests for height, shape, dropdown states, and tab order.
- [ ] Run the three focused test files and confirm the styling/order failures.
- [ ] Apply the shared compact field class, branded menu state classes, 36px action heights, and navigation order.
- [ ] Re-run the focused tests and typecheck.

### Task 2: Authorized Gate history and candidate resolver tools

**Files:**
- Modify: `artifacts/api-server/src/assistant/tools.ts`
- Modify: `artifacts/api-server/src/assistant/tool-names.ts`
- Modify: `artifacts/api-server/src/assistant/tool-packs.ts`
- Modify: `artifacts/api-server/src/assistant/tool-registry.ts`
- Modify: `artifacts/api-server/src/assistant/natural-voice-write-tools.ts`
- Modify: `artifacts/api-server/src/assistant/write-tools.ts`
- Test: `artifacts/api-server/src/assistant/natural-voice-write-tools.test.ts`
- Test: `artifacts/api-server/src/assistant/tool-packs.test.ts`
- Test: `artifacts/api-server/src/assistant/tool-registry.test.ts`

**Interfaces:** Produces `search_gate_history` and `resolve_gate_check_in`; both are read-only, Gate-screen tools. Resolution returns candidates, confidence, draft, provenance, and at most one clarification.

- [ ] Add failing contracts for exact state-plus-plate, unique plate state inference, explicit-driver precedence, ambiguous plate states, name/company matches, and unrelated-site privacy.
- [ ] Confirm the new tool-name and handler tests fail.
- [ ] Implement bounded history filtering over the authenticated visit API and deterministic candidate scoring.
- [ ] Register both tools as read-only Gate-screen tools and route them through `runWriteTool`.
- [ ] Re-run the focused API tests and API typecheck.

### Task 3: Gate client intent and toolbox coverage

**Files:**
- Modify: `artifacts/api-server/src/assistant/client-tools.ts`
- Create: `artifacts/api-server/src/assistant/page-tool-coverage.ts`
- Create: `artifacts/api-server/src/assistant/page-tool-coverage.test.ts`
- Test: `artifacts/api-server/src/assistant/client-tools.test.ts`

**Interfaces:** Consumes resolver `draft` and provenance; produces `prefill_gate_visit` for web/iOS clients and a checked manifest for Gate plus the audited Calendar, Groups, Company Chat, and Employees actions.

- [ ] Add failing client-intent and coverage-manifest tests.
- [ ] Implement the Gate prefill payload and coverage metadata with role, confirmation, platform, and focused-test fields.
- [ ] Enforce that mutating entries require confirmation and web/iOS authority parity.
- [ ] Re-run focused assistant tests.

### Task 4: iOS Gate parity

**Files:**
- Modify: `artifacts/vndrly-mobile/app/visitor-checkin.tsx`
- Modify: `artifacts/vndrly-mobile/components/VisitorHostPicker.tsx`
- Modify: `artifacts/vndrly-mobile/lib/gatekeeper.ts`
- Test: `artifacts/vndrly-mobile/components/VisitorHostPicker.test.tsx`
- Test: `artifacts/vndrly-mobile/lib/gatekeeper.test.ts`

**Interfaces:** Consumes existing Gate endpoints and the same resolver responses; produces compact 36px evidence/duration actions, rounded branded single-line inputs, rounded branded tall fields, and unchanged OCR/manual/voice paths.

- [ ] Add failing tests for compact actions, branded fields, and resolver/history client calls.
- [ ] Implement the minimal React Native styling and typed client functions.
- [ ] Verify mobile tests, locale parity, and mobile typecheck.

### Task 5: Full verification and release

**Files:** Exact release tree only; do not add generated `static-build` output or local agent configuration.

- [ ] Run focused Gate, Ask V, Work Hub, Employees, web, API, and mobile tests.
- [ ] Run `pnpm lint:i18n`, `pnpm run typecheck`, and the mandatory full test chain.
- [ ] Run production web/API/mobile build checks required by the release workflows.
- [ ] Commit the exact release tree, push non-force, and advance `main`.
- [ ] Monitor Publish, API Deploy, iOS OTA, and TestFlight concurrently; dispatch API if path filters miss it.
- [ ] Verify the public Gate page, API health, Expo update group, and TestFlight submission.
