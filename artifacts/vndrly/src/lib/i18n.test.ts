import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared test setup at src/test/setup.ts imports ../lib/i18n which
// initializes the singleton against jsdom's default navigator.language
// ("en-US"). To exercise first-visit detection against different browser
// locales we need to reset the module registry, stub navigator, clear
// localStorage, and re-import a fresh i18n instance per case.

// Capture the original property descriptors so afterEach can restore
// jsdom's defaults and avoid leaking stubbed getters into other suites.
const originalLanguageDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "language",
);
const originalLanguagesDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "languages",
);

async function loadI18nWith(opts: {
  navigatorLanguages: readonly string[];
  storedPreference?: string;
}): Promise<typeof import("./i18n").default> {
  vi.resetModules();
  window.localStorage.clear();
  if (opts.storedPreference !== undefined) {
    window.localStorage.setItem("vndrly_lang", opts.storedPreference);
  }
  // jsdom's navigator.language / .languages are read-only getters; redefine
  // them so i18next-browser-languagedetector picks our values up when it
  // runs during the fresh init below.
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    get: () => opts.navigatorLanguages,
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    get: () => opts.navigatorLanguages[0] ?? "en",
  });
  const mod = await import("./i18n");
  return mod.default;
}

describe("web i18n first-visit language detection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    // Reset modules so a later test that pulls in the shared singleton
    // (e.g. via setup.ts) re-initializes against a clean state, restore
    // navigator's original descriptors so we don't leak stubs into other
    // suites, and clear any storage we wrote.
    vi.resetModules();
    window.localStorage.clear();
    if (originalLanguageDescriptor) {
      Object.defineProperty(
        window.navigator,
        "language",
        originalLanguageDescriptor,
      );
    }
    if (originalLanguagesDescriptor) {
      Object.defineProperty(
        window.navigator,
        "languages",
        originalLanguagesDescriptor,
      );
    }
  });

  it("uses Spanish when the browser reports a Spanish locale on first visit", async () => {
    const i18n = await loadI18nWith({ navigatorLanguages: ["es-MX", "en-US"] });
    expect(i18n.resolvedLanguage).toBe("es");
  });

  it("accepts plain 'es' from navigator.language", async () => {
    const i18n = await loadI18nWith({ navigatorLanguages: ["es"] });
    expect(i18n.resolvedLanguage).toBe("es");
  });

  it("falls back to English when the browser language is unsupported", async () => {
    const i18n = await loadI18nWith({ navigatorLanguages: ["fr-FR", "de-DE"] });
    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("uses English when the browser reports an English locale", async () => {
    const i18n = await loadI18nWith({ navigatorLanguages: ["en-GB"] });
    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("honors a stored preference over the browser language on subsequent visits", async () => {
    const i18n = await loadI18nWith({
      navigatorLanguages: ["es-MX"],
      storedPreference: "en",
    });
    expect(i18n.resolvedLanguage).toBe("en");
  });

  it("honors a stored Spanish preference even when the browser is English", async () => {
    const i18n = await loadI18nWith({
      navigatorLanguages: ["en-US"],
      storedPreference: "es",
    });
    expect(i18n.resolvedLanguage).toBe("es");
  });
});
