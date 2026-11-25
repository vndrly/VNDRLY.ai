import { classifyGateIntent } from "./gate-intent";

export type GateVoiceReply = "submit" | "refuse" | "correct" | "repeat";
export type GateVoiceAction = "check_in" | "check_out";

const APPROVAL = /^(?:(?:please|okay|ok|yeah|yep|yup) )*(?:yes(?: please)?|yeah|yep|yup|affirmative|correct|right|confirm(?:ed)?|submit(?: it)?|go ahead(?: and do that)?|do it|do that|finish|complete(?: the check(?: in| out))?|sounds good|looks good|roger|that(?:'s| is) (?:him|her|them|it|right|correct|all)|nothing else|si|sí|afirmativo|correcto|adelante|confirmo)(?: (?:check in|check out|that|it|him|her|them|this|this one|please))*$/;
const REFUSAL = /^(?:no|nope|nah|wait|hold on|hang on|not yet|cancel|stop|never mind)(?: please)?$|^no\b|\b(?:do not|don't|dont)\b|^(?:cancelar|cancela|no cancela)$/;
const CORRECTION = /\b(?:but|change|instead|actually|correction)\b/;
const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function spokenGateReply(text: string): string {
  return text.trim().toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
}

/** Decide a reply only while a check-in or check-out confirmation is open. */
export function decideGateVoiceReply(text: string, action: GateVoiceAction, draft?: Record<string, unknown>): GateVoiceReply {
  const value = spokenGateReply(text);
  if (!value) return "repeat";
  if (REFUSAL.test(value)) return "refuse";
  if (APPROVAL.test(value)) return "submit";
  if (CORRECTION.test(value)) return "correct";
  const decision = classifyGateIntent({
    utterance: text,
    toolName: action === "check_out" ? "confirm_visitor_check_out" : "confirm_visitor_check_in",
    ...(draft ? { toolArguments: draft } : {}),
  });
  if (decision.authorization === "cancel") return "refuse";
  if (decision.authorization === "submit") return "submit";
  return "repeat";
}

export function spellPlate(plate: string): string {
  return plate.replace(/[^a-z0-9]/gi, "").toUpperCase().split("").map(character => DIGITS[Number(character)] ?? character).join(" ");
}

export function checkInPrompt(review: { firstName: string; lastName: string; company: string; vehiclePlate: string; plateState: string }): string {
  return `${review.firstName} ${review.lastName}, ${review.company}, ${spellPlate(review.vehiclePlate)}, ${review.plateState}. Say yes to check in.`;
}

export function checkInReceipt(review: { firstName: string; lastName: string }): string {
  const name = `${review.firstName} ${review.lastName}`.trim();
  return name ? `${name} is checked in.` : "Checked in.";
}

export const CHECK_OUT_PROMPT = "Say yes to check out.";
export const GATE_VOICE_DECLINED = "Not submitted.";
