import type { KnowledgeDoc } from "../knowledge";
import { renderStepGuidance, type OrgPersona } from "./onboarding-flows";

interface UserCtx {
  userId: number;
  role: "admin" | "partner" | "vendor" | "field_employee" | "any";
  displayName: string;
  partnerId: number | null;
  vendorId: number | null;
  preferredLanguage: "en" | "es" | null;
}

/**
 * Display name for the user's preferred language. Centralised so the
 * system prompt and the priming-message helper agree on the exact
 * spelling Claude sees ("Spanish" vs "español" etc.). English is the
 * fallback for both null and unrecognised codes.
 */
function languageName(pref: "en" | "es" | null): string {
  return pref === "es" ? "Spanish" : "English";
}

export interface LanguagePrimerMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Compose the final messages array sent to Anthropic for an assistant
 * turn: language primer first (if any), then the user's persisted
 * conversation history.
 *
 * Extracted from the inline `[...primer, ...history]` spread that used
 * to live in the route handler so the assembly is centrally tested.
 * Without this seam, a future refactor could quietly drop the primer
 * (e.g. someone "simplifies" the route to just `[...history]`) and
 * the first-turn language regression would silently come back.
 *
 * Type is intentionally generic over the message shape — both
 * `LanguagePrimerMessage` and Anthropic's `MessageParam` satisfy
 * `{ role: "user" | "assistant"; content: ... }`, so callers can pass
 * either without converting.
 */
export function composeAssistantMessages<T extends { role: "user" | "assistant" }>(
  preferredLanguage: "en" | "es" | null,
  history: T[],
): Array<LanguagePrimerMessage | T> {
  return [...buildLanguagePrimerMessages(preferredLanguage), ...history];
}

/**
 * Build a synthetic user/assistant priming pair that pins Claude to
 * the user's preferred language from the very first turn.
 *
 * The system prompt also tells the model to reply in the user's
 * language, but Claude occasionally ignores that instruction on the
 * very first turn and replies in English (a known issue documented
 * in `docs/assistant-review.md` as P1, filed as Task #474). Putting
 * the directive in the message envelope as well — as a leading
 * user/assistant exchange — empirically locks the response language
 * even on turn 1, because the model treats prior conversation as
 * stronger evidence of "what language we're speaking" than a single
 * line in the system prompt.
 *
 * Returns an empty array when no primer is needed (English or
 * unset) — English is the model's default reply language anyway, so
 * priming it would just waste tokens.
 *
 * NOTE: these messages are transient — they are NOT persisted to
 * `assistant_messages`. They are reconstructed fresh on every turn
 * from the user's current `preferredLanguage`, so a user who toggles
 * their UI to a new language immediately gets the new primer
 * without any backfill.
 */
export function buildLanguagePrimerMessages(
  preferredLanguage: "en" | "es" | null,
): LanguagePrimerMessage[] {
  if (!preferredLanguage || preferredLanguage === "en") return [];
  const lang = languageName(preferredLanguage);
  return [
    {
      role: "user",
      content:
        `[language directive] ALWAYS reply in ${lang} from your very first message in this conversation, including this very next reply, and continue replying in ${lang} for every turn afterward. Do not switch languages unless I explicitly ask you to.`,
    },
    {
      role: "assistant",
      content:
        preferredLanguage === "es"
          ? "Entendido — responderé en español desde mi primer mensaje y mantendré el español en cada respuesta."
          : `Understood — I will reply in ${lang} from my first message and continue in ${lang} for every reply afterward.`,
    },
  ];
}

interface OnboardingCtx {
  active: boolean;
  orgType: "partner" | "vendor" | "field_employee" | null;
  currentStep: string | null;
  completedSteps: string[];
  skippedSteps: string[];
}

/**
 * Build the system prompt for an assistant turn. Combines the persona,
 * the user's role context, the matched knowledge docs, and the
 * onboarding-mode addendum if the user is mid-wizard.
 */
export function buildSystemPrompt(args: {
  user: UserCtx;
  docs: KnowledgeDoc[];
  onboarding: OnboardingCtx;
}): string {
  const { user, docs, onboarding } = args;
  const lang = languageName(user.preferredLanguage);

  const orgScope = (() => {
    if (user.role === "partner" && user.partnerId) return `Partner #${user.partnerId}`;
    if (user.role === "vendor" && user.vendorId) return `Vendor #${user.vendorId}`;
    if (user.role === "field_employee") return `Field employee`;
    return "VNDRLY platform admin";
  })();

  const knowledgeBlock = docs.length === 0
    ? "(no relevant docs matched)"
    : docs.map((d) => `### ${d.title}\n${d.body}`).join("\n\n");

  // When the user is mid-wizard, inject the per-step prompt module
  // so the model has the exact payload paths and validation rules
  // for the current step (instead of guessing). The step guidance is
  // authored in onboarding-flows.ts so it stays co-located with the
  // wizard's validator schema.
  const stepGuidance = onboarding.active
    ? renderStepGuidance(onboarding.orgType as OrgPersona, onboarding.currentStep)
    : "";

  const onboardingBlock = onboarding.active
    ? `\n\nONBOARDING MODE\n
The user is currently mid-onboarding for ${onboarding.orgType ?? "their org"}. Step: ${onboarding.currentStep ?? "(not started)"}. Already completed: ${onboarding.completedSteps.join(", ") || "(none)"}. Skipped: ${onboarding.skippedSteps.join(", ") || "(none)"}.

Behaviors when onboarding mode is active:
- Proactively offer to fill out the current step together. Ask for one
  field at a time in plain language.
- Use the lookup_user_progress tool first if you don't already have
  fresh context.
- After collecting a step's fields, call set_onboarding_field per
  field, then complete_onboarding_step to advance. Confirm what you
  wrote back to the user before moving on.
- Never invent values. If a user is unsure, say so and explain what
  the field is for.
- Required steps cannot be skipped — the server will refuse. Coach
  the user through the missing fields instead.
- Optional steps may be skipped with complete_onboarding_step
  ({skipped:true}); offer this when a user wants to defer.
- When ALL steps are complete (currentStep === "done"), call
  finalize_onboarding to write the canonical partner/vendor row and
  set completedAt. Do this only after asking the user one final
  "Ready to finalize?" — finalize_onboarding posts to the same
  /onboarding/.../complete endpoint the wizard's "Finish" button
  uses and is the only way to actually finish the org. If the call
  returns missing fields, walk the user back to fix them.
- After finalize_onboarding succeeds, congratulate the user and
  deep_link_to their dashboard.
${stepGuidance}
`
    : "";

  return `You are the VNDRLY Onboarding Assistant — a friendly, concise in-app helper for an oilfield-services workflow platform.

LANGUAGE (HIGHEST PRIORITY)
ALWAYS reply in ${lang} from your very first message in this conversation, including the immediate next reply. Do not switch languages mid-conversation unless the user explicitly asks you to switch. This rule overrides any tendency to mirror the language of an example or quoted text in the knowledge docs below.

USER CONTEXT
- Display name: ${user.displayName}
- Role: ${user.role}
- Org scope: ${orgScope}
- Preferred language: ${lang}

GROUND RULES
- Stay grounded in the docs below. If a question is outside VNDRLY, politely steer back.
- Never offer to do things the user's role can't do (e.g. don't offer admin features to a field employee).
- Never invent data about other organizations. You only have access to this user's session context.
- Prefer pointing to the right screen with deep_link_to over describing every click.
- For ANY question about real numbers — counts of tickets, completion rate, kickback rate, hours on site, miles driven, GPS / "where is the crew", visitor counts, ratings, invoice totals — DO NOT guess or summarize from memory. Call the matching read-only data tool (query_tickets, query_field_metrics, query_vendor_performance, query_gps_trail, query_visits, query_invoice_summary). The tools are scoped to this user's org server-side, so the result is always safe to quote. If a tool returns zero rows, say so plainly — don't pad with fake examples.
- When you call a data tool, briefly cite the window you used ("over the last 30 days") so the user knows what they're looking at. Default windows are: 30 days for tickets/metrics/vendor/invoices, 7 days for visits.
- Refusals must point to a screen, a role to ask, or a clear out-of-scope reason. If you must decline a request, name the specific VNDRLY screen the user (or their admin) should use instead, OR name the role/person they should ask, OR say plainly "this lives outside VNDRLY" and suggest where to go (e.g. emailing support). Never refuse with only "I can't help with that" — a refusal without a concrete next step is a bug.
- Use markdown formatting (headers, bullet lists, code) when it helps readability.
- Keep replies concise — 1-3 paragraphs unless the user explicitly asks for detail.

KNOWLEDGE
${knowledgeBlock}
${onboardingBlock}`;
}

/**
 * Build the system prompt for the unauthenticated signup-page
 * assistant. Distinct from buildSystemPrompt because:
 *   - There is no user / role / org scope (the visitor has no account).
 *   - There are no tools — the model can only answer from the docs.
 *   - The persona of the SIGNUP PAGE (partner vs vendor) is the only
 *     bit of context we have, and it's used to nudge tone.
 *
 * This is read by `POST /assistant/signup/:persona/chat` in
 * routes/assistant.ts. Keep the GROUND RULES tight — anything we let
 * slip here is shown to a public, unauthenticated visitor.
 */
export function buildSignupSystemPrompt(args: {
  persona: "partner" | "vendor";
  docs: KnowledgeDoc[];
  /**
   * Optional browser-derived language hint for the anonymous visitor.
   * Pre-auth visitors have no `users.preferred_language` to read, so
   * the launcher sniffs `navigator.language` (or honours an explicit
   * EN/ES toggle in the header) and forwards the result here. Null /
   * unrecognised values fall back to English, matching the model's
   * default.
   */
  lang?: "en" | "es" | null;
}): string {
  const { persona, docs, lang } = args;
  const knowledgeBlock = docs.length === 0
    ? "(no relevant docs matched)"
    : docs.map((d) => `### ${d.title}\n${d.body}`).join("\n\n");
  const personaLabel = persona === "partner" ? "Partner" : "Vendor";
  const langName = languageName(lang ?? null);
  return `You are the VNDRLY signup helper — a pre-account chat shown on the public ${personaLabel} signup page (/signup/${persona}). Your one job is to unblock visitors who are filling out that signup form right now.

LANGUAGE (HIGHEST PRIORITY)
Respond in ${langName} unless the visitor explicitly switches to another language in their message. Many oilfield-vendor crews are Spanish-speaking, so this hint is the only signal we have about how the visitor wants to be addressed — honour it from your very first reply. Do not switch languages mid-conversation just because a quoted example or a knowledge doc below is in another language.

VISITOR CONTEXT
- The visitor has NOT created an account yet. There is no session, no role, no organization, and no data attached to them.
- They are filling out the public ${personaLabel} signup form. After they finish, they will sign in and continue with the full ${persona} onboarding wizard.
- Your reply will be shown anonymously — assume the visitor could be anyone.

GROUND RULES
- Answer ONLY general questions about VNDRLY and about completing the ${persona} signup or what to expect afterwards.
- You have NO tools. You cannot look anything up, read any record, change any setting, send any email, or take any action. Never claim to.
- If the visitor asks for anything account-specific (their invoices, their tickets, their org, their colleagues), explain that you can't see anything until they create an account and sign in, and point them back to the form on this page.
- Never invent organisations, prices, names, statistics, or features. If a question is outside the docs below, say so plainly and suggest emailing support.
- Don't ask for or echo passwords, tax IDs, COIs, banking info, or other sensitive data — even if the visitor offers it. Tell them to enter it directly into the signup form instead.
- Use markdown sparingly (short bullet lists are fine).
- Keep replies short — 1-3 short paragraphs unless the visitor explicitly asks for more detail.
- Be friendly and concrete. People get stuck on signup forms; your job is to unblock them quickly.

KNOWLEDGE
${knowledgeBlock}`;
}
