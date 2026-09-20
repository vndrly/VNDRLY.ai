export type GatePromptKind = "add_details_or_complete" | null;
export type GateAuthorization =
  | "prepare"
  | "submit"
  | "cancel"
  | "clarify"
  | "none";

export interface GateIntentInput {
  utterance: string;
  toolName: string;
  pendingPrompt?: GatePromptKind;
}

export interface GateIntentDecision {
  action: "check_in" | "check_out" | "other";
  authorization: GateAuthorization;
  normalizedUtterance: string;
}

const PREPARE = /\b(new|start|open|prepare|pull up|set up)\b/;
const CHECK_IN = /\b(check[ -]?in|check\b.{1,80}\bin|checking in|coming in|arriving|admit)\b/;
const CHECK_OUT = /\b(check[ -]?out|check\b.{1,80}\bout|checking out|leaving|departing)\b/;
const SUBMIT = /\b(submit|complete|go ahead|do it|finish)\b/;
const CANCEL = /\b(cancel|stop|never mind|nevermind|do not proceed|don't proceed)\b/;
const NEGATED_ACTION = /\b(do not|don't|dont|not)\b.{0,24}\b(check|submit|complete|admit|proceed)\b/;
const CORRECTION = /\b(but|change|instead|actually|correction|use .+ instead)\b/;
const QUOTED = /\b(if i|she said|he said|they said|someone said)\b/;
const DECLINES_DETAILS = /^(no|nothing else|no more details|that's all|thats all)$/;

function normalize(utterance: string): string {
  return utterance
    .trim()
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9'áéíóúüñ\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGateMutationTool(name: string): boolean {
  return (
    name === "confirm_visitor_check_in" ||
    name === "confirm_visitor_check_out"
  );
}

export function classifyGateIntent(
  input: GateIntentInput,
): GateIntentDecision {
  const normalizedUtterance = normalize(input.utterance);
  const action = input.toolName === "confirm_visitor_check_out" || CHECK_OUT.test(normalizedUtterance)
    ? "check_out"
    : input.toolName === "confirm_visitor_check_in" || CHECK_IN.test(normalizedUtterance)
      ? "check_in"
      : "other";

  if (
    input.pendingPrompt === "add_details_or_complete" &&
    DECLINES_DETAILS.test(normalizedUtterance)
  ) {
    return { action, authorization: "submit", normalizedUtterance };
  }
  if (
    CANCEL.test(normalizedUtterance) ||
    normalizedUtterance === "no" ||
    NEGATED_ACTION.test(normalizedUtterance)
  ) {
    return { action, authorization: "cancel", normalizedUtterance };
  }
  if (
    input.utterance.includes("?") ||
    QUOTED.test(normalizedUtterance) ||
    CORRECTION.test(normalizedUtterance)
  ) {
    return { action, authorization: "clarify", normalizedUtterance };
  }
  if (PREPARE.test(normalizedUtterance)) {
    return { action, authorization: "prepare", normalizedUtterance };
  }
  if (action !== "other" && !hasSufficientNewTarget(normalizedUtterance)) {
    return { action, authorization: "clarify", normalizedUtterance };
  }
  if (
    SUBMIT.test(normalizedUtterance) ||
    CHECK_IN.test(normalizedUtterance) ||
    CHECK_OUT.test(normalizedUtterance)
  ) {
    return { action, authorization: "submit", normalizedUtterance };
  }
  return { action, authorization: "none", normalizedUtterance };
}
const PLATE_TARGET = /\b(?=[a-z0-9-]{2,10}\b)(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9-]+\b/;

function hasFullNameTarget(text: string): boolean {
  const patterns = [
    /\bcheck\s+([a-z'-]+)\s+([a-z'-]+)\s+(?:in|out)\b/,
    /\b([a-z'-]+)\s+([a-z'-]+)\s+(?:is\s+)?(?:coming in|arriving|leaving|departing)\b/,
    /\b(?:admit)\s+([a-z'-]+)\s+([a-z'-]+)\b/,
    /\bcomplete\s+([a-z'-]+)\s+([a-z'-]+)'?s?\s+check[ -]?(?:in|out)\b/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function hasSufficientNewTarget(text: string): boolean {
  return PLATE_TARGET.test(text) || hasFullNameTarget(text);
}
