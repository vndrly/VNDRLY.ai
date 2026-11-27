import { CHECK_OUT_PROMPT } from "./voice-reply";

/** Checkout speech comes from the action receipt, not a generated explanation. */
export function checkoutSpeech(name: string, result: unknown): string | null {
  if (name !== "confirm_visitor_check_out" || !result || typeof result !== "object") return null;
  const value = result as Record<string, unknown>;
  if (value.requiresConfirmation === true) {
    const name = typeof value.displayName === "string" ? value.displayName.trim() : "";
    return name ? `${name}. ${CHECK_OUT_PROMPT}` : CHECK_OUT_PROMPT;
  }
  if (value.ok === true && value.action === "visitor_checked_out" && value.verification === "canonical_readback") {
    const name = typeof value.displayName === "string" ? value.displayName.trim() : "";
    return name ? `${name} is checked out.` : "Checked out.";
  }
  if (value.ok === false || value.error) {
    const reason = [value.error, value.message].find(item => typeof item === "string" && item.trim()) as string | undefined;
    return reason ? `Checkout was not confirmed. ${reason.trim().slice(0, 200)}` : "Checkout was not confirmed.";
  }
  return null;
}
