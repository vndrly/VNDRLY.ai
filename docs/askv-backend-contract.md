# AskV natural voice backend contract

The API keeps permanent OpenAI credentials on the server. Every voice action is
authenticated again; tool visibility is not an authorization boundary.

## Rollout controls

- `ASKV_NATURAL_VOICE_ENABLED=0`, `false`, or `off` disables Realtime call,
  client-secret, context and tool-call endpoints. The default preserves enabled
  behavior. This server switch cannot be bypassed by client preferences.
- `ASKV_NATURAL_VOICE_USER_IDS=10,20` optionally limits Realtime to a pilot group.
- Authenticated `GET /api/assistant/voice/capabilities` returns `enabled`,
  `workflows`, and `recordingFallback: true`.
- Conversation history, final transcripts, session end and metric ingestion stay
  available during rollback. Typed AskV and the legacy recording fallback remain.
- The existing guarded `migrate:askv-greeting` adds only
  `users.askv_last_full_greeting_on`; deployment runs it before API restart.

## Context and tool packs

`POST /api/assistant/realtime/context` accepts `sessionId`, `path`, optional
`entityId`, `workflow`, and numeric `location` (`latitude`, `longitude`, optional
`accuracyMeters`). It returns `tools`, `toolMetadata`, and compact `context`.
Role and organization IDs come from the authenticated session. Paths exclude
query strings and arbitrary prose; route record IDs replace stale selection IDs.

Clients serialize context updates, apply `tools` through `session.update`, and
send `context` as an app-context conversation item. That item is navigation data,
not a user request, and must not replace the base system instructions.

The always-available `select_tool_pack` tool accepts `workflow`:
`auto`, `gate`, `tickets`, `safety`, `operations`, `finance`, `reports`, `catalog`,
or `market`. Its tool-call response includes the same tools/context envelope.
Clients apply that envelope before sending the function output and continuing
the response. Every retained read-only data tool is discoverable through these
bounded packs. Office packs do not enable deferred mutations.

Successful committed tools return a top-level `mutation` object with `name`,
`refresh`, available positive `ticketId`/`visitId`/`siteLocationId`, and `replayed`.
Gate changes refresh `gate` and `visits`; ticket lifecycle/comments refresh
`tickets` and `crew-map`; notification changes refresh `notifications`. Clients
invalidate both active and history views. Pending, denied, failed, read-only and
draft operations emit no mutation hint. Typed streaming emits the same payload
as `event: mutation` with `{mutation}`.

## Confirmation and history

Create or hydrate history with `POST /api/assistant/voice/conversation` and
`{conversationId?}`. Pass the stable `sessionId` and `conversationId` to the
broker. A session cannot be rebound to a different conversation.

Persist plain-text transcript events with
`POST /api/assistant/voice/transcript` and
`{conversationId,sessionId,eventId,role,content}`. The server deduplicates events.
Final transcript flush is accepted for five minutes after session end.

Mutations require a stable top-level `callId` or `idempotencyKey`.
High-impact calls first return exact pending arguments and their original key.
To approve, clients flush transcript persistence and send a top-level
`confirmationEventId` identifying a later user turn. It must be the latest saved
user event for that bound voice session and contain an accepted affirmation.
Model-supplied `confirmed` and `confirmationPhrase` cannot approve an action.
Changing arguments, organization, workflow, record or session requires a new
summary and confirmation. Exact approved retries use the durable stored result.

Pending approvals and active context are process-local. An API restart or a
request routed to another instance loses pending approval and fails closed;
clients must reconnect and obtain a new summary and user confirmation. Multiple
API instances require session affinity until this transient state is shared.
Durable write reservations and transcript records survive restart. A reservation
with an uncertain outcome is not automatically executed again.

## Operational metrics

`POST /api/assistant/voice/metrics` accepts only:

```json
{
  "sessionId": "stable-session-id",
  "conversationId": 42,
  "eventId": "stable-observation-id",
  "event": "turn",
  "clientSurface": "web",
  "durationMs": 1250,
  "usage": {
    "inputTextTokens": 100,
    "inputAudioTokens": 200,
    "cachedTextTokens": 0,
    "cachedAudioTokens": 0,
    "outputTextTokens": 20,
    "outputAudioTokens": 40
  }
}
```

`conversationId`, `durationMs`, `reason` and `usage` are optional. When supplied,
usage requires all six nonnegative integer counters; cached counts are subsets
of their input counts. Derive them from provider response usage, never message
content. Events are `session_start`, `session_end`, `first_audio`, `turn`,
`interruption`, `wake`, `false_wake`, `correction`, `fallback`, and `idle`.
Reasons are `user`, `timeout`, `muted`, `background`, `network`, `permission`,
`unavailable`, `interruption`, and `empty_turn`.

Unknown fields, transcript/audio content, arbitrary error text and invalid
counters are rejected. Ingestion is limited to 120 observations per user per
minute. Stable event IDs are deduplicated in the existing action audit table.
Numeric observations appear in logs under `kind: askv_voice_metric` and in
`assistant_action_audit` rows with `tool_name = 'askv_voice_metric'`. Their
`parsed_intent.scopeHash` groups a conversation/session without retaining the
raw session or event identifier. Server outcomes appear under
`kind: askv_voice_tool`, including success, denial, failure and duplicate replay.

The response includes `duplicate` and `estimatedCostUsd`. Estimates use the
[published GPT-Realtime-2.1 text/audio rates](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
verified September 6, 2026, with cached input subtracted once. Sum estimates by
scope for conversation cost. They are client-reported observations, not billing
records, and exclude separate transcription charges, discounts and taxes.
Unknown configured models retain token counts and report a null cost estimate.
Actual provider billing and real-device performance remain pilot validation.
