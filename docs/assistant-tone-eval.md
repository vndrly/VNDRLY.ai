# Ask VNDRLY — Tone & refusal eval

This eval suite is the second live-model eval added on top of the
language-drift suite shipped in Task #476. Where
`docs/assistant-language-eval.md` covers "is the reply in the right
language", this suite covers two failure modes the original Task #472
review (`docs/assistant-review.md` §3) called out:

1. **Tone consistency.** The system prompt asks for second-person,
   ≤180-word, table-free replies. Unit tests can pin the prompt
   string but they cannot prove the model actually obeys it — a
   future model or a future prompt tweak could quietly start emitting
   markdown tables or 400-word essays.
2. **Refusal correctness.** When the assistant declines a request
   because of role/scope, the §3 review specifically called out that
   refusals were "sometimes terse … without suggesting the *right*
   place." A healthy refusal both refuses AND points the user at a
   real screen they could be helped on.

## When the eval runs

Same gate as the language eval: **opt-in**, gated on
`ANTHROPIC_API_KEY`. Without the key, every test in the file is
skipped at the suite level so `pnpm test` stays hermetic. Run
locally with:

```bash
ANTHROPIC_API_KEY=sk-ant-... \
  pnpm --filter @workspace/api-server run eval
```

Both eval files are picked up by the same `eval` script
(`vitest.eval.config.ts` — `include: ["src/**/*.eval.ts"]`), so a
full opt-in run exercises language, tone, and refusal drift in one
shot.

## What the suite asserts

For each tone prompt:

- The reply contains at least one text block.
- The whole-reply word count is ≤ `MAX_WORDS` (200, with ~10%
  headroom over the 180-word target documented in
  `docs/assistant-review.md`).
- The reply contains no GFM markdown table syntax (the alignment
  separator `| --- | --- |` OR two consecutive lines that both start
  and end with `|`).

For each refusal prompt:

- The reply trips the production `classifyRefusal` heuristic — which
  is the same regex written to `assistant_messages.refusal` and
  surfaced on the admin metrics card. We intentionally import the
  heuristic from `src/assistant/refusal.ts` rather than re-deriving
  it, so any tweak in production is automatically picked up here.
- The reply names at least one **concrete screen label or slug**
  from the prompt's `expectScreens` regex list (e.g. "Vendor
  analytics", "field employees", "bills to pay"). Generic role
  nouns like "admin" deliberately do NOT satisfy this assertion —
  that's the exact "terse refusal without naming the right place"
  failure mode the §3 review flagged.
- When the caller's role can't reach the right screen on their own
  (e.g. a field employee asking for a vendor-admin-only view), the
  prompt also sets an `expectRoleHint` regex list. The reply must
  then ALSO name a person/role to ask ("vendor admin", "your
  account admin", etc.). The screen and role-hint checks are
  separate `expect(...)` calls so a failure tells you exactly which
  half of the refusal copy regressed.

## Adding a new prompt

Open `artifacts/api-server/src/assistant/__evals__/tone.eval.ts` and
append to the right battery:

```ts
const TONE_PROMPTS: TonePrompt[] = [
  // ...
  { q: "Where do I review hotlist tickets?", role: "vendor" },
];

const REFUSAL_PROMPTS: RefusalPrompt[] = [
  // ...
  {
    q: "Delete every site location for partner #42.",
    role: "vendor",
    expectScreens: [/site\s+locations?/i],
    expectRoleHint: [/\badmin\b/i, /partner/i],
  },
];
```

Each prompt contributes one model call. Keep the batteries small —
the goal is fast, cheap signal, not exhaustive coverage. The
language eval already exercises ~20 calls; add a prompt here only
if it covers a tone or refusal failure mode the existing battery
doesn't already catch.

When adding a refusal prompt, prefer scenarios where the role
genuinely cannot do the thing (so the model SHOULD refuse) AND
where there is a real "right place" to point at — otherwise the
`expectScreens` assert is testing nothing.

## Why a separate file from `language.eval.ts`

The two suites differ on three axes:

- **Language.** Language drift only manifests when the user is on
  the Spanish toggle, so that battery runs each prompt twice
  (English + Spanish). Tone and refusal are checked in English
  only: the eval battery exercises English refusal prompts, and
  word-count rules apply equally to both languages.
  `classifyRefusal` itself recognises both English and Spanish
  refusal openings (so the admin metrics card counts Spanish
  refusals too — see `src/assistant/refusal.ts`), but the eval
  prompts here stay English to keep the matrix small.
- **Cost.** Splitting the files lets a developer run just the tone
  battery with `vitest run --config vitest.eval.config.ts tone` when
  iterating on prompt copy, without paying for the full language
  matrix.
- **Failure isolation.** A drift in the language pin and a drift in
  the GROUND RULES are different bugs with different owners; keeping
  them in separate test files makes the failing test name itself
  diagnose the regression class.

## What this eval still doesn't cover

- **Tool-use loops.** Same gap as the language eval — only the
  first text block of a single user turn is read. Refusals that
  happen mid-tool-loop are not exercised.
- **Spanish refusal copy.** The refusal heuristic now matches
  Spanish openings ("no puedo", "no tengo acceso", "lo siento, eso
  está fuera", …) so the admin metrics card counts them, but no
  Spanish refusal prompt is exercised here yet. Add one if Spanish
  refusal quality (screen-naming, role-hint pointing) becomes a
  concern.
- **Hallucinated screen names.** The `expectScreens` regexes prove
  the reply mentions a real screen *name*, not that the screen
  actually exists for the caller's role. The deep-link gate
  (`gateDeepLinkScreen`, exercised in the offline catalog) is the
  defence in depth there.

## Scheduled CI

The nightly run lives in
`.github/workflows/assistant-tone-eval.yml`. It runs once a day at
**09:30 UTC** (≈ 02:30 PT / 05:30 ET) — staggered thirty minutes
after the language eval (09:00) and fifteen minutes after the
tool-use eval (09:15) so the three nightly jobs don't slam the
Anthropic API at the same minute. It can also be triggered on
demand via the **Run workflow** button on the Actions tab.

### One-time setup

Same `ANTHROPIC_API_KEY` repository secret as the sibling evals —
if you've already wired it for `assistant-language-eval` or
`assistant-tool-use-eval`, this workflow picks it up automatically
with no extra setup. See `docs/assistant-language-eval.md` →
*Scheduled CI → One-time setup* for the step-by-step.

If the secret is missing, the workflow's first step fails fast
with a clear error rather than silently passing — without the
key, the `tone.eval.ts` `describe.skipIf(!HAS_KEY)` would skip
every test and the workflow would go green while catching nothing.

### Failure notifications

When a **scheduled** run fails, the workflow files (or refreshes)
a GitHub issue labeled `assistant-tone-eval` with the tail of
`eval-output.log` so a triager can diagnose without leaving the
issue. The label is deliberately distinct from
`assistant-language-eval` and `assistant-tool-use-eval` so the
three suites stay in separate triage threads — a tone regression
shouldn't bury a still-open language regression and vice versa.
Subsequent failures append a comment to the same open issue
instead of opening new ones, so a multi-day outage stays in a
single thread.

Manual `workflow_dispatch` failures **do not** open issues — the
person who pressed the button already has the run page open.

The full eval log is also uploaded as an
`assistant-tone-eval-<run_id>` workflow artifact (30-day
retention) for both passing and failing runs, so the failing
prompt's offending model output is preserved even after the issue
is closed.

### Why this is its own workflow

The `eval:tone` script targets ONLY `tone.eval.ts`. The sibling
language workflow uses `eval:language` (language.eval.ts only)
and the tool-use workflow uses `eval:tool-use` — the three
nightly workflows partition the full `eval` suite so a failure in
one bucket files an issue under the right label and triages to
the right owner. The bare `pnpm --filter @workspace/api-server
run eval` script still runs all three for ad-hoc local use.
