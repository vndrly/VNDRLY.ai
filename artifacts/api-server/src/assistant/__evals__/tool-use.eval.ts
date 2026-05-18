// Tool-use eval for the Ask VNDRLY assistant.
//
// `language.eval.ts` and `tone.eval.ts` only exercise single-turn
// text replies — they read the first `text` block of the response
// and walk away. Anything that happens through Claude's tool_use
// loop (the model calls a function, we run it, it continues) is
// completely unexercised by those suites.
//
// That matters because the production route in
// `routes/assistant.ts` advertises a small catalog of tools and
// relies on the model invoking them on intent: "show my open
// invoices" should produce a `lookup_open_invoices` tool_use,
// "take me to the dashboard" should produce a `deep_link_to`
// call with `screen: "dashboard"`, etc. A regression that breaks
// any of those — the model stops calling the lookup tool and
// hallucinates an answer, or it starts calling `deep_link_to`
// with a screen we never registered — would slip past the other
// nightly evals while degrading real users.
//
// This suite closes that gap by replaying a small fixed battery of
// prompts that should each trigger a specific tool, then asserting:
//
//   1. the model emitted at least one `tool_use` block,
//   2. the expected tool name was among them,
//   3. (where applicable) the arguments are well-formed —
//      `deep_link_to.screen` is one of the registered screens,
//      `set_onboarding_field.path` is a non-empty dot-path, etc.
//
// Like the other live-model suites this is OPT-IN and skips
// entirely unless ANTHROPIC_API_KEY is present. Run locally with:
//
//   ANTHROPIC_API_KEY=sk-ant-... \
//     pnpm --filter @workspace/api-server run eval:tool-use
//
// See docs/assistant-tool-use-eval.md for the full operational
// notes and the prompt-add procedure.

import { beforeAll, describe, expect, it } from "vitest";
import { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";

import { selectDocs, type KnowledgeRole } from "../knowledge";
import {
  buildSystemPrompt,
  composeAssistantMessages,
} from "../prompts/system";
import { DEEP_LINK_SCREENS, TOOLS } from "../tools";

// Same model the production route uses. If the route changes models,
// update this too — the eval should always exercise what ships.
const MODEL = "claude-sonnet-4-5";
// Tool-use turns are short — Claude usually just emits the tool_use
// block and a one-line preface — so 600 tokens is plenty without
// burning budget on chatty replies.
const MAX_TOKENS = 600;
// Per-call timeout. Cold model calls can occasionally take 20+ s; we
// leave generous headroom so a flaky network doesn't fail the suite.
const CALL_TIMEOUT_MS = 60_000;

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// Set of valid `deep_link_to.screen` values, hoisted out of the loop
// so the assertion stays a single Set lookup. Mirrors the enum in
// `assistant/tools.ts` — importing the constant keeps them in sync.
const SCREEN_SET = new Set<string>(DEEP_LINK_SCREENS);

// ──────────────────────────────────────────────────────────────────
// Tool-use battery.
//
// Each entry is a single user prompt that, given the persona, should
// trigger exactly one specific tool. Keep the battery small and
// orthogonal: there is no value in three prompts that all should
// fire `lookup_open_invoices`.
//
//   `expectTool` — the tool the model MUST invoke at least once in
//                  this turn. If the response has no tool_use blocks
//                  at all, or none with this name, the test fails.
//   `validateInput` — optional shape check for the matched call's
//                     `input` object. Useful for `deep_link_to`
//                     where the screen enum and id requirements
//                     matter; omit when the bare invocation is
//                     enough signal (e.g. `lookup_open_invoices`
//                     takes no arguments).
//
// Add a prompt by appending below; the suite picks it up on the
// next run.
// ──────────────────────────────────────────────────────────────────
interface ToolPrompt {
  q: string;
  role: KnowledgeRole;
  expectTool: string;
  // Returns null on success, or a human-readable failure string
  // describing what's wrong with `input`. Kept synchronous so test
  // failures point straight at the offending field.
  validateInput?: (input: unknown) => string | null;
}

const TOOL_PROMPTS: ToolPrompt[] = [
  {
    // Plain "show my open invoices" should fire the lookup.
    q: "Show me my open invoices.",
    role: "vendor",
    expectTool: "lookup_open_invoices",
  },
  {
    // Open-tickets equivalent. Phrased the way a partner would
    // actually ask — "in flight" matches the tool description's
    // phrasing without being a verbatim copy of it.
    q: "Which of my tickets are still in flight right now?",
    role: "partner",
    expectTool: "lookup_open_tickets",
  },
  {
    // Deep-link to a top-level screen the partner role can reach.
    // Asserts both that the model called `deep_link_to` AND that the
    // screen value is one we've actually registered. Catches a
    // regression where the model invents `tickets-board` or similar.
    q: "Just take me to the tickets list, please.",
    role: "partner",
    expectTool: "deep_link_to",
    validateInput: (input) => {
      if (!input || typeof input !== "object") return "input is not an object";
      const screen = (input as { screen?: unknown }).screen;
      if (typeof screen !== "string") return "screen is not a string";
      if (!SCREEN_SET.has(screen)) {
        return `screen '${screen}' is not in the registered enum`;
      }
      // We deliberately accept any reasonable interpretation of "the
      // tickets list" — `tickets` is the obvious target but a model
      // that picks `field-home` for a field employee shouldn't fail
      // here. The screen-set check above is the real assertion; this
      // narrower check just rules out a totally unrelated pick.
      const acceptable = new Set([
        "tickets",
        "ticket-detail",
        "site-locations",
      ]);
      if (!acceptable.has(screen)) {
        return `screen '${screen}' is not a plausible 'tickets list' target`;
      }
      return null;
    },
  },
  {
    // Deep-link with a required `id` argument. The prompt names the
    // vendor id explicitly ("#42") so a healthy model SHOULD call
    // `deep_link_to` and pass the id through. The argument-shape
    // assertion below catches both classes of regression: a missing
    // id on a detail screen (the route's `requireId` guard would
    // refuse to build a URL and the user would get an error toast),
    // and a screen value that isn't in the registered enum.
    q: "Open the analytics dashboard for my vendor org #42.",
    role: "vendor",
    expectTool: "deep_link_to",
    validateInput: (input) => {
      if (!input || typeof input !== "object") return "input is not an object";
      const screen = (input as { screen?: unknown }).screen;
      const id = (input as { id?: unknown }).id;
      if (typeof screen !== "string") return "screen is not a string";
      if (!SCREEN_SET.has(screen)) {
        return `screen '${screen}' is not in the registered enum`;
      }
      // If the model picked a detail screen, it MUST also pass an id.
      // The id-required screens are mirrored from the route's
      // `requireId` switch in `buildDeepLink`.
      const idRequired = new Set([
        "ticket-detail",
        "site-location-detail",
        "field-employee-detail",
        "vendor-detail",
        "partner-detail",
        "invoice-detail",
        "vendor-analytics",
        "partner-analytics",
        "crew-replay",
      ]);
      if (idRequired.has(screen)) {
        if (typeof id !== "number" || !Number.isFinite(id)) {
          return `screen '${screen}' requires a numeric id but got ${JSON.stringify(id)}`;
        }
      }
      return null;
    },
  },
  {
    // Onboarding state lookup. A partner mid-onboarding asking
    // "where am I?" should make the model fetch fresh progress
    // before answering — that's exactly the prompt the production
    // tool description tells the model to fire on.
    q: "Where am I in the onboarding wizard right now?",
    role: "partner",
    expectTool: "lookup_user_progress",
  },
  {
    // Field write — the model should call `set_onboarding_field`
    // with a sensible dot-path and a string value. Asserts the
    // arguments are well-formed; we don't constrain WHICH field is
    // written because there are several reasonable interpretations
    // ("companyName", "name", "company.name").
    q: "Please set my company name to Acme Roofing in my onboarding.",
    role: "partner",
    expectTool: "set_onboarding_field",
    validateInput: (input) => {
      if (!input || typeof input !== "object") return "input is not an object";
      const path = (input as { path?: unknown }).path;
      const value = (input as { value?: unknown }).value;
      if (typeof path !== "string" || path.length === 0) {
        return `path is not a non-empty string (got ${JSON.stringify(path)})`;
      }
      // Dot-path must look like an identifier-ish chain. Catches a
      // regression where the model passes a sentence ("my company
      // name") instead of a key.
      if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(path)) {
        return `path '${path}' does not look like a dot-path`;
      }
      if (typeof value !== "string" || value.length === 0) {
        return `value should be a non-empty string for company name (got ${JSON.stringify(value)})`;
      }
      // Loose match — the model may title-case "acme roofing" or
      // include the full phrase. Either way the value should
      // contain "acme".
      if (!/acme/i.test(value)) {
        return `value '${value}' does not contain 'acme'`;
      }
      return null;
    },
  },
];

function buildContext(role: KnowledgeRole) {
  // Tool-use is English-only by design — the language primer is
  // already exhaustively exercised in `language.eval.ts`. Keeping
  // this English-only also means the tool-call assertions don't have
  // to account for Spanish surface forms in any tool description
  // matching we might add later.
  return {
    userId: 1,
    role,
    displayName: role === "field_employee" ? "Maria" : "Alex",
    partnerId: role === "partner" ? 1 : null,
    vendorId: role === "vendor" ? 1 : null,
    preferredLanguage: "en" as const,
  };
}

// Single round-trip to Claude with the full production-shape envelope
// (system prompt + language primer messages + the registered tool
// catalog). Returns the raw content blocks so individual tests can
// inspect both `tool_use` and any `text` preface.
async function runOnce(
  client: Anthropic,
  q: string,
  role: KnowledgeRole,
): Promise<Anthropic.ContentBlock[]> {
  const user = buildContext(role);
  const docs = selectDocs(role, q, 6);
  const system = buildSystemPrompt({
    user,
    docs,
    onboarding: {
      // Pretend the user is mid-flow so the onboarding-related
      // prompts get a realistic system prompt. The wizard prompts
      // in `prompts/system.ts` add stronger nudges to call the
      // lookup tool when `active: true`.
      active: true,
      orgType: role === "partner" || role === "vendor" ? role : null,
      currentStep: "company-basics",
      completedSteps: [],
      skippedSteps: [],
    },
  });
  const messages = composeAssistantMessages("en", [
    { role: "user", content: q },
  ]);

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    // Hand the model the EXACT same tool catalog the production
    // route advertises. Importing TOOLS from `../tools` (the same
    // module the route uses) is what makes a regression there
    // surface as a real eval failure, not a snapshot mismatch.
    tools: TOOLS,
    // Cast: composeAssistantMessages is generic; the runtime shape
    // is exactly what the SDK accepts.
    messages: messages as Anthropic.MessageParam[],
  });

  return resp.content;
}

describe.skipIf(!HAS_KEY)("tool-use eval (live Anthropic)", () => {
  let client: Anthropic;

  beforeAll(() => {
    // Vanilla SDK client against api.anthropic.com — same reasoning
    // as `language.eval.ts`: lets a developer with their own raw
    // key run the eval without provisioning the in-product proxy.
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  });

  for (const prompt of TOOL_PROMPTS) {
    const { q, role, expectTool, validateInput } = prompt;
    it(
      `[${role}] tool=${expectTool}: ${q}`,
      async () => {
        const blocks = await runOnce(client, q, role);

        const toolUses = blocks.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
        );

        // A short text preface for context on failure. Truncated to
        // keep the failure message readable.
        const textPreface = blocks
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim()
          .slice(0, 300);

        expect(
          toolUses.length,
          `Model emitted no tool_use blocks at all.\n` +
            `--- prompt ---\n${q}\n--- text preface (first 300 chars) ---\n${textPreface}`,
        ).toBeGreaterThan(0);

        const matched = toolUses.find((tu) => tu.name === expectTool);
        expect(
          matched,
          `Expected tool '${expectTool}' but got [${toolUses
            .map((tu) => tu.name)
            .join(", ")}].\n` +
            `--- prompt ---\n${q}\n--- text preface (first 300 chars) ---\n${textPreface}`,
        ).toBeTruthy();

        if (validateInput && matched) {
          const failure = validateInput(matched.input);
          expect(
            failure,
            `Tool '${expectTool}' was called with bad arguments: ${failure}\n` +
              `--- input ---\n${JSON.stringify(matched.input, null, 2)}\n` +
              `--- prompt ---\n${q}`,
          ).toBeNull();
        }
      },
      CALL_TIMEOUT_MS,
    );
  }
});

// Same green-with-zero-tests guard as the language and tone evals —
// if someone accidentally empties the battery the suite would
// otherwise pass silently. This guard only runs when the gate is
// open.
describe.skipIf(!HAS_KEY)("tool-use eval — battery sanity", () => {
  it("battery is non-empty", () => {
    expect(TOOL_PROMPTS.length).toBeGreaterThanOrEqual(5);
  });

  // Defensive: if the production tool catalog ever shrinks below the
  // tools the battery names, the test names would still print but
  // every prompt would fail with a confusing "no matching tool"
  // message. Catch it here with a clearer error.
  it("expected tools are all registered", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const { expectTool } of TOOL_PROMPTS) {
      expect(
        names.has(expectTool),
        `Tool '${expectTool}' is not in the production catalog (TOOLS in src/assistant/tools.ts).`,
      ).toBe(true);
    }
  });
});
