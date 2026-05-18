import { describe, expect, it } from "vitest";
import { tokenModePreferredLanguage } from "./assistant";
import { composeAssistantMessages } from "../assistant/prompts/system";

// ---------------------------------------------------------------------------
// Regression: pre-auth (token-mode) field-employee assistant primes Spanish
// when `vendor_people.preferred_language` is "es".
//
// The first-turn language fix (Task #474) keys off the user's stored
// preference. For invitees who are still on the public onboarding page
// (`/onboarding/field/:token`) there is no `users` row yet, so the route
// reads `vendor_people.preferred_language` instead — populated when the
// invitee picks Español on the toggle.
//
// The token-mode handler in `assistant.ts` resolves that column via
// `tokenModePreferredLanguage(employee)` and feeds the result into
// `composeAssistantMessages(...)`. If a future refactor regresses either
// half of that wiring (e.g. drops the resolver back to a hard-coded
// `null`, or stops reading the column) the assistant would silently
// default to English even for Spanish-only invitees, which is exactly
// the bug Task #477 closes. These assertions pin both halves.
// ---------------------------------------------------------------------------

describe("token-mode assistant language priming", () => {
  it("resolves vendor_people.preferred_language='es' to 'es'", () => {
    expect(tokenModePreferredLanguage({ preferredLanguage: "es" })).toBe("es");
  });

  it("resolves vendor_people.preferred_language='en' to 'en'", () => {
    expect(tokenModePreferredLanguage({ preferredLanguage: "en" })).toBe("en");
  });

  it("falls back to null when the column is null (toggle untouched)", () => {
    expect(tokenModePreferredLanguage({ preferredLanguage: null })).toBeNull();
  });

  it("falls back to null defensively for an unrecognised value", () => {
    // Defense-in-depth: a corrupted or future-language value must
    // never blow up — the assistant just defaults to English.
    expect(tokenModePreferredLanguage({ preferredLanguage: "fr" })).toBeNull();
    expect(tokenModePreferredLanguage({ preferredLanguage: "" })).toBeNull();
  });

  it("emits a Spanish primer envelope when the column is 'es'", () => {
    // This is the actual end-to-end contract for token-mode: the
    // handler reads the column → resolves it → passes it to the same
    // message-composition helper used in post-auth chat. If the
    // resulting envelope doesn't carry the Spanish directive, the
    // first-turn-in-English regression is back.
    const employee = { preferredLanguage: "es" };
    const lang = tokenModePreferredLanguage(employee);
    const messages = composeAssistantMessages(lang, [
      { role: "user" as const, content: "Hola" },
    ]);

    // Two leading primer turns (synthetic user + assistant ack), then
    // the real user message — so the model sees prior conversation in
    // Spanish before its very first reply on this turn.
    expect(messages.length).toBe(3);
    const [primerUser, primerAssistant, realUser] = messages;
    expect(primerUser.role).toBe("user");
    expect(typeof primerUser.content === "string" && primerUser.content).toMatch(
      /reply in Spanish/i,
    );
    expect(primerAssistant.role).toBe("assistant");
    expect(typeof primerAssistant.content === "string" && primerAssistant.content).toMatch(
      /español/i,
    );
    expect(realUser).toEqual({ role: "user", content: "Hola" });
  });

  it("does NOT emit a primer envelope when the column is 'en' or null", () => {
    // English is Claude's default reply language, so emitting a primer
    // would just waste tokens. We assert both the explicit-English and
    // never-touched cases pass through untouched.
    for (const value of ["en", null] as const) {
      const lang = tokenModePreferredLanguage({ preferredLanguage: value });
      const messages = composeAssistantMessages(lang, [
        { role: "user" as const, content: "Hi" },
      ]);
      expect(messages).toEqual([{ role: "user", content: "Hi" }]);
    }
  });
});
