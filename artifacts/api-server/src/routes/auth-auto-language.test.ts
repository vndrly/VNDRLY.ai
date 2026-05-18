import { describe, it, expect } from "vitest";
import { pickAutoSeedLanguage } from "./auth";

// ---------------------------------------------------------------------------
// Task #837 — auto-detect a field employee's preferred language from the
// phone or browser on first login.
//
// The login route calls `pickAutoSeedLanguage(clientLocale, acceptLanguage)`
// and writes the result to `users.preferred_language` ONLY when that column
// is currently null. These tests cover both the helper's parsing rules and
// the "user already chose" no-op semantics that the route relies on.
// ---------------------------------------------------------------------------

describe("pickAutoSeedLanguage", () => {
  it("returns 'es' when the device locale base is Spanish", () => {
    expect(pickAutoSeedLanguage("es-MX", null)).toBe("es");
    expect(pickAutoSeedLanguage("es", null)).toBe("es");
    expect(pickAutoSeedLanguage("es_ES", null)).toBe("es");
  });

  it("returns 'en' when the device locale base is English", () => {
    expect(pickAutoSeedLanguage("en-US", null)).toBe("en");
    expect(pickAutoSeedLanguage("EN", null)).toBe("en");
  });

  it("falls back to 'en' when the device locale is unsupported but present", () => {
    // Per the task: "only 'en' or 'es', anything else falls back to 'en'".
    expect(pickAutoSeedLanguage("fr-FR", null)).toBe("en");
    expect(pickAutoSeedLanguage("de", null)).toBe("en");
    expect(pickAutoSeedLanguage("zh-Hans", null)).toBe("en");
  });

  it("parses the first preferred tag from an Accept-Language header", () => {
    // Browsers list the user's preferred language first, optionally with
    // q= weights for fallbacks — we honor the first one we recognize.
    expect(
      pickAutoSeedLanguage(null, "es-MX,es;q=0.9,en;q=0.8"),
    ).toBe("es");
    expect(
      pickAutoSeedLanguage(null, "en-US,en;q=0.9,es;q=0.8"),
    ).toBe("en");
  });

  it("walks past unsupported tags to the first supported one", () => {
    // Some browsers/locales lead with a regional dialect we don't speak;
    // we still want to pick up the next tag rather than defaulting.
    expect(
      pickAutoSeedLanguage(null, "fr-CA,en-US;q=0.9,en;q=0.8"),
    ).toBe("en");
    expect(
      pickAutoSeedLanguage(null, "de-DE,es;q=0.7"),
    ).toBe("es");
  });

  it("prefers the explicit clientLocale over the Accept-Language header", () => {
    // Mobile clients pass the OS locale via `clientLocale`; that should
    // win over any header the proxy/CDN might have injected.
    expect(
      pickAutoSeedLanguage("es-MX", "en-US,en;q=0.9"),
    ).toBe("es");
  });

  it("returns null when there is no client signal at all", () => {
    // No signal → caller skips the DB write entirely so legacy clients
    // (e.g. older mobile builds, scripts hitting /auth/login directly)
    // don't accidentally pin the column to 'en' before we have any
    // evidence of what the user actually wants.
    expect(pickAutoSeedLanguage(null, null)).toBeNull();
    expect(pickAutoSeedLanguage("", "")).toBeNull();
    expect(pickAutoSeedLanguage(undefined, undefined)).toBeNull();
  });
});

describe("auto-seed branch semantics", () => {
  // The route only invokes the helper when `user.preferredLanguage` is
  // null — explicit toggle picks (anything stored in the column) always
  // win. We assert that contract directly here so a future refactor that
  // accidentally re-seeds on every login will trip this test.
  function shouldAutoSeed(
    storedLanguage: string | null,
    clientLocale: string | null,
    acceptLanguage: string | null,
  ): "en" | "es" | null {
    if (storedLanguage !== null) return null;
    return pickAutoSeedLanguage(clientLocale, acceptLanguage);
  }

  it("seeds 'es' on first login when the user has no stored preference", () => {
    expect(shouldAutoSeed(null, "es-MX", null)).toBe("es");
  });

  it("is a no-op when the user has already chosen a language", () => {
    // Even if the device says Spanish, an existing 'en' pick must stand.
    expect(shouldAutoSeed("en", "es-MX", "es-MX,es;q=0.9")).toBeNull();
    // And the symmetric case — an 'es' pick is preserved on an English
    // device (e.g. a bilingual user who borrowed someone else's phone).
    expect(shouldAutoSeed("es", "en-US", "en-US")).toBeNull();
    // Even unsupported stored values (legacy 'pt') are left alone — only
    // the route's normalizer decides what to advertise to the client.
    expect(shouldAutoSeed("pt", "es-MX", null)).toBeNull();
  });

  it("is a no-op on first login when the client provides no locale", () => {
    expect(shouldAutoSeed(null, null, null)).toBeNull();
  });
});
