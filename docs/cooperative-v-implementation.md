# Cooperative V implementation and verification

Authenticated Ask V text conversations use one provider-neutral transcript and the existing authority, confirmation, audit and domain execution path. Operational requests prefer Anthropic; analytical/drafting requests prefer approved, configured OpenAI. One alternate consultation or retryable provider fallback is allowed per turn, within seven model rounds. Authorization failures and domain action failures prohibit fallback. Mutation promises remain cached even when execution fails ambiguously. Resumed mutations re-read the canonical saved task and reject already-completed operations.

Company native policy controls approved providers. Company-less chats retain the existing Anthropic engine. Conversation history is bound to its company before sending it to an engine. Calendar, attachment and tool content is treated as source data, never authority or confirmation. A queued device request is not claimed as fulfilled work.

## API contract

- `GET /api/assistant/cooperation`: approved providers and configuration presence only.
- `GET /api/assistant/connections`: authorized existing connector metadata.
- `GET /api/assistant/tasks/:id/recovery`: exact canonical task, recorded completions requiring readback, remaining and eligible steps. Does not execute work.
- `GET /api/assistant/usage`: current company administrators' aggregate monthly reported model usage and estimated costs, with informational alerts and no spending stop.
- Existing message endpoint accepts optional `taskId` and `selectedConnection`: `connectionId`, `scope` (`company` or `personal`), `personalPermission`, `savePersonalContentToCompany`.

Connection reads recheck live company policy, membership role and exact connection grants. Personal connections additionally require current worker ownership and explicit per-task permission. Only selected, already-synchronized calendar events are exposed, limited to a 31-day window and 25 events. Credentials, private ChatGPT history, apps and subscriptions are never imported. Synchronization timestamps are returned; this is not a live external refresh or OAuth provisioning service. Personal content without explicit permission to save is excluded from persisted tool inputs, outputs and assistant answer content; writes are withheld for that turn.

Native Work Hub queries use the existing `work_hub:read` grant; native requests use `work_hub:write` with existing durable confirmation. Location requests additionally require `crew:read`; native reads and saved action results withhold measurements without that grant. Trusted executor identities are converted to stable UUID request IDs after confirmation, never accepted as model authority. Domain handlers remain responsible for current module, site, role and worker restrictions.

## Evidence and remaining release verification

Seven focused API files pass 33 tests, including provider denial and domain failure boundaries, ambiguous mutation caching, connection scope, live administrator demotion, saved task completion, native grant exposure and trusted confirmation envelopes.

The synthetic live provider proof used existing keys without printing them: OpenAI selected a synthetic read returning ID 42; Anthropic consumed that same transcript and read ID 42 back with zero repeated calls. This verifies real provider cooperation, not a real company mutation or physical iPhone delivery. Root release verification must cover those independently.

Cost estimates cover reported successful rounds using known model rates, including reported cached input. Unknown rates remain unpriced. Actual provider invoices are authoritative; this is not a complete billing reconciliation. Missing connector grants preserve the saved task and produce a resumable handoff instead of manufacturing access.
