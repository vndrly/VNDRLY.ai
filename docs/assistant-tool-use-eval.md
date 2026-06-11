# Ask VNDRLY — Tool-use eval

This eval suite replays a small fixed battery of prompts through the
live Anthropic API with the production tool catalog attached, then
asserts that the assistant invoked the right tool with sane
arguments. It complements the language-drift suite (see
[`docs/assistant-language-eval.md`](./assistant-language-eval.md))
which only inspects the first `text` block of the reply and never
exercises a tool call.

## Why it exists

The production assistant route (`artifacts/api-server/src/routes/assistant.ts`)
ships with eight tools — onboarding lookups, invoice/ticket
queries, deep-link navigation, and onboarding writes — and relies
on the model invoking the right one on intent. Common failure modes
that NO other test catches today:

- **Silent tool drop.** A model swap or a shrunken system prompt
  causes the model to stop calling `lookup_open_invoices` and
  hallucinate an invoice list inline. The language eval would
  still pass; the user gets fake numbers.
- **Hallucinated arguments.** The model calls `deep_link_to` with
  `screen: "tickets-board"` (a screen we never registered), and
  the route falls through to the `Unknown screen` branch. The
  user gets an error toast instead of a working link.
- **Required-id slip.** The model calls `deep_link_to` for
  `vendor-analytics` without an `id`, the `requireId` guard
  refuses to build a URL, and the deep-link button never appears.

This suite catches all three by reusing the real
`buildSystemPrompt`, `composeAssistantMessages`, and `TOOLS` exports
from the production code path.

## When the eval runs

The suite is **opt-in** and gated on the `ANTHROPIC_API_KEY`
environment variable. PR runs without the key skip every eval at
the suite level — `pnpm test` continues to be hermetic and fast.

The eval is intended for:

- Manual runs before promoting an assistant change to production.
- The nightly scheduled CI job in
  `.github/workflows/assistant-tool-use-eval.yml` (see
  [Scheduled CI](#scheduled-ci) below for setup, notification, and
  triage).

## Running it locally

```bash
ANTHROPIC_API_KEY=sk-ant-... \
  pnpm --filter @workspace/api-server run eval:tool-use
```

A full pass is ~6 model calls (one per prompt) and typically
completes in well under a minute. Each call is hard-bounded to 60 s
and 600 max tokens.

The suite uses a vanilla `Anthropic` SDK client pointed at
`api.anthropic.com` directly — same reasoning as
the language eval (a developer with a raw API key can run it
without provisioning the in-product integration).

A passing run prints one line per `[role] tool=<name>: <prompt>`
combination plus the standard vitest summary. A failing run shows
the offending tool name (or "no tool_use blocks at all") plus a
truncated text preface and the JSON-stringified `input` so a
reviewer can diagnose without re-running.

You can also run **all** eval suites at once (language + tone +
tool-use) with the umbrella script:

```bash
ANTHROPIC_API_KEY=sk-ant-... \
  pnpm --filter @workspace/api-server run eval
```

## How the assertions work

Each prompt entry in `TOOL_PROMPTS` declares:

- `q` — the user turn to send.
- `role` — the persona context (drives system prompt + doc
  selection).
- `expectTool` — the tool name that MUST appear in at least one
  `tool_use` block of the response.
- `validateInput` (optional) — a synchronous shape check on the
  matched call's `input` object. Returns `null` on success or a
  human-readable failure string.

The prompt loop:

1. Builds the **same** system prompt the production route builds,
   via `buildSystemPrompt(...)`, including the onboarding-active
   nudge so wizard prompts get a realistic context.
2. Builds the **same** message envelope, via
   `composeAssistantMessages("en", ...)`.
3. Calls Claude with the model name pinned by the production route
   (`claude-sonnet-4-5`) AND the production tool catalog
   (`TOOLS`, imported from `../tools`).
4. Asserts at least one `tool_use` block exists, the expected
   tool name is among them, and (when `validateInput` is set) the
   arguments are well-formed.

Because steps 1–3 reuse the production helpers, any drift in the
assembly — a missing primer, a renamed tool, a silently shrunk
catalog — surfaces as a failing assertion instead of a passing
snapshot.

## Adding a new prompt

Open
`artifacts/api-server/src/assistant/__evals__/tool-use.eval.ts`
and append to the `TOOL_PROMPTS` array:

```ts
const TOOL_PROMPTS: ToolPrompt[] = [
  // ...existing entries...
  {
    q: "Take me to my bills to pay.",
    role: "partner",
    expectTool: "deep_link_to",
    validateInput: (input) => {
      if (!input || typeof input !== "object") return "input is not an object";
      const screen = (input as { screen?: unknown }).screen;
      if (screen !== "bills-to-pay") return `screen '${screen}' is not 'bills-to-pay'`;
      return null;
    },
  },
];
```

Each entry contributes one model call. Keep the battery roughly
bounded (~5–10 prompts) so the wall-clock and billing cost of a
full run stays trivial. Prefer prompts that exercise different
tools — there is no value in three prompts that all should fire
`lookup_open_invoices`.

## What this eval does NOT cover

- **Multi-round tool chains.** The eval inspects the FIRST round
  of `tool_use` blocks. The production route loops up to
  `MAX_TOOL_ROUNDS` (6) times, feeding `tool_result` back in each
  round; that recursion is not exercised. Adding it would require
  stubbing `runTool` for the eval, which is significant scope.
- **Tool execution correctness.** We only check that the model
  CALLED the right tool with the right shape — not that the tool
  returned the right data. Tool implementations are covered by
  unit tests next to each handler in `routes/assistant.ts`.
- **Token-mode (field-employee invite) tool catalog.** The eval
  always advertises the full `TOOLS` array. The
  `FIELD_TOKEN_ALLOWED_TOOLS` filter that the public token route
  applies is checked in unit tests, not here.

These are intentional scope choices — keeping the eval small keeps
it cheap enough to run nightly and fast enough to run on demand.

## Scheduled CI

The nightly run lives in
`.github/workflows/assistant-tool-use-eval.yml`. It runs once a day
at **09:15 UTC** (≈ 02:15 PT / 05:15 ET) — fifteen minutes after
the language eval to avoid both jobs hammering the Anthropic API
at the same minute. It can also be triggered on demand via the
**Run workflow** button on the Actions tab.

### One-time setup

The workflow reuses the same `ANTHROPIC_API_KEY` repository secret
that the language eval uses. If you've already followed the
[language eval setup](./assistant-language-eval.md#one-time-setup),
nothing more is needed — the new workflow will pick the secret up
on the next scheduled tick (or via **Run workflow**).

If you're setting this up from scratch, follow the language eval
setup instructions; the same key works for both.

### Failure notifications

When a **scheduled** run fails, the workflow files (or refreshes)
a GitHub issue labeled **`assistant-tool-use-eval`** (deliberately
distinct from `assistant-language-eval`) with the tail of
`eval-output.log` so a triager can diagnose without leaving the
issue. Subsequent failures append a comment to the same open issue
instead of opening new ones, so a multi-day outage stays in a
single thread.

The two suites have **separate** issue threads on purpose: a
language regression and a tool-call regression are usually root-
caused differently (prompt wording vs. tool description / schema),
so mixing them in one thread slows triage.

Manual `workflow_dispatch` failures **do not** open issues — the
person who pressed the button already has the run page open.

The full eval log is also uploaded as a `assistant-tool-use-eval-<run_id>`
workflow artifact (30-day retention) for both passing and failing
runs.

### Local pre-flight

Before merging a change that touches the assistant tool catalog,
the system prompt's tool-use guidance, or this eval suite itself,
run the eval locally with
`ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @workspace/api-server run eval:tool-use`
(see [Running it locally](#running-it-locally)). The nightly job
catches drift; the local run catches it before it lands.
