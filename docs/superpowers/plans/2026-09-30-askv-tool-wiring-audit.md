# Ask V Tool Wiring Audit Implementation Plan

> **For Codex:** Execute this plan continuously with the executing-plans workflow. Use failing regression tests before each production correction and finish with the repository validation gates.

**Goal:** Ensure every Ask V capability that is exposed to web or iOS is discoverable in the correct context, safely executable, visibly rendered, and able to open its authorized destination without any known unwired paths.

**Architecture:** Treat the server registry as the capability source of truth. Add parity contracts from registry to execution runtime, from client-intent emission to both client handlers, and from deep-link generation to native/web destinations. Correct native context propagation so the dedicated Ask V screen receives the complete role-safe toolbox. Add a native visual-result companion for structured or long results while retaining the conversation.

**Tech Stack:** TypeScript, Express, React 19, Expo Router/React Native, Vitest.

**Completion:** All seven implementation tasks are complete. Focused Ask V suites, full web/mobile suites, locale parity, and the root typecheck pass on the final tree. The destructive isolated-API wrapper and complete root chain were not run because repository policy forbids its schema-drop setup without per-incident approval; all 42 non-destructive Assistant server suites ran directly and passed. Physical iOS/push checks remain release acceptance gates.

---

### Task 1: Native Ask V toolbox context

**Files:**
- Modify: `artifacts/vndrly-mobile/hooks/use-assistant.ts`
- Modify: `artifacts/vndrly-mobile/hooks/use-askv-voice-session.tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/askv.tsx`
- Test: `artifacts/vndrly-mobile/lib/__tests__/askv-native-runtime.test.ts`
- Test: `artifacts/api-server/src/assistant/tool-packs.test.ts`

1. Add failing tests proving typed and voice requests from either native Ask V route use a mobile-qualified `/work-hub/askv` context.
2. Add one shared native context-path normalizer and pass the current route into typed and voice calls.
3. Verify the dedicated path receives all role-safe Work Hub and Implementation A tools while ordinary pages remain page-scoped.

### Task 2: Client-intent execution parity

**Files:**
- Modify: `artifacts/api-server/src/assistant/client-tools.ts`
- Modify: `artifacts/vndrly/src/lib/askv-client-intents.ts`
- Modify: `artifacts/vndrly-mobile/lib/askv-client-tools.ts`
- Test: `artifacts/api-server/src/assistant/client-tools.test.ts`
- Test: `artifacts/vndrly/src/lib/askv-client-intents.test.ts`
- Test: `artifacts/vndrly-mobile/lib/__tests__/askv-client-tools.test.ts`

1. Export an explicit supported-client-intent catalog.
2. Add a parity test requiring every server-emitted intent to have both a web and native handler, including Gate prefill handoffs.
3. Add negative tests proving unknown intents fail visibly instead of being reported as completed.

### Task 3: Server registry-to-runtime coverage

**Files:**
- Modify: `artifacts/api-server/src/assistant/work-hub-toolbox.test.ts`
- Modify: `artifacts/api-server/src/assistant/work-hub-tool-runtime.test.ts`
- Modify if a gap is found: `artifacts/api-server/src/assistant/work-hub-tool-runtime.ts`

1. Enumerate every registered typed Work Hub and capability tool.
2. Require every advertised tool to resolve to an executable request or an intentional, explicit unsupported result for invalid input.
3. Correct any missing resolver, confirmation, audit-target, or role-pack wiring uncovered by the contract.

### Task 4: Deep-link and destination parity

**Files:**
- Modify: `artifacts/api-server/src/assistant/deep-links.ts`
- Modify: `artifacts/vndrly-mobile/lib/assistant-deep-links.ts`
- Modify: `lib/api-client-react/src/work-hub-destinations.ts`
- Test: corresponding deep-link and navigation tests

1. Enumerate every server-approved screen and exact Work Hub record type.
2. Require each to resolve on web and to either a native destination or an explicit authorized browser handoff on iOS.
3. Reauthorize exact records before opening and preserve search/date/type filters.

### Task 5: Native visual results

**Files:**
- Modify: `artifacts/vndrly-mobile/app/(tabs)/askv.tsx`
- Add or modify test: `artifacts/vndrly-mobile/app/__tests__/askv-composer.test.tsx`

1. Add failing coverage for long, tabular, agenda, meeting-note, and employee-detail responses.
2. Add a branded visual-results action/surface that opens the complete result without replacing or discarding the live conversation.
3. Keep links actionable through the existing authorized assistant-link path.

### Task 6: Confirmation, mutation refresh, and notification audit

**Files:**
- Modify only where tests demonstrate a gap in `artifacts/api-server/src/routes/assistant.ts`, `artifacts/api-server/src/routes/assistantRealtime.ts`, or the relevant Work Hub domain endpoint
- Test: typed/realtime confirmation, mutation, device-event, and notification suites

1. Verify every registered mutation requires the configured confirmation and retains idempotency/audit boundaries.
2. Verify successful typed and voice writes emit refresh/device events; denied, pending, failed, and read-only calls do not.
3. Verify calendar/shift/meeting/task writes use the domain notification path and remain tenant scoped.

### Task 7: Final validation and documentation

**Files:**
- Modify: `docs/ios-askv-parity-backlog.md`
- Modify: `docs/askv-work-hub-capability-matrix.md`

1. Run focused suites after each correction.
2. Run `pnpm lint:i18n`, `pnpm run typecheck`, `pnpm run test:web`, `pnpm run test:api`, and the complete root `pnpm test` once on the unchanged final tree.
3. Record the completed parity matrix and any environment-only physical-device acceptance item without describing it as a code loose end.
