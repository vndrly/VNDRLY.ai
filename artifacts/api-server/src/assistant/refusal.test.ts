// Unit pin for the refusal heuristic. The eval harness relies on
// `classifyRefusal` matching the production regex exactly, so a
// silent loosening here would cause the tone eval's refusal asserts
// to either trip on every reply or ignore real regressions. The
// metrics card on the admin dashboard also depends on the
// distribution of true/false this returns.

import { describe, expect, it } from "vitest";

import { classifyRefusal } from "./refusal";

describe("classifyRefusal", () => {
  it("returns false for empty input", () => {
    expect(classifyRefusal("")).toBe(false);
  });

  it("matches a direct first-paragraph refusal", () => {
    expect(
      classifyRefusal("I can't help with that. Try the support page."),
    ).toBe(true);
  });

  it("matches an apologetic refusal", () => {
    expect(classifyRefusal("I'm sorry, that's outside my scope.")).toBe(true);
  });

  it("matches a polite-greeting + refusal head pattern", () => {
    // The route comment explicitly calls out this Claude pattern
    // (warm opener, then refusal in the next paragraph). The
    // first-300-char window must catch it even though the first
    // paragraph alone wouldn't.
    const reply =
      "Hi Maria, happy to help!\n\nUnfortunately, I don't have " +
      "access to vendor analytics from a field-employee account. " +
      "Ask your vendor admin to share the dashboard.";
    expect(classifyRefusal(reply)).toBe(true);
  });

  it("does not flag a long correct answer that contains 'I don't have' deep in the body", () => {
    const reply =
      "To file a ticket, open the Tickets screen and tap New ticket.\n\n" +
      "Fill in the site, service, and any photos.\n\n" +
      "If you don't have a site picked yet, you can still save a draft." +
      " ".repeat(200) +
      " I don't have to remind you to attach photos when relevant.";
    expect(classifyRefusal(reply)).toBe(false);
  });

  it("does not flag a normal helpful reply", () => {
    expect(
      classifyRefusal(
        "Open the Tickets screen and tap a row to see the status stepper.",
      ),
    ).toBe(false);
  });

  // Spanish branch — keeps the admin metrics card honest for
  // Spanish-toggled crew members. Without these, a refusal in
  // Spanish would silently count as a helpful reply.
  it("matches a direct Spanish refusal ('no puedo')", () => {
    expect(
      classifyRefusal("No puedo ayudarte con eso. Habla con tu admin."),
    ).toBe(true);
  });

  it("matches a Spanish 'no tengo acceso' refusal", () => {
    expect(
      classifyRefusal(
        "No tengo acceso a la analítica del proveedor desde una cuenta de campo.",
      ),
    ).toBe(true);
  });

  it("matches an apologetic Spanish refusal ('lo siento, eso está fuera')", () => {
    expect(
      classifyRefusal("Lo siento, eso está fuera de mi alcance."),
    ).toBe(true);
  });

  it("matches a Spanish polite-greeting + refusal head pattern", () => {
    const reply =
      "Hola María, ¡con gusto te ayudo!\n\n" +
      "Lamentablemente, no tengo permiso para borrar ubicaciones de sitio. " +
      "Pídeselo a tu admin del socio.";
    expect(classifyRefusal(reply)).toBe(true);
  });

  it("does not flag a normal helpful Spanish reply", () => {
    expect(
      classifyRefusal(
        "Abre la pantalla de Tickets y toca una fila para ver el estado.",
      ),
    ).toBe(false);
  });
});
