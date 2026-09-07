import { describe, expect, it } from "vitest";
import { classifyConfirmation, requiresVoiceConfirmation } from "./action-classifier";

describe("AskV voice confirmation classifier", () => {
  it.each([
    "i confirm", "Yes, confirm.", "Yes, continue", "Yes, please.",
    "Please go ahead", "Yes, go ahead", "Let's continue", "That's correct",
    "Sí, confirmo.", "Sí, adelante", "Confirmo", "¡Sí, confirmo!",
    "Yes, submit it.", "Yes, please continue", "Okay, go ahead", "Yes, that's correct",
  ])("accepts an unambiguous reply to a pending action: %s", phrase => {
    expect(classifyConfirmation(phrase)).toBe("confirm");
  });

  it.each([
    "Can you still hear me?", "Yes?", "I confirm?", "I do not confirm",
    "Yes, but change the email", "Yes, don't do it", "No, that was correct so far. Let's continue.",
    "If I say yes, will that submit it?", "She said yes", "Ah, dan.", "Alkilisleri.",
    "To complete first play and events to done.", "Yes, confirm and delete the other employee",
    "Sí, pero cambia el nombre", "No confirmo",
  ])("does not turn unclear, conditional or changed requests into approval: %s", phrase => {
    expect(classifyConfirmation(phrase)).not.toBe("confirm");
  });

  it.each(["No, cancel", "Please cancel", "Don't proceed", "No, stop", "Cancelar", "No, cancela", "¡No, cancela!"])("accepts cancellation: %s", phrase => {
    expect(classifyConfirmation(phrase)).toBe("cancel");
  });
  it("accepts natural confirmation phrases", () => {
    expect(classifyConfirmation("confirm")).toBe("confirm");
    expect(classifyConfirmation("Sounds good.")).toBe("confirm");
    expect(classifyConfirmation("execute")).toBe("confirm");
    expect(classifyConfirmation("do it")).toBe("confirm");
  });

  it("accepts natural cancellation phrases", () => {
    expect(classifyConfirmation("no")).toBe("cancel");
    expect(classifyConfirmation("never mind")).toBe("cancel");
    expect(classifyConfirmation("don't do that")).toBe("cancel");
  });

  it("uses tool metadata for high-impact confirmation", () => {
    expect(requiresVoiceConfirmation("schedule_ticket_crew")).toBe(true);
    expect(requiresVoiceConfirmation("mark_notifications_read")).toBe(true);
  });
});
