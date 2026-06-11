# Ask VNDRLY — Language-drift eval

This eval suite replays a small fixed battery of prompts through the
live Anthropic API and asserts that the assistant's reply is in the
user's preferred language. It complements the offline regression
catalog in `artifacts/vndrly/tests/assistant.spec.ts`, which only
verifies the *prompt* we send, not the model's actual output.

The unit tests added in Task #474 pin the system prompt's `LANGUAGE`
directive and the `buildLanguagePrimerMessages` envelope, but they
never call Claude. A future change that quietly weakens the language
pin (e.g. trimming the `LANGUAGE` block to save tokens) would still
pass those tests but regress real-world output. This eval closes that
gap.

## When the eval runs

The suite is **opt-in** and gated on the `ANTHROPIC_API_KEY`
environment variable. PR runs without the key skip every eval at the
suite level — `pnpm test` continues to be hermetic and fast.

The eval is intended for:

- Manual runs before promoting an assistant change to production.
- The nightly scheduled CI job in
  `.github/workflows/assistant-language-eval.yml` (see
  [Scheduled CI](#scheduled-ci) below for setup, notification, and
  triage).

## Running it locally

```bash
ANTHROPIC_API_KEY=sk-ant-... \
  pnpm --filter @workspace/api-server run eval
```

A full pass is ~20 model calls (10 prompts × {English, Spanish}) and
typically completes in well under a minute. Each call is hard-bounded
to 60 s and 512 max tokens.

The suite uses a vanilla `Anthropic` SDK client pointed at
`api.anthropic.com` directly — so a developer with
their own raw API key can run it without provisioning the in-product
integration. Production traffic continues to flow through the proxy
via `@workspace/integrations-anthropic-ai`.

A passing run prints one line per `[language] role: prompt`
combination plus the standard vitest summary. A failing run includes
the first 400 characters of the offending reply alongside the
detected vs. expected language.

## How drift is detected

Each test:

1. Builds the **same** system prompt the production route builds, via
   `buildSystemPrompt(...)` — including the `LANGUAGE` directive.
2. Builds the **same** message envelope, via
   `composeAssistantMessages(preferredLanguage, [...])` — including
   the priming user/assistant pair from
   `buildLanguagePrimerMessages`.
3. Calls Claude with the model name pinned by the production route
   (`claude-sonnet-4-5`).
4. Runs the reply through a tiny diacritic + stop-word language
   detector (no external dependency).
5. Asserts the detected language matches the configured
   `preferredLanguage`.

Because steps 1–2 reuse the production helpers, any drift in the
assembly — a missing primer, a trimmed `LANGUAGE` block, a renamed
helper — will surface as a failing assertion, not a passing
snapshot.

The detector lives in its own side-effect-free module
(`artifacts/api-server/src/assistant/__evals__/language-detector.ts`)
and is unit-tested in
`artifacts/api-server/src/assistant/__evals__/language-detector.test.ts`
so a regression in the detector can't silently mask an eval failure.
Splitting the detector out also keeps `pnpm test` strictly hermetic
— the unit test never imports `language.eval.ts`, so the live
`describe(...)` blocks are only ever loaded by the dedicated `eval`
config.

## Adding a new prompt

Open
`artifacts/api-server/src/assistant/__evals__/language.eval.ts` and
append to the `PROMPTS` array:

```ts
const PROMPTS: EvalPrompt[] = [
  // ...existing entries...
  { q: "How do I export a CSV of tickets?", role: "admin" },
];
```

Each entry contributes two model calls (English + Spanish). Keep the
battery roughly bounded (~10–15 prompts) so the wall-clock and
billing cost of a full run stays trivial. Prefer prompts that
exercise different knowledge surfaces — there is no value in three
prompts that all retrieve the same doc.

If you want to gate a prompt to a single language (e.g. testing a
specific Spanish phrase), the easiest path today is to fork the
loop in `language.eval.ts` rather than thread a `langs` field
through every entry.

## What this eval does NOT cover

- **Tool-use loops.** The eval sends a single user turn and reads
  the first `text` block of the response. Tool calls are covered
  by a sibling suite — `tool-use.eval.ts` — documented in
  [`docs/assistant-tool-use-eval.md`](./assistant-tool-use-eval.md).
  That suite has its own dedicated nightly workflow and failure-
  issue label (`assistant-tool-use-eval`) so a tool regression is
  triaged separately from a language one.
- **Tone / length / refusal correctness.** The detector only
  checks language. A reply that's in the right language but
  hallucinates a non-existent feature still passes. Tone, length,
  and refusal correctness are covered by a sibling suite —
  `tone.eval.ts` — documented in
  [`docs/assistant-tone-eval.md`](./assistant-tone-eval.md). That
  suite has its own dedicated nightly workflow and failure-issue
  label (`assistant-tone-eval`) so a tone regression is triaged
  separately from a language one. The bare `pnpm run eval` script
  still picks up both files for ad-hoc local use.
- **The full 120-question battery.** The offline catalog already
  covers retrieval-coverage drift across every persona; this eval
  is a focused live-output check, not a full re-run.

These are intentional scope choices — keeping the eval small keeps
it cheap enough to run nightly and fast enough to run on demand.

## Scheduled CI

The nightly run lives in
`.github/workflows/assistant-language-eval.yml`. It runs once a day
at **09:00 UTC** (≈ 02:00 PT / 05:00 ET) and can also be triggered
on demand via the **Run workflow** button on the Actions tab.

### One-time setup

1. In the GitHub repo, go to **Settings → Secrets and variables →
   Actions → New repository secret**.
2. Name it `ANTHROPIC_API_KEY` and paste a raw Anthropic API key
   (`sk-ant-...`). The eval intentionally calls `api.anthropic.com`
   directly — see `language.eval.ts` for
   the rationale. The key only needs Messages API permission; a
   read-only "evals" key is ideal so a leak can be revoked without
   touching production.
3. Confirm the workflow shows up under **Actions → Assistant
   language eval**. The first scheduled run will fire at the next
   09:00 UTC tick after the workflow lands on the default branch.
4. Optionally trigger one manual run via **Run workflow** so you
   can verify the secret is wired before relying on the cron.

If the secret is missing, the workflow's first step fails fast
with a clear error rather than silently passing — without the
key, the `language.eval.ts` `describe.skipIf(!HAS_KEY)` would skip
every test and the workflow would go green while catching nothing.

### Failure notifications

When a **scheduled** run fails, the workflow files (or refreshes)
a GitHub issue labeled `assistant-language-eval` with the tail of
`eval-output.log` so a triager can diagnose without leaving the
issue. Subsequent failures append a comment to the same open issue
instead of opening new ones, so a multi-day outage stays in a
single thread.

Manual `workflow_dispatch` failures **do not** open issues — the
person who pressed the button already has the run page open.

The full eval log is also uploaded as a `assistant-language-eval-<run_id>`
workflow artifact (30-day retention) for both passing and failing
runs.

### Establishing the baseline

Done-criteria for the rollout (see Task #482) is **five
consecutive green nightly runs** before we trust the signal. Track
them on the Actions tab; if a run goes red during the baseline
window, treat the failure issue as a real regression, fix or
quarantine the offending prompt, and reset the counter.

### Trend dashboard

A pass/fail snapshot per night (the failure issue) tells you
*what's red right now* but not *what's drifted over time* — you
can't see "this Spanish prompt has regressed twice this week"
without trawling Actions history. Task #832 added a lightweight
trend store that closes that gap.

After every scheduled run, the workflow:

1. Reads the structured per-prompt summary the eval writes to
   `artifacts/api-server/eval-summary.json` (one row per
   `[language] role: prompt` test, with the detected language and a
   pass/fail flag — failing rows are captured the same as passing
   ones).
2. Worktree-checks-out the orphan branch
   **[`assistant-language-eval-history`](../../tree/assistant-language-eval-history)**.
3. Runs `pnpm --filter @workspace/scripts run aggregate:language-eval`
   to append the run's rows to `data/assistant-language-eval/history.csv`
   and regenerate `data/assistant-language-eval/TREND.md` from the
   merged history.
4. Commits and pushes back to the same orphan branch.

The branch is **machine-managed and isolated** — it has no shared
history with the default branch, so nightly commits never appear
in `main`'s log or in PR diffs. It exists purely as a durable
store + readable view for this one eval.

**To see the dashboard,** open the
[`assistant-language-eval-history`](../../tree/assistant-language-eval-history)
branch on GitHub and view `data/assistant-language-eval/TREND.md`.
It contains:

- A trailing 30-day pass-rate table broken down by **prompt ×
  language** — a streak of `0/N` in a single cell is the slow-burn
  drift the report exists to surface.
- A per-language summary (en vs. es overall pass rate).
- The last 20 failures with timestamp, prompt, and detected
  language for triage shortcuts.
- A cumulative footprint (total rows, distinct runs, first /
  most-recent run timestamps).

The CSV is the source of truth — `TREND.md` is regenerated from
it on every run, so it's safe to delete and rebuild from the raw
rows if the dashboard format changes.

**Manual `workflow_dispatch` runs do NOT write to the history.**
A developer probing a single prompt shouldn't pollute the long-
term trend; if you want a manual run on the chart, edit the
`if:` guard on the **Append run to trend history** step locally,
or just re-trigger the schedule via a cron-time `workflow_dispatch`.

If the eval suite itself crashes before any test runs (e.g. a
syntax error), no `eval-summary.json` is written and the history
step regenerates `TREND.md` from existing rows without appending —
no row means no false-positive in the trend.

### Local pre-flight

Before merging a change that touches the assistant prompt, the
detector, or the eval suite itself, run the eval locally with
`ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @workspace/api-server run eval`
(see [Running it locally](#running-it-locally)). The nightly job
catches drift; the local run catches it before it lands.
