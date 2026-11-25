# AskV voice confirmation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** When V asks for a yes, a normal answer submits the open check-in or check-out, a refusal does not, and she reads the entry back and says what was saved.

**Architecture:** One decision function in `@workspace/gate-booth` runs only while a confirmation is open. A short approval submits. A refusal clears the save. A correction falls through to the form. A longer sentence uses the existing `classifyGateIntent`, and a named person must match the open draft. Web and iPhone call that function from the same transcript path the Confirm button already uses. The OpenAI SDK `needsApproval` event does not apply: spoken check-in is owned by the form and never becomes a model tool call, so the shared decision is the pause.

**Tech Stack:** TypeScript, Vitest, `@workspace/gate-booth`, web `use-askv-realtime`, mobile `use-askv-voice-session`.

## Global Constraints

- No new model and no fine-tune. The existing server classifier stays for longer sentences.
- "No", "don't", and a correction never submit.
- A plate is spoken character by character.
- Checkout no longer treats every utterance as approval.
- The on-screen button may keep the label "Confirm?" and still sends "confirm".
- Shift-note confirmation stays on its own "Confirm?" wording.
- Do not ship, commit, or touch the ChatGPT plugin.

---

### Task 1: Shared reply decision and spoken lines

**Files:** `lib/gate-booth/src/voice-reply.ts`, `lib/gate-booth/src/voice-reply.test.ts`, `lib/gate-booth/src/gate-intent.ts` (moved from the API package and re-exported), `lib/gate-booth/src/checkout-speech.ts`, `lib/gate-booth/src/index.ts`

- [x] Failing tests for yes / yeah / affirmative / submit / "Confirm?" / Spanish, and for no / don't / a correction / a longer unrelated sentence.
- [x] `decideGateVoiceReply` returns `submit`, `refuse`, `correct`, or `repeat`.
- [x] `checkInPrompt` spells the plate and ends with "Say yes to check in."
- [x] `checkInReceipt` says the visitor is checked in.
- [x] Checkout staging says "Say yes to check out." Saved checkout speech stays "<name> is checked out."

### Task 2: Use the decision while a confirmation is open

**Files:** `artifacts/vndrly/src/hooks/use-askv-realtime.ts`, `artifacts/vndrly-mobile/hooks/use-askv-voice-session.tsx`, `artifacts/api-server/src/assistant/voice-sdk-actions.ts`, checkout prompt strings in `lib/askv-realtime-sdk/src/app-context.ts` and `artifacts/api-server/src/assistant/prompts/system.ts`

- [x] Web check-in and checkout call the decision before any save.
- [x] A submit speaks the receipt. A refusal speaks "Not submitted." A newly ready check-in speaks the readback once per draft.
- [x] Mobile check-in uses the same decision. Mobile checkout replays the pending tool only on submit.
- [x] A later gate confirmation turn on the server accepts the same submit and refuse results.
- [x] Update the checkout voice line from "Confirm?" to "Say yes to check out." Leave the button label and shift notes alone.

### Task 3: Verify

- [x] `pnpm --filter @workspace/gate-booth exec vitest run src/voice-reply.test.ts src/checkout-speech.test.ts src/silent-check-in.test.ts`
- [x] Web realtime hook tests and the API confirmation tests that cover this path.
