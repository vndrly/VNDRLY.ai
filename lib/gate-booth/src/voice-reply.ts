import { classifyGateIntent } from "./gate-intent";
import { platePiece } from "./voice-command";

export type GateVoiceReply = "submit" | "refuse" | "correct" | "repeat";
export type GateVoiceAction = "check_in" | "check_out";

const APPROVAL = /^(?:(?:please|okay|ok|yeah|yep|yup) )*(?:yes(?: please)?|yeah|yep|yup|affirmative|correct|right|confirm(?:ed)?|submit(?: it)?|go ahead(?: and do that)?|do it|do that|finish|complete(?: the check(?: in| out))?|sounds good|looks good|roger|that(?:'s| is) (?:him|her|them|it|right|correct|all)|nothing else|si|sí|afirmativo|correcto|adelante|confirmo)(?: (?:check in|check out|that|it|him|her|them|this|this one|please))*$/;
const REFUSAL = /^(?:no|nope|nah|wait|hold on|hang on|not yet|cancel|stop|never mind)(?: please)?$|^no\b|\b(?:do not|don't|dont)\b|^(?:cancelar|cancela|no cancela)$/;
const CORRECTION = /\b(?:but|change|instead|actually|correction)\b/;
// "No, the last name is Smyth" and "Company Webb's Towing" supply a new value; "no, the plate is wrong" does not.
const RESTATED = /\b(?:first name|last name|name|company|tag|plate|state)\s+(?:is|should be|to)\s+(?!(?:wrong|incorrect|not|right|correct|good|fine)\b)\S|^(?:(?:no|nope|nah|wait|actually|sorry|correction)\s+)*(?:first name|last name|company(?: name)?|tag|plate|state)\s+(?!(?:is|was|looks?|seems?|wrong|incorrect|not|right|correct|good|fine|ok|okay)\b)\S/;
const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function spokenGateReply(text: string): string {
  return text.trim().toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
}

/** Decide a reply only while a check-in or check-out confirmation is open. */
export function decideGateVoiceReply(text: string, action: GateVoiceAction, draft?: Record<string, unknown>): GateVoiceReply {
  const value = spokenGateReply(text);
  if (!value) return "repeat";
  if (action === "check_in" && RESTATED.test(value)) return "correct";
  if (REFUSAL.test(value)) return "refuse";
  if (APPROVAL.test(value)) return "submit";
  if (CORRECTION.test(value)) return "correct";
  // "1, 2, 3." after the read-back is the rest of the tag, or a new one.
  if (action === "check_in" && platePiece(text).length >= 2) return "correct";
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

const FIELD_WORDS: Record<string, string> = { firstName: "first name", lastName: "last name", company: "company", vehiclePlate: "tag", plateState: "state" };
/** What a check-in saved without every detail is flagged for. Empty when nothing is missing. */
export function checkInFlagged(missing: readonly string[] = []): string {
  const words = missing.map(key => FIELD_WORDS[key]).filter(Boolean);
  return words.length ? `Flagged: missing ${words.join(", ")}.` : "";
}

/** `flags` is what the server flagged the saved entry for; without it the missing details are named. */
export function checkInReceipt(review: { firstName: string; lastName: string; missing?: readonly string[] }, flags?: readonly string[]): string {
  const name = `${review.firstName} ${review.lastName}`.trim();
  return [name ? `${name} is checked in.` : "Checked in.", flags ? (flags.length ? `Flagged: ${flags.join(". ")}.` : "") : checkInFlagged(review.missing)].filter(Boolean).join(" ");
}

const GENERIC_FAILURE = /^(?:internal server error|tool failed|voice request failed|http \d+)$/i;
/** The words shown and spoken when a request did not go through: never "HTTP 500" or "Failed to fetch". */
export function plainGateFailure(status: number | null, message?: string | null): string {
  if (status === null) return "No connection. Try again.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  const text = message?.trim();
  if (text && !GENERIC_FAILURE.test(text)) return text;
  return status >= 500 || text ? "We hit a snag on our end. Please try again in a moment." : "That action can't be completed right now.";
}
/** Any failure in plain words: a thrown network error, "HTTP 500", or the server's own reason as it was given. */
export function plainGateError(error: unknown, fallback: string): string {
  const text = (error instanceof Error ? error.message : typeof error === "string" ? error : "").trim();
  if (/^(?:failed to fetch|load failed|network request failed|networkerror\b.*|vndrly can't reach the service right now\b.*)$/i.test(text)) return plainGateFailure(null);
  const http = /^HTTP (\d{3})$/i.exec(text);
  if (http) return plainGateFailure(Number(http[1]));
  if (/^(?:login required|not authenticated|unauthorized)$/i.test(text)) return plainGateFailure(401);
  return text ? plainGateFailure(400, text) : fallback;
}

export type GateChoice = { id: string; name: string };
/** The gates the operator may still pick from, supplied by a Gate form that cannot save until one is picked. */
export function gateChoices(draft: Record<string, unknown> | null | undefined): GateChoice[] {
  const list = Array.isArray(draft?.gateChoices) ? draft.gateChoices as GateChoice[] : [];
  return list.filter(choice => choice && typeof choice.id === "string" && typeof choice.name === "string" && choice.name.trim());
}
/** The one gate a spoken answer names: "Front Gate", "the front one", "I'm at front". Null when none or several fit. */
export function matchGateChoice(draft: Record<string, unknown> | null | undefined, text: string): GateChoice | null {
  const choices = gateChoices(draft), said = spokenGateReply(text);
  if (!said) return null;
  const named = choices.filter(choice => ` ${said} `.includes(` ${spokenGateReply(choice.name)} `));
  if (named.length === 1) return named[0];
  const words = said.split(" ").filter(word => !/^(?:the|gate|at|on|use|select|choose|one|it|it's|its|is|i|i'm|im|am|please)$/.test(word));
  const loose = words.length ? choices.filter(choice => words.every(word => spokenGateReply(choice.name).split(" ").includes(word))) : [];
  return loose.length === 1 ? loose[0] : null;
}
/** What V says when a save waits for a gate: the names when they are few enough to say. */
export function gateChoiceQuestion(draft: Record<string, unknown> | null | undefined): string {
  const names = gateChoices(draft).map(choice => choice.name.trim());
  return names.length && names.length <= 4 ? `Which gate? ${names.join(", ")}.` : "Select the gate in the Gate selector, then say yes.";
}

export const CHECK_OUT_PROMPT = "Say yes to check out.";
export const GATE_VOICE_DECLINED = "Not submitted.";

/** Why an entry was saved flagged (missing details, tag already on site), one reason per line. Internal codes are left out. */
export const gateReviewReasons = (record: { conflictReason?: string | null }): string[] =>
  (record.conflictReason ?? "").split("\n").map(line => line.trim()).filter(line => line && !/^[a-z_]+(?:\.[a-z_]+)+$/.test(line));
