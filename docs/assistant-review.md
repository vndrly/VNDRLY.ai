# Ask VNDRLY — QA Review (Task #472)

This review grades the in-app "Ask VNDRLY" assistant shipped in
Task #471. Coverage = persona × surface walkthrough plus a 30-question
battery per role (see `artifacts/vndrly/tests/assistant.spec.ts`),
hands-on smoke of each onboarding wizard, and a manual safety pass on
the assistant's tool surface.

**Scope.** `artifacts/api-server/src/routes/assistant.ts` (HTTP +
streaming + tool runtime), `artifacts/api-server/src/assistant/**`
(prompts, knowledge corpus, onboarding flow specs), and the assistant
UI in `artifacts/vndrly/src/components/assistant-panel.tsx` plus the
launcher/route wiring in `App.tsx`.

**Verdict.** Production-ready for the partner / vendor / field
employee personas after the single P0 fix included with this task. The
admin persona is correctly served, but the metrics card is the first
piece of admin-specific UX — see P1 backlog for the next round of
admin tooling.

---

## 1. Onboarding Coverage

The assistant exposes a `complete_onboarding_step` tool whose schema is
generated from per-step `StepSpec`s in
`artifacts/api-server/src/assistant/prompts/onboarding-flows.ts`. Each
step lists field keys, types, required-ness, and an enum where
applicable. The tool runtime hard-rejects:

- skipping a required step (`REQUIRED_STEPS` per persona);
- writing an unknown payload key (catches model hallucination);
- jumping past the persona's `currentStep` pointer;
- empty values on required fields.

The regression catalog asserts the `REQUIRED_STEPS` table on the
server matches the wizard's `STEP_KEYS` for partner, vendor, and field
employee — so any drift in either side fails CI.

| Persona         | Required steps                                                                       | Optional steps                  | Wizard mirror | Verdict |
|-----------------|--------------------------------------------------------------------------------------|---------------------------------|---------------|---------|
| Partner         | company-basics, branding, first-site, tax-billing                                    | preferences, invite-team        | OK            | Pass    |
| Vendor          | company-basics, tax-ids, work-types, compliance, rates, first-employee               | branding                        | OK            | Pass    |
| Field employee  | personal-info, photo-certs, set-password                                             | —                               | OK            | Pass    |

**Happy paths walked:** all three. The assistant correctly proposes
the next field, accepts a tool call, stamps the `onboarding_progress`
row, and announces completion. **Error paths walked:** five per
persona — see the executable assertions at the bottom of
`assistant.spec.ts`. The regression catalog drives the **same**
`validateStepCompletion` / `validateFieldPath` functions the
production route handler runs (extracted into
`artifacts/api-server/src/assistant/onboarding-validation.ts`), so a
passing test is a passing production check — there's no longer any
mirror-copy drift risk. All five negative cases per persona return
the expected error code (required_step_skipped, invalid_step_name,
out_of_sequence_step, out_of_sequence_next, missing_required_fields,
or invalid_payload_key).

**Gaps.**

- Partner "preferences" + "invite-team" are optional and the assistant
  often skips straight from `tax-billing` → `done`. That's correct
  behaviour, but the assistant doesn't currently *offer* the optional
  steps; a user has to know to ask. Filed as P2.
- Mobile field-employee onboarding is end-to-end identical to web, but
  the launcher is not yet mounted on the Expo app. Out of scope for
  Task #472; tracked separately in the existing follow-up backlog.

## 2. Knowledge Accuracy

The retriever is `selectDocs(role, query, max)` —
`artifacts/api-server/src/assistant/knowledge/index.ts`. It does
keyword overlap scoring against `KNOWLEDGE_DOCS` (curated in
`docs.ts`), filtered by role tags. Hits are injected into the system
prompt as a numbered context block.

Validated:

- Every persona has at least three role-tagged docs, and the major
  feature surfaces (tickets, sites, invoices, statements, hotlist,
  reports, crew map, visitors, catalog, comments, notifications) all
  have a doc — see the `covers the major feature surfaces` test.
- The 30-question battery per persona retrieves a doc whose body
  literally contains an expected keyword. This is a coverage check,
  not a correctness check, but it catches the failure mode where a
  surface is renamed and falls out of the corpus.

Spot-check on doc *correctness* (sampled 12 docs across personas):

| Doc id              | Accurate? | Notes                                                                 |
|---------------------|-----------|-----------------------------------------------------------------------|
| tickets-list        | Yes       | Status filter, search, paging match the page.                          |
| ticket-detail       | Yes       | Comments, attachments, status pill all named correctly.                |
| crew-map            | Yes       | "Crew" tab, replay slider, geofence overlay confirmed.                 |
| invoices-vendor     | Yes       | Invoice lifecycle (Draft / Submitted / Approved / Paid) is correct.    |
| bills-to-pay        | Yes       | Partner-side AP queue, dispute flow, batch pay.                        |
| reports-1099        | Yes       | E-delivery consent + download CSV match the page.                      |
| onboarding-vendor   | Mostly    | "Branding" listed as optional — the wizard agrees; assistant agrees.   |
| visitors            | Yes       | QR poster URL pattern confirmed.                                        |
| catalog-admin       | Yes       | Service codes + pricing tiers correct.                                  |
| notifications       | Yes       | Bell + inbox + per-event mute confirmed.                                |
| auth-context        | Yes       | Context picker copy matches the modal.                                 |
| field-home          | Yes       | Tickets-first layout + tracking toggle confirmed.                       |

**Drift risk.** The corpus is hand-written. As features are renamed
(e.g. "Bills to Pay" → "Payables") the docs have to be updated by
hand. There is no automated lint that flags a doc whose referenced
route doesn't exist. Filed as P2.

## 3. Tone & UX

The system prompt enforces:

- second-person, ≤180 word answers;
- no markdown tables in answers (markdown headings + bullets OK);
- one tool call per turn at most when the user is mid-flow;
- "I don't know" when the corpus is silent (mostly observed; see
  refusal heuristic below).

Sampled 60 turns across personas. Tone is consistent: warm, direct,
no jargon. The assistant correctly uses the persona's display name
("Hi Maria, …") when present in the session.

**Friction points observed:**

- The assistant occasionally answers in English when the user has
  toggled the UI to Spanish. The user-language hint is in the system
  prompt but the model sometimes ignores it on the first turn. P1.
- The launcher is hidden on `/signup` — intentional, but a fresh
  partner who lands on `/signup/partner` and gets stuck has no way to
  ask for help in-product. P1: surface a stripped-down "pre-auth"
  assistant or a help link on the signup pages.
- Refusals are sometimes terse ("I can't help with that.") without
  suggesting the *right* place. The refusal heuristic now lets us
  measure rate; copy improvement is P2.

## 4. Safety & Permissions

The assistant has three tools:

1. `complete_onboarding_step` — gated by persona × step × required
   payload keys. Reviewed in §1; safe.
2. `record_user_feedback` — appends to `assistant_feedback`. No PII
   leak surface; safe.
3. `deep_link_to` — returns a same-origin URL the UI navigates to.
   This was the **single P0 issue found** in the review:

   > Before: `deep_link_to({ screen: "admin-overview" })` from a vendor
   > session would happily return `/admin/overview`. The UI then
   > navigates and the server's per-route guards reject — but the
   > assistant has now mis-told the user "click here to view the admin
   > overview". This is bad UX and a soft information disclosure (the
   > vendor learns that route exists).

   **Fix shipped in this task.** A `ROLE_ALLOWED_SCREENS` map gates
   the tool: admin = no gate, partner / vendor / field_employee = an
   explicit allow list. Token-mode (field-employee deep-link login)
   callers are pinned to the field-employee allow list regardless of
   what the JWT claims. Disallowed screens return
   `{error: "screen not available for your role"}` and the UI shows
   that string instead of navigating.

Other safety checks reviewed:

- Session ownership on every conversation/message read & write — uses
  `requireSession` and a `userId` filter. OK.
- Admin-only `/api/assistant/metrics` — explicit `session.role ===
  "admin"` check, 403 otherwise. OK.
- Refusal heuristic is best-effort (English-only, first-paragraph
  only) — used only for telemetry. No user-visible decision is keyed
  off it.

## 5. Performance

Telemetry added in this task captures **time-to-first-token (TTFT)**
on every assistant turn (wall clock from the moment the request lands
on the server to the first text delta from Anthropic). Stored in
`assistant_messages.first_token_ms`. The admin metrics card surfaces
average + p95 + sample size for the trailing window.

Local seed sample (n=50, dev DB, claude-sonnet-4-5):

| Metric         | Value        |
|----------------|--------------|
| TTFT avg       | ~720 ms      |
| TTFT p95       | ~1.8 s       |
| Tool round-trip| 1–2 per turn |
| Total turn p95 | ~3.4 s       |

That's well inside the "feels fast" budget for streaming responses;
no perf P0/P1 work needed.

**Cost guards.** The model loop is capped at 6 tool rounds per turn,
and old conversations are pruned to the most recent N messages on
write. Per-message context is further trimmed to the most recent
`MAX_PRIOR_MESSAGES` before the model call.

---

## Backlog

| Priority | Item                                                                                          | Status                                |
|----------|-----------------------------------------------------------------------------------------------|---------------------------------------|
| **P0**   | `deep_link_to` should reject screens not in the caller's role allow list                      | **Fixed in this task (Task #472)**    |
| P1       | Pre-auth assistant on `/signup/partner` and `/signup/vendor` (or visible "need help?" link)   | Filed as Task #473                    |
| P1       | First-turn language adherence — assistant ignores Spanish UI toggle on opening turn           | Filed as Task #474                    |
| P1       | Eval harness in CI — replay a fixed prompt battery against the live model and assert language | **Shipped in Task #476** — see `docs/assistant-language-eval.md` |
| P2       | Knowledge-doc lint — fail build if a doc references a route that does not exist               | Filed as Task #475                    |
| P2       | Suggest optional onboarding steps (preferences / invite-team / vendor branding) instead of skipping | Rolled into Task #475 follow-up scope |
| P2       | Refusal copy improvement — when the model refuses, suggest the right place to look            | Rolled into Task #475 follow-up scope |

Test catalog: `artifacts/vndrly/tests/assistant.spec.ts` (`pnpm
--filter @workspace/vndrly run test`).

Telemetry endpoint: `GET /api/assistant/metrics?days=7` (admin only).

Admin metrics card: dashboard, top of page, visible only to admin
users.

## Deploy checklist

This task added two columns to `assistant_messages`:

- `first_token_ms` (integer, nullable) — captured at first text delta;
  null for tool-only turns and pre-existing rows.
- `refusal` (boolean, default `false`) — set when the assistant's
  first paragraph or first 300 chars matches the refusal regex in
  `classifyRefusal`.

Before promoting this branch to production:

1. Run `pnpm --filter @workspace/db push --force` against the prod
   database (or apply the equivalent generated migration). The
   `/api/assistant/metrics` aggregations select on these columns —
   without the schema change the avg/p95 TTFT and refusal counters
   will throw on the first admin dashboard load.
2. Smoke `GET /api/assistant/metrics` as an admin and confirm the
   response includes `ttftMs` and `refusalCount` keys (sample size
   may be 0 right after deploy; that's expected).
3. Verify the admin dashboard renders the "Assistant usage (last 7
   days)" card without errors. The card requests
   `/api/assistant/metrics?days=7` once on mount.

The endpoint is admin-gated (returns 401 unauthenticated, 403 for
partners/vendors/field employees) — see the `assistant.spec.ts`
live probe for the regression check.
