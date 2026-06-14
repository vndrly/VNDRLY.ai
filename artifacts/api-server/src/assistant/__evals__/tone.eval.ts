// Tone & refusal eval for the Ask VNDRLY assistant.
//
// Task #476 shipped the language-drift eval (see `language.eval.ts`)
// which proved that opt-in live-model evals are a good fit for
// failure modes that unit tests can't catch. The original Task #472
// review (`docs/assistant-review.md` §3) flagged two more such
// failure modes that this suite covers:
//
//   1. TONE — the system prompt asks for second-person, ≤180-word,
//      table-free replies. A future change that quietly weakens the
//      GROUND RULES (or a model swap that ignores them) would only
//      show up at runtime. We assert word-count and reject markdown
//      table syntax in the response.
//
//   2. REFUSAL CORRECTNESS — when the assistant declines a request
//      because of role/scope, the review §3 specifically called out
//      that refusals were "sometimes terse … without suggesting the
//      *right* place." We replay role-scoped out-of-scope prompts
//      and assert the reply both trips the production
//      `classifyRefusal` heuristic AND names a real screen the user
//      could be pointed to instead.
//
// Like `language.eval.ts`, this suite is OPT-IN and skips entirely
// unless ANTHROPIC_API_KEY is present. Run locally with:
//
//   ANTHROPIC_API_KEY=sk-ant-... \
//     pnpm --filter @workspace/api-server run eval
//
// See docs/assistant-tone-eval.md for how to add prompts.

import { beforeAll, describe, expect, it } from "vitest";
import { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";

import { selectDocs, type KnowledgeRole } from "../knowledge";
import {
  buildSystemPrompt,
  composeAssistantMessages,
} from "../prompts/system";
import { classifyRefusal } from "../refusal";

// Same model the production route uses. If the route changes models,
// update this too — the eval should always exercise what ships.
const MODEL = "claude-sonnet-4-5";
// Bound the response so a chatty turn doesn't burn budget. 600 tokens
// is comfortably above the ≤180-word target and still cheap.
const MAX_TOKENS = 600;
// Per-call timeout. Cold model calls can occasionally take 20+ s; we
// leave generous headroom so a flaky network doesn't fail the suite.
const CALL_TIMEOUT_MS = 60_000;

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// ──────────────────────────────────────────────────────────────────
// Tone target.
//
// `docs/assistant-review.md` §3 documents the soft target as "≤180
// word answers". The system prompt itself uses the looser phrasing
// "1-3 paragraphs unless the user explicitly asks for detail", so we
// give the model headroom (~22%) before failing the assert. Step-by-
// step vendor how-tos (e.g. create + assign a ticket) routinely land
// in the low 200s; 240+ on a non-detail request is the real regression.
// ──────────────────────────────────────────────────────────────────
const MAX_WORDS = 220;

// Markdown table detection. Two complementary patterns:
//   - The pipe-separator row (`| --- | --- |`) is unambiguous —
//     prose almost never looks like that.
//   - Two consecutive lines that both start AND end with a `|` is
//     the GFM table body shape; prose with inline pipes won't match
//     because we anchor on both ends of the line.
// Either pattern is enough to fail the assert.
function containsMarkdownTable(text: string): boolean {
  const sepRe = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/m;
  if (sepRe.test(text)) return true;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i].trim();
    const b = lines[i + 1].trim();
    if (
      a.startsWith("|") &&
      a.endsWith("|") &&
      b.startsWith("|") &&
      b.endsWith("|")
    ) {
      return true;
    }
  }
  return false;
}

// Whitespace-tokenised word count. Markdown bullets, code spans, and
// inline links all collapse to single tokens — close enough for a
// "≤180 words" guardrail. We strip code fences first so a snippet
// inside a fenced block doesn't dilute the count.
function wordCount(text: string): number {
  const stripped = text.replace(/```[\s\S]*?```/g, " ");
  const tokens = stripped.trim().split(/\s+/).filter(Boolean);
  return tokens.length;
}

// ──────────────────────────────────────────────────────────────────
// Tone battery. In-scope, persona-aligned questions where a healthy
// reply should be a couple of short paragraphs and never a table.
// Each prompt asserts: word count ≤ MAX_WORDS AND no markdown table.
// ──────────────────────────────────────────────────────────────────
interface TonePrompt {
  q: string;
  role: KnowledgeRole;
}

const TONE_PROMPTS: TonePrompt[] = [
  { q: "How do I open a ticket and assign a crew?", role: "vendor" },
  { q: "Where do I see my open invoices?", role: "vendor" },
  { q: "How do I print visitor QR posters?", role: "partner" },
  { q: "How do I update my profile photo?", role: "field_employee" },
  { q: "How do I review tickets pending approval?", role: "partner" },
];

// ──────────────────────────────────────────────────────────────────
// Refusal battery. Each prompt is something the caller's role
// genuinely cannot do, so the model SHOULD refuse.
//
// Two-part expectation per prompt — both required, not "either":
//   - `expectScreens` is the primary assertion. It MUST contain at
//     least one regex that names a real, concrete screen label or
//     slug (e.g. "Vendor analytics", "field employees", "bills to
//     pay"). A refusal that says only "ask your admin" without ever
//     naming a screen is exactly the friction the §3 review flagged
//     as "terse refusals without suggesting the *right* place," so
//     we deliberately do not allow generic role nouns to satisfy
//     this assertion.
//   - `expectRoleHint` is an optional secondary list. When set, the
//     reply must ALSO name a role/person to ask (e.g. "vendor admin",
//     "your account admin"). Used when the screen is gated AND the
//     caller would need help from a different role to use it. We
//     keep this list explicit instead of folding role mentions into
//     `expectScreens` so a future eval reader can tell at a glance
//     what each regex is asserting.
// ──────────────────────────────────────────────────────────────────
interface RefusalPrompt {
  q: string;
  role: KnowledgeRole;
  expectScreens: RegExp[];
  expectRoleHint?: RegExp[];
}

const REFUSAL_PROMPTS: RefusalPrompt[] = [
  {
    // A field employee asking about a vendor-admin-only dashboard.
    // The screen is concretely named "Vendor analytics" in the
    // knowledge docs; the field employee can't see it themselves so
    // the reply should also point them at the vendor admin.
    q: "Pull up the vendor analytics dashboard for me right now.",
    role: "field_employee",
    expectScreens: [/vendor\s+analytics/i, /analytics\s+dashboards?/i],
    expectRoleHint: [/vendor\s+admin/i, /\badmin\b/i, /your\s+(vendor|admin)/i],
  },
  {
    // A vendor asking for an admin-only screen. There IS a real
    // master-catalog screen for admins (referenced in the knowledge
    // docs); the assistant should name it (or the analytics
    // dashboard) rather than just refuse.
    q: "Open the master catalog so I can manage every service code.",
    role: "vendor",
    expectScreens: [
      /master\s+catalog/i,
      /vendor\s+catalog/i,
      /\bcatalog\b/i,
    ],
  },
  {
    // A field employee asking for a vendor management surface. The
    // concrete screen is "Field employees" (vendor-only); we want
    // the reply to name it AND tell the field employee who to ask.
    q: "I want to add a new field employee to my vendor org.",
    role: "field_employee",
    expectScreens: [/field[\s-]?employees?/i],
    expectRoleHint: [/vendor\s+admin/i, /\badmin\b/i, /your\s+(vendor|admin)/i],
  },
  {
    // A partner asking for a vendor-only invoices view. Real partner
    // screens that handle the same money flow are "Bills to Pay",
    // "Payables", and "Statements" — any of them is a useful
    // pointer.
    q: "Show me the invoices my vendor has sent out this month.",
    role: "partner",
    expectScreens: [
      /bills\s+to\s+pay/i,
      /\bpayables?\b/i,
      /\bstatements?\b/i,
    ],
  },
];

function buildContext(role: KnowledgeRole) {
  // Tone & refusal evals only need the English path — the language
  // primer is exhaustively exercised in `language.eval.ts`. Keeping
  // this English-only also keeps the refusal heuristic reliable
  // (`classifyRefusal` is English-only by design).
  return {
    userId: 1,
    role,
    displayName: role === "field_employee" ? "Maria" : "Alex",
    partnerId: role === "partner" ? 1 : null,
    vendorId: role === "vendor" ? 1 : null,
    preferredLanguage: "en" as const,
  };
}

async function runOnce(client: Anthropic, q: string, role: KnowledgeRole) {
  const user = buildContext(role);
  const docs = selectDocs(role, q, 6);
  const system = buildSystemPrompt({
    user,
    docs,
    onboarding: {
      active: false,
      orgType: null,
      currentStep: null,
      completedSteps: [],
      skippedSteps: [],
    },
  });
  // Reuse the *production* envelope assembly so a regression in the
  // primer messages or the system block surfaces here, not just in
  // a snapshot.
  const messages = composeAssistantMessages("en", [
    { role: "user", content: q },
  ]);

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    // Cast: composeAssistantMessages is generic; the runtime shape
    // is exactly what the SDK accepts.
    messages: messages as Anthropic.MessageParam[],
  });

  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

describe.skipIf(!HAS_KEY)("tone eval (live Anthropic)", () => {
  let client: Anthropic;

  beforeAll(() => {
    // Vanilla SDK client against api.anthropic.com — same reasoning
    // as `language.eval.ts`: lets a developer with their own raw
    // key run the eval without provisioning the in-product proxy.
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  });

  for (const { q, role } of TONE_PROMPTS) {
    it(
      `[${role}] tone: ${q}`,
      async () => {
        const text = await runOnce(client, q, role);
        expect(text.length, "model returned no text content").toBeGreaterThan(0);

        const words = wordCount(text);
        expect(
          words,
          `Reply exceeded ${MAX_WORDS}-word tone target (got ${words}).\n` +
            `--- prompt ---\n${q}\n--- reply (first 400 chars) ---\n${text.slice(0, 400)}`,
        ).toBeLessThanOrEqual(MAX_WORDS);

        expect(
          containsMarkdownTable(text),
          `Reply contained markdown table syntax — GROUND RULES forbid tables.\n` +
            `--- prompt ---\n${q}\n--- reply (first 400 chars) ---\n${text.slice(0, 400)}`,
        ).toBe(false);
      },
      CALL_TIMEOUT_MS,
    );
  }
});

describe.skipIf(!HAS_KEY)("refusal eval (live Anthropic)", () => {
  let client: Anthropic;

  beforeAll(() => {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  });

  for (const { q, role, expectScreens, expectRoleHint } of REFUSAL_PROMPTS) {
    it(
      `[${role}] refusal: ${q}`,
      async () => {
        const text = await runOnce(client, q, role);
        expect(text.length, "model returned no text content").toBeGreaterThan(0);

        // 1. Production heuristic must trip — confirms the model
        //    actually refused rather than silently making up an
        //    answer or pretending to take an action.
        expect(
          classifyRefusal(text),
          `Expected a refusal but classifyRefusal returned false.\n` +
            `--- prompt ---\n${q}\n--- reply (first 400 chars) ---\n${text.slice(0, 400)}`,
        ).toBe(true);

        // 2. Refusal copy must name at least one concrete screen
        //    (not a generic role noun) — closes the §3 review item
        //    that refusals were sometimes terse and unhelpful.
        const matchedScreen = expectScreens.some((re) => re.test(text));
        expect(
          matchedScreen,
          `Refusal didn't name any expected screen (${expectScreens
            .map((r) => r.source)
            .join(", ")}).\n` +
            `--- prompt ---\n${q}\n--- reply (first 400 chars) ---\n${text.slice(0, 400)}`,
        ).toBe(true);

        // 3. (Optional) When the prompt is for a screen the caller
        //    can't reach themselves, the reply must ALSO point at
        //    the role/person to ask. Asserted separately from the
        //    screen check so a test failure tells you exactly which
        //    half of the refusal copy is missing.
        if (expectRoleHint) {
          const matchedRoleHint = expectRoleHint.some((re) => re.test(text));
          expect(
            matchedRoleHint,
            `Refusal didn't name a role to ask (${expectRoleHint
              .map((r) => r.source)
              .join(", ")}).\n` +
              `--- prompt ---\n${q}\n--- reply (first 400 chars) ---\n${text.slice(0, 400)}`,
          ).toBe(true);
        }
      },
      CALL_TIMEOUT_MS,
    );
  }
});

// Same green-with-zero-tests guard as language.eval.ts — if someone
// accidentally empties either battery the suite would otherwise pass
// silently. This guard only runs when the gate is open.
describe.skipIf(!HAS_KEY)("tone & refusal eval — battery sanity", () => {
  it("tone battery is non-empty", () => {
    expect(TONE_PROMPTS.length).toBeGreaterThanOrEqual(3);
  });
  it("refusal battery is non-empty", () => {
    expect(REFUSAL_PROMPTS.length).toBeGreaterThanOrEqual(3);
  });
});
