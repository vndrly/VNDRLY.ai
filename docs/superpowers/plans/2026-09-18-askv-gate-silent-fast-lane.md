# Ask V Gate Silent Fast Lane Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a silent, deterministic Ask V Gate draft workflow with GPS-locked location, scoped historical backfill, server-derived host, and complete web/iOS parity.

**Architecture:** The API owns authorization, history lookup, location context, and host derivation. Ask V prepares client intents only. Web and iOS apply the same intent and suppress the follow-up model response after a successful Gate prefill. The gatekeeper always submits.

**Tech Stack:** TypeScript, Express, Drizzle, React, Expo React Native, Vitest.

---

### Task 1: Lock the Gate assistant contract

**Files:**
- Modify: `artifacts/api-server/src/routes/assistantRealtime.ts`
- Modify: `artifacts/api-server/src/assistant/tool-packs.ts`
- Modify: `artifacts/api-server/src/assistant/prompts/system.ts`
- Test: corresponding assistant prompt, realtime, and tool-pack tests

Write failing tests proving Gate setup receives the current path, mandates immediate tool use and silence on success, and excludes Gate submission tools. Implement the smallest changes and rerun the focused tests.

### Task 2: Add bounded Gate history resolution and server-derived host

**Files:**
- Modify: `artifacts/api-server/src/routes/visits.ts`
- Modify: `artifacts/api-server/src/assistant/natural-voice-write-tools.ts`
- Test: `artifacts/api-server/src/routes/visits.test.ts`
- Test: `artifacts/api-server/src/assistant/natural-voice-write-tools.test.ts`

Write failing tests for exact state-plus-plate lookup, assigned-site scope, newest submitted visit, new-visitor success, no Host requirement, and partner host derivation. Implement a bounded resolver and normalize Gate check-in host from the selected site's partner.

### Task 3: Make successful Gate prefill silent

**Files:**
- Modify: `artifacts/vndrly/src/lib/askv-realtime-client.ts`
- Modify: `artifacts/vndrly/src/hooks/use-askv-realtime.ts`
- Modify: `artifacts/vndrly-mobile/lib/askv-realtime-client.ts`
- Modify: mobile Ask V voice hook/tool bridge
- Test: web and mobile realtime-client tests

Write failing tests proving successful silent tool outputs send `function_call_output` but not `response.create`, while errors still request a response. Add the shared response-mode marker and restore the listening state without speech.

### Task 4: Expand Gate draft intents and provenance

**Files:**
- Modify: `artifacts/vndrly/src/lib/askv-client-intents.ts`
- Modify: `artifacts/vndrly-mobile/lib/askv-client-tools.ts`
- Modify: Gate context/types and focused tests

Write failing tests for site/rig context, editable historical suggestions, and check-out selection. Preserve provenance and mark successful Gate prefills silent.

### Task 5: Normalize web Gate flow

**Files:**
- Modify: `artifacts/vndrly/src/pages/gatekeeper.tsx`
- Modify: `artifacts/vndrly/src/lib/visits-api.ts`
- Modify: `artifacts/vndrly/src/lib/gate-default-site.ts`
- Test: Gate page, voice, and site-resolution tests

Write failing tests for GPS-locked location, local-only rig options, last-valid-rig default, no Host control, and manual submit. Implement the UI and payload changes without changing the public visitor flow.

### Task 6: Normalize iOS Gate flow

**Files:**
- Modify: `artifacts/vndrly-mobile/app/(tabs)/gate.tsx`
- Modify: `artifacts/vndrly-mobile/lib/gatekeeper.ts`
- Modify: `artifacts/vndrly-mobile/lib/gate-default-site.ts`
- Test: mobile Gate and Gate library tests

Mirror the web behavior, retain plate OCR and manual editing, and verify no Host picker or user-changeable parent location remains.

### Task 7: Verify and full ship

Run focused tests, `pnpm lint:i18n`, `pnpm run typecheck`, web tests, API tests, mobile tests, and production builds. Commit only release files, push and advance `main` non-force, then monitor Publish, API Deploy, production iOS OTA, and TestFlight through success. Verify the public Gate page, API health, OTA update group, and submitted TestFlight build.
