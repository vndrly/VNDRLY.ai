// Unit tests for the lightweight language detector used by the
// language-drift eval. These tests run on every `pnpm test` (no API
// key required) so a regression in the detector itself is caught
// before the eval relies on it.
//
// The detector is intentionally tiny — diacritic count + stop-word
// overlap. We assert the obvious cases (clearly English, clearly
// Spanish, mixed-but-one-side-dominates) and that genuinely
// ambiguous input returns "unknown" rather than guessing.

import { describe, expect, it } from "vitest";

import { detectLanguage } from "./language-detector";

describe("detectLanguage", () => {
  it("classifies plain English", () => {
    const text =
      "To finish your partner onboarding, open the dashboard and click the Finish setting up banner. The wizard will walk you through the remaining steps.";
    expect(detectLanguage(text)).toBe("en");
  });

  it("classifies plain Spanish", () => {
    const text =
      "Para terminar el registro de socio, abre el panel y haz clic en el banner Finalizar configuración. El asistente te guiará por los pasos restantes.";
    expect(detectLanguage(text)).toBe("es");
  });

  it("uses diacritics as a strong Spanish signal", () => {
    // Short utterance with no English stopwords but ñ + ¿ + accents.
    const text = "¿Cómo añado un técnico de campo?";
    expect(detectLanguage(text)).toBe("es");
  });

  it("classifies an English answer that mentions a Spanish UI label", () => {
    const text =
      "To switch the interface to Spanish, open Settings and choose 'Español' from the language dropdown. The app will reload in Spanish.";
    expect(detectLanguage(text)).toBe("en");
  });

  it("classifies a Spanish answer that quotes an English label", () => {
    const text =
      "Para crear un ticket nuevo, abre la pestaña 'Tickets' y haz clic en el botón 'New ticket'. El sistema te pedirá que selecciones el sitio.";
    expect(detectLanguage(text)).toBe("es");
  });

  it("returns 'unknown' for empty / non-textual input", () => {
    expect(detectLanguage("")).toBe("unknown");
    expect(detectLanguage("12345 67890")).toBe("unknown");
  });
});
