// Language-drift eval for the Ask VNDRLY assistant.
//
// Task #474 added unit tests that pin the system prompt's LANGUAGE
// directive and the buildLanguagePrimerMessages envelope, but those
// tests never call Claude — they only verify the prompt we send. This
// suite closes that gap by replaying a small fixed battery of prompts
// through the live model and asserting the response language matches
// the user's preferredLanguage.
//
// The suite is OPT-IN: it skips entirely unless ANTHROPIC_API_KEY is
// present in the environment. CI runs without the key (the default)
// will still pass — the eval is meant for nightly/manual runs.
//
// Importantly, this suite reuses `buildSystemPrompt`,
// `composeAssistantMessages`, and `selectDocs` from the production
// path so a regression in the assembly (e.g. someone trims the
// LANGUAGE block to save tokens, or drops the primer messages) shows
// up here as a real-world failure, not just a snapshot mismatch.
//
// Run locally:
//   ANTHROPIC_API_KEY=sk-ant-... \
//     pnpm --filter @workspace/api-server run eval
//
// See docs/assistant-language-eval.md for how to add prompts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Anthropic } from "@workspace/integrations-anthropic-ai/sdk";

import { selectDocs, type KnowledgeRole } from "../knowledge";
import {
  buildSystemPrompt,
  composeAssistantMessages,
} from "../prompts/system";
import { detectLanguage } from "./language-detector";

// Same model the production route uses. If the route changes models,
// update this too — the eval should always exercise what ships.
const MODEL = "claude-sonnet-4-5";
// Bound the response so a chatty turn doesn't burn budget. 512 tokens
// is plenty to detect language; the goal is not full answers.
const MAX_TOKENS = 512;
// Per-call timeout. Cold model calls can occasionally take 20+ s; we
// leave generous headroom so a flaky network doesn't fail the suite.
const CALL_TIMEOUT_MS = 60_000;

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

// ──────────────────────────────────────────────────────────────────
// Prompt battery. Ten realistic, persona-aligned questions covering
// the major surfaces (onboarding, tickets, invoices, crew, visitors,
// notifications, comments, language toggle). Each prompt runs twice:
// once with `preferredLanguage: "en"` and once with `"es"`. The
// English prompt text is held constant across both runs — that's the
// failure mode we want to catch (a Spanish-toggled user typing a few
// English words and getting an English reply).
//
// Add a prompt by appending an entry below; the suite will pick it
// up automatically on the next run. Keep the battery small (~10) so
// a full run stays under a minute and a few dollars of API spend.
// ──────────────────────────────────────────────────────────────────
interface EvalPrompt {
  q: string;
  role: KnowledgeRole;
}

const PROMPTS: EvalPrompt[] = [
  { q: "How do I finish my partner onboarding?", role: "partner" },
  { q: "Where do I see my open invoices?", role: "vendor" },
  { q: "How do I print visitor QR posters?", role: "partner" },
  { q: "How do I add a field employee?", role: "vendor" },
  { q: "Where can I see vendor analytics?", role: "vendor" },
  { q: "How do I update my profile photo?", role: "field_employee" },
  { q: "How do I see crew on the map?", role: "vendor" },
  { q: "Where do I review tickets pending approval?", role: "partner" },
  { q: "How do I add a comment to a ticket?", role: "field_employee" },
  { q: "How do I switch between English and Spanish?", role: "field_employee" },
];

function buildContext(role: KnowledgeRole, preferredLanguage: "en" | "es") {
  return {
    userId: 1,
    role,
    displayName: role === "field_employee" ? "Maria" : "Alex",
    partnerId: role === "partner" ? 1 : null,
    vendorId: role === "vendor" ? 1 : null,
    preferredLanguage,
  } as const;
}

// ──────────────────────────────────────────────────────────────────
// Per-prompt result rows captured during the run, then flushed to a
// JSON summary in `afterAll`. The trend dashboard (see
// `scripts/src/aggregate-language-eval.ts` and the workflow's
// "Append to history" step) consumes this file to build the trailing
// 30-day pass-rate view in the `assistant-language-eval-history`
// branch.
//
// We capture rows from inside `it` blocks via try/finally so a
// failing `expect()` still records the row (with `pass: false` and
// the wrong-language `detected` value) — that's the whole point of
// the trend, so missing failures here would defeat it.
// ──────────────────────────────────────────────────────────────────
interface SummaryRow {
  prompt: string;
  role: KnowledgeRole;
  language: "en" | "es";
  expected: "en" | "es";
  detected: "en" | "es" | "unknown" | null;
  pass: boolean;
  error?: string;
}

const summaryRows: SummaryRow[] = [];

// Resolved against vitest's cwd (the api-server package dir) so the
// CI workflow can pick up a stable relative path. Override with
// LANGUAGE_EVAL_SUMMARY_PATH when running ad hoc.
const SUMMARY_PATH = resolve(
  process.env.LANGUAGE_EVAL_SUMMARY_PATH ?? "./eval-summary.json",
);

describe.skipIf(!HAS_KEY)("language drift eval (live Anthropic)", () => {
  let client: Anthropic;

  beforeAll(() => {
    // Construct a vanilla SDK client against api.anthropic.com.
    // The integrations package exposes a pre-wired `anthropic` that
    // points at a hosted AI proxy, but importing it would crash
    // on machines without AI_INTEGRATIONS_ANTHROPIC_BASE_URL set
    // (which is the common case for a developer running this eval
    // locally with their own raw API key). Constructing our own
    // client keeps the eval self-contained.
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  });

  afterAll(() => {
    // Always write the summary, even on a failed suite — the trend
    // dashboard needs the failing rows just as much as the passing
    // ones. If no rows were captured (e.g. beforeAll itself blew
    // up) we still write an empty `results` array so the downstream
    // aggregator can distinguish "ran with zero data" from "didn't
    // run at all" (missing file).
    try {
      mkdirSync(dirname(SUMMARY_PATH), { recursive: true });
      writeFileSync(
        SUMMARY_PATH,
        JSON.stringify(
          {
            runAt: new Date().toISOString(),
            model: MODEL,
            results: summaryRows,
          },
          null,
          2,
        ),
        "utf8",
      );
    } catch (err) {
      // Don't mask a real eval failure with a write failure — log
      // and continue so the suite's exit code reflects the actual
      // assertion outcome.
      // eslint-disable-next-line no-console
      console.warn(
        `[language.eval] failed to write summary to ${SUMMARY_PATH}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  });

  for (const { q, role } of PROMPTS) {
    for (const lang of ["en", "es"] as const) {
      it(
        `[${lang}] ${role}: ${q}`,
        async () => {
          let detected: SummaryRow["detected"] = null;
          let pass = false;
          let error: string | undefined;
          try {
            const user = buildContext(role, lang);
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
            // Reuse the *production* envelope assembly so the primer
            // messages, not just the system prompt's LANGUAGE block,
            // are exercised.
            const messages = composeAssistantMessages(lang, [
              { role: "user", content: q },
            ]);

            const resp = await client.messages.create({
              model: MODEL,
              max_tokens: MAX_TOKENS,
              system,
              // Cast: composeAssistantMessages is generic over the
              // message shape (LanguagePrimerMessage and
              // Anthropic.MessageParam both satisfy it). The runtime
              // shape is exactly what the SDK accepts.
              messages: messages as Anthropic.MessageParam[],
            });

            const text = resp.content
              .filter((b): b is Anthropic.TextBlock => b.type === "text")
              .map((b) => b.text)
              .join("\n")
              .trim();

            expect(text.length, "model returned no text content").toBeGreaterThan(0);

            detected = detectLanguage(text);
            expect(
              detected,
              `Expected reply in ${lang} but detected ${detected}.\n` +
                `--- prompt ---\n${q}\n--- reply (first 400 chars) ---\n${text.slice(0, 400)}`,
            ).toBe(lang);
            pass = true;
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
            throw err;
          } finally {
            summaryRows.push({
              prompt: q,
              role,
              language: lang,
              expected: lang,
              detected,
              pass,
              ...(error ? { error: error.slice(0, 500) } : {}),
            });
          }
        },
        CALL_TIMEOUT_MS,
      );
    }
  }
});

// When the gate is open but no prompts somehow load (file edited in a
// bad way), we still want a clear failure rather than a green-with-
// zero-tests false positive. This guard only runs when we have a key.
describe.skipIf(!HAS_KEY)("language drift eval — battery sanity", () => {
  it("battery is non-empty", () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(10);
  });
});
