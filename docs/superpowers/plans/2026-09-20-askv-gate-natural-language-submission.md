# Ask V Gate Natural-Language Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized Gate users complete check-in and check-out by ordinary typed or spoken commands on web and iOS, with quiet execution, one-question maximum, full Gate-tool coverage, and unchanged server-side safety boundaries.

**Architecture:** Add a narrow deterministic Gate intent classifier and bind the saved user utterance to the existing pending-confirmation and idempotent mutation path. Expose the existing confirmed Gate mutations in the page-aware realtime pack, teach both clients to attach the saved current-turn event to imperative Gate actions, and enforce web/iOS/page-tool parity with a checked-in coverage manifest.

**Tech Stack:** TypeScript 5.9, Express 5, PostgreSQL/Drizzle, React 19, Expo/React Native, OpenAI Realtime, Vitest, Playwright, pnpm, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-20-askv-gate-natural-language-submission-design.md`

## Global Constraints

- Ask V receives no elevated role and may act only with the signed-in user's current Gate authority.
- The existing `confirm_visitor_check_in` and `confirm_visitor_check_out` tools remain the sole Ask V Gate mutation path.
- Every mutation remains confirmation-required, audited, idempotent, organization-bound, context-bound, and permission-revalidated.
- Device GPS is trusted client evidence; model-supplied coordinates are never trusted.
- Preparation is silent, success is one short acknowledgment, and ambiguity produces at most one minimum question.
- Missing optional fields never trigger an interview.
- Web and iOS must expose the same server-defined authority and behavior.
- No new external dependency is introduced.
- No destructive database operation, force push, credential rotation, or public App Store release is permitted.
- Full ship includes commit, non-force main advancement, web, API and safe Supabase changes if any, iOS OTA, and TestFlight submission.

## Review Focus

- A correction containing approval words, such as "yes, but change the driver," must update the draft and must not submit stale details; Task 2 pins this to the saved-event and fingerprint gate.
- A bare "no" must cancel generally but may mean "no more details" only as the direct reply to the active Gate completion prompt; Task 1 pins the context-specific classification.
- Realtime tool generation can arrive before transcription persistence; Task 3 pins both clients to wait for and flush the current Gate command before sending its event ID.
- Repeated commands, reconnects, and cross-device retries must create one visit; Task 2 exercises the existing persistent idempotency boundary with imperative authorization.
- Same plate in multiple states or same person at multiple companies must ask one concise choice and never guess; Task 4 preserves resolver ambiguity tests and the response budget.

---

## File Map

- Create `artifacts/api-server/src/assistant/gate-intent.ts`: deterministic, context-aware classification of Gate action and submission evidence.
- Create `artifacts/api-server/src/assistant/gate-intent.test.ts`: natural-language corpus and negative/adversarial cases.
- Modify `artifacts/api-server/src/assistant/askv-voice-confirmation.ts`: read any exact saved user voice event, not only a later confirmation event.
- Modify `artifacts/api-server/src/assistant/askv-pending-confirmation.ts`: allow a bound imperative Gate command to satisfy the existing exact action without weakening other mutations.
- Modify `artifacts/api-server/src/routes/assistantRealtime.ts`: validate the current saved Gate command, bind it to the action fingerprint, and execute through the existing mutation runner.
- Modify `artifacts/api-server/src/assistant/tool-packs.ts`: expose confirmed Gate mutations only on authorized Gate surfaces/workflows.
- Modify `artifacts/api-server/src/assistant/prompts/system.ts`: replace the obsolete manual-submit rule with the concise natural-language contract.
- Modify `artifacts/api-server/src/assistant/tools.ts`: describe prepare versus submit semantics for the model without delegating authority to it.
- Modify `artifacts/vndrly/src/hooks/use-askv-realtime.ts`: persist and attach the current user event for an imperative Gate mutation and suppress redundant speech.
- Modify `artifacts/vndrly-mobile/hooks/use-askv-voice-session.tsx`: mirror the web current-turn binding and response behavior.
- Modify `artifacts/vndrly/src/lib/askv-realtime-client.ts` and `artifacts/vndrly-mobile/lib/askv-realtime-client.ts`: keep successful Gate prefill and mutation results concise or silent as specified.
- Create `artifacts/api-server/src/assistant/gate-toolbox-manifest.ts`: source-of-truth mapping from Gate page actions to tools, roles, confirmation, audit, and platform parity.
- Create `artifacts/api-server/src/assistant/gate-toolbox-manifest.test.ts`: fail on missing actions, unsafe mutations, or platform drift.
- Modify focused tests beside each server, web, and mobile file above; update locale files only if user-visible recovery copy changes.

---

### Task 1: Deterministic Gate Intent and Common-Language Corpus

**Files:**
- Create: `artifacts/api-server/src/assistant/gate-intent.ts`
- Create: `artifacts/api-server/src/assistant/gate-intent.test.ts`

**Interfaces:**
- Consumes: raw saved user utterance, pending Gate prompt kind, and target tool name.
- Produces: `classifyGateIntent(input: GateIntentInput): GateIntentDecision` and `isGateMutationTool(name: string): boolean`.

- [ ] **Step 1: Write the failing language-corpus tests**

```ts
import { describe, expect, it } from "vitest";
import { classifyGateIntent } from "./gate-intent";

describe("Ask V Gate intent", () => {
  it.each([
    "check Bob Villa in",
    "Bob Villa is coming in, same truck",
    "complete the check-in for Oklahoma ABC123",
    "go ahead and admit Sam",
  ])("treats an imperative check-in as submission evidence: %s", utterance => {
    expect(classifyGateIntent({ utterance, toolName: "confirm_visitor_check_in" }).authorization).toBe("submit");
  });

  it.each(["new check-in for Bob", "pull up Bob's entry", "start a gate entry"])
    ("prepares without submitting: %s", utterance => {
      expect(classifyGateIntent({ utterance, toolName: "confirm_visitor_check_in" }).authorization).toBe("prepare");
    });

  it("allows bare no only after the exact add-details prompt", () => {
    expect(classifyGateIntent({ utterance: "no", toolName: "confirm_visitor_check_in", pendingPrompt: "add_details_or_complete" }).authorization).toBe("submit");
    expect(classifyGateIntent({ utterance: "no", toolName: "confirm_visitor_check_in" }).authorization).toBe("cancel");
  });

  it.each(["yes, but change the driver", "if I say submit will it go?", "she said check him in"])
    ("does not authorize corrections, questions, or quoted language: %s", utterance => {
      expect(classifyGateIntent({ utterance, toolName: "confirm_visitor_check_in" }).authorization).not.toBe("submit");
    });
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `pnpm --dir . --filter @workspace/api-server exec vitest run src/assistant/gate-intent.test.ts`

Expected: FAIL because `./gate-intent` does not exist.

- [ ] **Step 3: Implement the minimal typed classifier**

```ts
export type GatePromptKind = "add_details_or_complete" | null;
export type GateAuthorization = "prepare" | "submit" | "cancel" | "clarify" | "none";
export interface GateIntentInput {
  utterance: string;
  toolName: string;
  pendingPrompt?: GatePromptKind;
}
export interface GateIntentDecision {
  action: "check_in" | "check_out" | "other";
  authorization: GateAuthorization;
  normalizedUtterance: string;
}
export function isGateMutationTool(name: string): boolean {
  return name === "confirm_visitor_check_in" || name === "confirm_visitor_check_out";
}
export function classifyGateIntent(input: GateIntentInput): GateIntentDecision {
  // Normalize punctuation and common spoken variants; reject questions,
  // quotations, mixed correction-plus-approval, and negated imperatives.
  // Use bounded phrase families plus action/entity context, never model output.
}
```

The classifier must include check-in, check-out, prepare, submit, correction,
cancel, `same vehicle`, and context-bound `no more details` variants from the
spec. Spanish confirmation already supported by `action-classifier.ts` remains
accepted where the Gate action is unambiguous.

- [ ] **Step 4: Run the corpus test and verify it passes**

Run: `pnpm --dir . --filter @workspace/api-server exec vitest run src/assistant/gate-intent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the intent unit**

```bash
git add artifacts/api-server/src/assistant/gate-intent.ts artifacts/api-server/src/assistant/gate-intent.test.ts
git commit -m "feat: classify natural Gate commands"
```

---

### Task 2: Bind Imperative Commands to the Existing Confirmation Boundary

**Files:**
- Modify: `artifacts/api-server/src/assistant/askv-voice-confirmation.ts`
- Modify: `artifacts/api-server/src/assistant/askv-voice-confirmation.test.ts`
- Modify: `artifacts/api-server/src/assistant/askv-pending-confirmation.ts`
- Modify: `artifacts/api-server/src/assistant/askv-pending-confirmation.test.ts`
- Modify: `artifacts/api-server/src/assistant/askv-pending-confirmation-typed.test.ts`
- Modify: `artifacts/api-server/src/routes/assistantRealtime.ts`
- Modify: `artifacts/api-server/src/routes/assistantRealtime.test.ts`

**Interfaces:**
- Consumes: `classifyGateIntent`, saved voice event ID, exact tool arguments, current context key, organization key, and idempotency key.
- Produces: `readBoundVoiceUtterance(...)`, same-turn Gate authorization, and the unchanged `runPersistentAskVMutation(...)` execution path.

- [ ] **Step 1: Add failing saved-event and route tests**

Add tests proving:

```ts
it("accepts a saved current-turn imperative for the exact Gate mutation", async () => {
  // Save user event "check Bob Villa in" for this voice session.
  // Call confirm_visitor_check_in with actionEventId matching that event.
  // Expect one authenticated execution and a success audit containing the phrase.
});

it("rejects fabricated, cross-session, stale, corrective, and changed-action events", async () => {
  // Each case returns requiresConfirmation or cancelled and executes zero writes.
});

it("replays the first result for a repeated imperative command", async () => {
  // Same bound action + stable idempotency identity executes the visit endpoint once.
});
```

Extend typed tests so `runBoundTypedAskVTool` accepts an unambiguous Gate
imperative in the current typed turn, while all non-Gate mutations retain the
existing later-confirmation requirement.

- [ ] **Step 2: Run the focused tests and verify they fail on the current manual-only boundary**

Run: `pnpm --dir . --filter @workspace/api-server exec vitest run src/assistant/askv-voice-confirmation.test.ts src/assistant/askv-pending-confirmation.test.ts src/assistant/askv-pending-confirmation-typed.test.ts src/routes/assistantRealtime.test.ts`

Expected: FAIL because current-turn action events are not read and Gate imperatives cannot satisfy confirmation.

- [ ] **Step 3: Generalize saved utterance lookup without trusting request text**

```ts
export async function readBoundVoiceUtterance(input: {
  conversationId: number | null;
  sessionId: string;
  eventId: unknown;
  acceptedAfter?: number | null;
}): Promise<string | null> {
  // Query the exact saved user message whose voiceSessionId and voiceEventId
  // match. Validate acceptedAt and return at most 300 characters.
}
```

Make `readVoiceConfirmation` call this function with `acceptedAfter` equal to
the pending action creation time so existing later-confirmation behavior stays
unchanged.

- [ ] **Step 4: Add the narrow Gate authorization branch**

In `assistantRealtime.ts`, strip model-provided confirmation fields as today,
read `actionEventId` with `readBoundVoiceUtterance`, call `classifyGateIntent`,
and set `confirmed` only when all are true:

```ts
const imperativeAuthorized =
  isGateMutationTool(name) &&
  boundActionUtterance !== null &&
  classifyGateIntent({ utterance: boundActionUtterance, toolName: name }).authorization === "submit";
```

Use the same pending identity, fingerprint, audit, server authorization, and
`runPersistentAskVMutation` path. Record `boundActionUtterance` as the
confirmation phrase. Do not accept raw `transcriptText` as approval.

For typed turns, apply the same classifier only to the two Gate mutation tools
and the exact current `phrase`; all other tools keep `classifyConfirmation` and
the existing pending flow.

- [ ] **Step 5: Run focused tests and verify exact binding, cancellation, stale-action rejection, and replay**

Run: `pnpm --dir . --filter @workspace/api-server exec vitest run src/assistant/gate-intent.test.ts src/assistant/askv-voice-confirmation.test.ts src/assistant/askv-pending-confirmation.test.ts src/assistant/askv-pending-confirmation-typed.test.ts src/routes/assistantRealtime.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the server authorization unit**

```bash
git add artifacts/api-server/src/assistant/askv-voice-confirmation.ts artifacts/api-server/src/assistant/askv-voice-confirmation.test.ts artifacts/api-server/src/assistant/askv-pending-confirmation.ts artifacts/api-server/src/assistant/askv-pending-confirmation.test.ts artifacts/api-server/src/assistant/askv-pending-confirmation-typed.test.ts artifacts/api-server/src/routes/assistantRealtime.ts artifacts/api-server/src/routes/assistantRealtime.test.ts
git commit -m "feat: bind Gate commands to confirmed actions"
```

---

### Task 3: Expose the Complete Gate Pack and Bind Current Turns on Web and iOS

**Files:**
- Modify: `artifacts/api-server/src/assistant/tool-packs.ts`
- Modify: `artifacts/api-server/src/assistant/tool-packs.test.ts`
- Modify: `artifacts/vndrly/src/hooks/use-askv-realtime.ts`
- Modify: `artifacts/vndrly/src/hooks/use-askv-realtime.test.tsx`
- Modify: `artifacts/vndrly-mobile/hooks/use-askv-voice-session.tsx`
- Modify: `artifacts/vndrly-mobile/app/__tests__/askv-voice-session.test.tsx`
- Modify: `artifacts/vndrly/src/lib/askv-realtime-client.ts`
- Modify: `artifacts/vndrly/src/lib/askv-realtime-client.test.ts`
- Modify: `artifacts/vndrly-mobile/lib/askv-realtime-client.ts`
- Modify: `artifacts/vndrly-mobile/lib/__tests__/askv-realtime-client.test.ts`

**Interfaces:**
- Consumes: Gate tool metadata, saved `VoiceTranscript.eventId`, device GPS, and server `responseMode`.
- Produces: `actionEventId` on first-turn Gate mutations and identical web/iOS response behavior.

- [ ] **Step 1: Change focused tests to require both confirmed Gate tools on Gate surfaces**

```ts
expect(names).toEqual(expect.arrayContaining([
  "search_gate_history",
  "resolve_gate_check_in",
  "prepare_visitor_check_in",
  "confirm_visitor_check_in",
  "find_active_visitors",
  "prepare_visitor_check_out",
  "confirm_visitor_check_out",
]));
```

Keep field employees without Gatekeeper/Gate Supervisor membership unable to
execute these tools even if tool discovery exposes a harmless read.

- [ ] **Step 2: Add failing web and iOS current-turn race tests**

For each client prove that an imperative Gate mutation:

1. waits briefly when tool generation beats the user transcript;
2. flushes the transcript to the server;
3. sends its real `actionEventId` and never a model-provided event ID;
4. keeps the server-issued idempotency key for a retry;
5. suppresses an extra spoken response on silent preparation;
6. produces only the short server success for completed check-in/out.

- [ ] **Step 3: Run the pack and client tests and verify failure**

Run: `pnpm --dir . --filter @workspace/api-server exec vitest run src/assistant/tool-packs.test.ts`

Run: `pnpm --dir . --filter @workspace/vndrly exec vitest run src/hooks/use-askv-realtime.test.tsx src/lib/askv-realtime-client.test.ts`

Run: `pnpm --dir . --filter @workspace/vndrly-mobile exec vitest run app/__tests__/askv-voice-session.test.tsx lib/__tests__/askv-realtime-client.test.ts`

Expected: FAIL on missing confirmed tools and absent current-turn `actionEventId`.

- [ ] **Step 4: Add confirmed tools to `GATE_SCREEN_TOOLS`**

```ts
const GATE_SCREEN_TOOLS = new Set([
  "query_gate_report", "search_gate_history", "resolve_gate_check_in",
  "prepare_visitor_check_in", "confirm_visitor_check_in",
  "find_active_visitors", "prepare_visitor_check_out",
  "confirm_visitor_check_out", "query_active_visitors", "query_visits",
]);
```

- [ ] **Step 5: Attach the saved current Gate turn in both clients**

When `call.name` is a Gate mutation and no pending confirmation exists, wait for
the current user transcript if necessary, flush it, and send:

```ts
{
  name: call.name,
  arguments: trustedLocationArguments,
  actionEventId: latestUserTranscript.eventId,
  idempotencyKey: call.callId,
  clientSurface: "web" // or "ios"
}
```

Continue stripping `confirmed`, `confirmationPhrase`, event IDs, keys, and
coordinates supplied by the model. Existing context-version and screen-change
guards remain mandatory.

- [ ] **Step 6: Make response handling concise and parity-safe**

Keep `responseMode: "silent"` for successful prefill. For a successful Gate
mutation, feed the model only a compact structured result containing action,
visitor display name, and status; do not request a second explanatory response.
Errors retain one actionable recovery message.

- [ ] **Step 7: Run all pack/client tests and verify they pass**

Run the three commands from Step 3.

Expected: PASS.

- [ ] **Step 8: Commit the tool-pack and client-parity unit**

```bash
git add artifacts/api-server/src/assistant/tool-packs.ts artifacts/api-server/src/assistant/tool-packs.test.ts artifacts/vndrly/src/hooks/use-askv-realtime.ts artifacts/vndrly/src/hooks/use-askv-realtime.test.tsx artifacts/vndrly/src/lib/askv-realtime-client.ts artifacts/vndrly/src/lib/askv-realtime-client.test.ts artifacts/vndrly-mobile/hooks/use-askv-voice-session.tsx artifacts/vndrly-mobile/app/__tests__/askv-voice-session.test.tsx artifacts/vndrly-mobile/lib/askv-realtime-client.ts artifacts/vndrly-mobile/lib/__tests__/askv-realtime-client.test.ts
git commit -m "feat: enable Gate voice submission on web and iOS"
```

---

### Task 4: Fast-Lane Prompt, Resolver, and Short Result Contract

**Files:**
- Modify: `artifacts/api-server/src/assistant/prompts/system.ts`
- Modify: `artifacts/api-server/src/assistant/prompts/system-gate.test.ts`
- Modify: `artifacts/api-server/src/assistant/tools.ts`
- Modify: `artifacts/api-server/src/assistant/natural-voice-write-tools.ts`
- Modify: `artifacts/api-server/src/assistant/natural-voice-write-tools.test.ts`
- Modify: `artifacts/api-server/src/assistant/natural-voice-gate-bridge.test.ts`

**Interfaces:**
- Consumes: existing history resolver, form draft/provenance, confirmed mutation endpoints, and Gate intent contract.
- Produces: compact prepare/clarify/complete tool outputs and model instructions that never reinstate the manual-submit boundary.

- [ ] **Step 1: Add failing prompt and output-budget tests**

Assert the Gate prompt includes:

```ts
expect(prompt).toContain("An imperative check-in or check-out command is the user's authorization");
expect(prompt).toContain("Ask at most one short question");
expect(prompt).toContain("Do not ask for optional fields");
expect(prompt).toContain("Keep a success acknowledgment under ten words");
expect(prompt).not.toContain("Never submit or confirm a Gate check-in or check-out");
```

Add resolver tests for unique plate history, explicit driver override, stable
company, local-rig filtering, same-plate state collision, same-name ambiguity,
and missing optional fields.

- [ ] **Step 2: Run focused tests and verify the obsolete prompt fails**

Run: `pnpm --dir . --filter @workspace/api-server exec vitest run src/assistant/prompts/system-gate.test.ts src/assistant/natural-voice-write-tools.test.ts src/assistant/natural-voice-gate-bridge.test.ts`

Expected: FAIL because the current prompt forbids Ask V submission.

- [ ] **Step 3: Replace the Gate prompt block and tool descriptions**

The block must direct the model to resolve first, distinguish prepare from
imperative submission, call the confirmed tool only for a user-authorized
action, avoid optional-field questioning, and return only concise structured
results. Tool descriptions must state that the server independently validates
the saved utterance and ignores model-generated confirmation.

- [ ] **Step 4: Return compact success and one-question recovery metadata**

Extend successful confirm results without changing endpoint authority:

```ts
return JSON.stringify({
  ok: true,
  action: "visitor_checked_in",
  visitId: result.id,
  displayName: [args.firstName, args.lastName].filter(Boolean).join(" "),
  message: `${displayName} checked in.`,
  responseMode: "concise",
  refresh: ["gate", "visits"],
});
```

Use the checkout equivalent. Preparation stays `responseMode: "silent"` when
complete; ambiguity returns one `clarification` and no capability prose.

- [ ] **Step 5: Run focused tests and verify prompt, resolver, and output contracts pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit the behavior contract unit**

```bash
git add artifacts/api-server/src/assistant/prompts/system.ts artifacts/api-server/src/assistant/prompts/system-gate.test.ts artifacts/api-server/src/assistant/tools.ts artifacts/api-server/src/assistant/natural-voice-write-tools.ts artifacts/api-server/src/assistant/natural-voice-write-tools.test.ts artifacts/api-server/src/assistant/natural-voice-gate-bridge.test.ts
git commit -m "feat: make Ask V Gate concise and action first"
```

---

### Task 5: Gate Page-to-Tool Manifest and Operational Coverage Enforcement

**Files:**
- Create: `artifacts/api-server/src/assistant/gate-toolbox-manifest.ts`
- Create: `artifacts/api-server/src/assistant/gate-toolbox-manifest.test.ts`
- Modify: `artifacts/api-server/src/assistant/tool-registry.test.ts`
- Modify: `artifacts/api-server/src/assistant/capability-parity.test.ts`

**Interfaces:**
- Consumes: `ASK_V_TOOL_REGISTRY`, Gate role metadata, and the web/iOS action inventory.
- Produces: `GATE_TOOLBOX_MANIFEST` checked at build/test time.

- [ ] **Step 1: Write the failing manifest enforcement test**

```ts
export const REQUIRED_GATE_ACTIONS = [
  "resolve_location", "list_local_rigs", "read_plate", "search_history",
  "list_on_site", "resolve_check_in", "prepare_check_in", "correct_check_in",
  "cancel_check_in", "submit_check_in", "resolve_check_out",
  "prepare_check_out", "correct_check_out", "cancel_check_out",
  "submit_check_out", "update_checkout_notes", "read_shift_context",
  "focus_gate_surface",
] as const;

it("maps every Gate action to safe, platform-parity tooling", () => {
  expect(new Set(GATE_TOOLBOX_MANIFEST.map(row => row.action))).toEqual(new Set(REQUIRED_GATE_ACTIONS));
  for (const row of GATE_TOOLBOX_MANIFEST) {
    expect(row.web).toBe(true);
    expect(row.ios).toBe(true);
    if (row.mutating) {
      const tool = ASK_V_TOOL_REGISTRY.find(candidate => candidate.name === row.tool);
      expect(tool).toMatchObject({ mutating: true, confirmation: "required" });
      expect(tool?.auditTarget).toBeTruthy();
    }
  }
});
```

- [ ] **Step 2: Run the test and verify the missing manifest failure**

Run: `pnpm --dir . --filter @workspace/api-server exec vitest run src/assistant/gate-toolbox-manifest.test.ts src/assistant/tool-registry.test.ts src/assistant/capability-parity.test.ts`

Expected: FAIL because the manifest does not exist.

- [ ] **Step 3: Implement the immutable manifest**

```ts
export interface GateToolboxEntry {
  action: typeof REQUIRED_GATE_ACTIONS[number];
  tool: string;
  kind: "read" | "client" | "prepare" | "mutate";
  roles: readonly ("vendor" | "field_employee")[];
  mutating: boolean;
  confirmation: "none" | "required";
  auditTarget: "site" | "visit" | "device";
  web: true;
  ios: true;
}
```

Map OCR and focusing to existing client tools, location and rig resolution to
the resolver/site tools, reads to current history/visitor tools, and writes to
the two confirmed mutation tools. Model "correct" and "cancel" as client/pending
action operations rather than inventing server mutations.

- [ ] **Step 4: Run manifest, registry, and parity tests and verify they pass**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit the coverage guard**

```bash
git add artifacts/api-server/src/assistant/gate-toolbox-manifest.ts artifacts/api-server/src/assistant/gate-toolbox-manifest.test.ts artifacts/api-server/src/assistant/tool-registry.test.ts artifacts/api-server/src/assistant/capability-parity.test.ts
git commit -m "test: enforce complete Ask V Gate toolbox"
```

---

### Task 6: Full Verification, Independent Review, and Full Ship

**Files:**
- Modify only files required to fix demonstrated failures from this exact release tree.
- Do not add generated static bundles or unrelated local files to commits.

**Interfaces:**
- Consumes: the complete implementation commits from Tasks 1–5.
- Produces: one verified release commit lineage, live web/API/OTA, and submitted TestFlight build.

- [ ] **Step 1: Run fast parity and type gates**

Run: `pnpm lint:i18n`

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 2: Run the complete mandatory validation chain**

Run: `pnpm run test`

Expected: PASS for web, mobile locales, isolated API database suite, and e2e.
Fix root causes and rerun the failing gate; do not remove or skip tests.

- [ ] **Step 3: Run production builds**

Run: `$env:BASE_PATH='/'; pnpm --filter @workspace/vndrly run build`

Run the repository's configured API production build.

Run the repository's configured mobile export/native preflight without adding
`artifacts/vndrly-mobile/static-build/` to Git.

Expected: PASS.

- [ ] **Step 4: Perform an independent release-focused review**

Review the exact branch diff for confirmation bypass, cross-tenant data
exposure, stale-action execution, duplicate visits, client parity, excessive
speech, and accidental unrelated files. Fix every validated blocker and rerun
its focused test.

- [ ] **Step 5: Commit any verified review fixes and confirm a clean scoped tree**

Run: `git status --short`

Expected: only pre-existing unrelated untracked paths remain; no release file
is unstaged.

- [ ] **Step 6: Push the working branch and advance `main` non-force**

Use the configured GitHub release path, confirm current remote `main` ancestry,
publish the working branch, and advance `main` without rewriting history.

Expected: GitHub `main` contains the exact verified release tree.

- [ ] **Step 7: Start and monitor all full-ship lanes concurrently**

- `.github/workflows/publish.yml`
- `.github/workflows/deploy-api.yml` when the path filter does not fire
- guarded additive Supabase migrations only if this release actually adds one
- `.github/workflows/mobile-ota.yml`
- `.github/workflows/mobile-testflight.yml` via `workflow_dispatch`

Expected: all workflows finish successfully. At ten minutes prioritize the
public release verification; at fifteen minutes inspect and repair any blocked
job immediately under the standing authorization.

- [ ] **Step 8: Verify live outputs independently**

- Load `https://vndrly.ai/gate` and verify the new web bundle is served.
- Verify `https://vndrly.ai/api/healthz` is healthy.
- Record the production Expo update group.
- Record the submitted TestFlight build number and Apple processing/submission status.
- Confirm no destructive database action occurred.

- [ ] **Step 9: Deliver the release handoff**

Report the release commits, workflow results, live web and API evidence, OTA
group, TestFlight build/status, migration status, and elapsed commit-to-live
time. Do not call the full ship complete before TestFlight submission succeeds.
