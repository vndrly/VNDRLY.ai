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
  toolArguments?: Record<string, unknown>;
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
const NEGATED_ACTION = /\b(do not|don't|dont|not)\b.{0,24}\b(check|submit|complete|admit|proceed|start|assume|take|pause|resume|activate|reopen|close|email|send|reconcile|reverse|undo|mark)\b/;
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
    name === "confirm_visitor_check_out" ||
    ["start_paid_travel", "assume_gate_shift", "set_gate_coverage_status", "deliver_gate_report", "reconcile_stale_gate_visit", "reverse_gate_reconciliation"].includes(name)
  );
}

const OPERATION_COMMANDS: Record<string, RegExp> = {
  start_paid_travel: /\b(start my day|start (?:my )?paid travel|i(?:'m| am) on my way)\b/,
  assume_gate_shift: /\b(assume|take|start)\b.{0,36}\b(shift|gate duty)\b|\bon site\b.{0,30}\bstart\b/,
  set_gate_coverage_status: /\b(pause|resume|activate|reopen|close)\b.{0,50}\bgate\b/,
  deliver_gate_report: /\b(email|send)\b.{0,100}\b(gate log|gate report|shift notes|report)\b/,
  reconcile_stale_gate_visit: /\b(reconcile|confirm|mark)\b.{0,100}\b(stale|off site|no longer on site)\b/,
  reverse_gate_reconciliation: /\b(reverse|undo|reopen)\b.{0,100}\breconcil/,
};

export function classifyGateIntent(
  input: GateIntentInput,
): GateIntentDecision {
  const normalizedUtterance = normalize(input.utterance);
  const operationCommand = OPERATION_COMMANDS[input.toolName];
  if (operationCommand) {
    if (CANCEL.test(normalizedUtterance) || NEGATED_ACTION.test(normalizedUtterance))
      return { action: "other", authorization: "cancel", normalizedUtterance };
    if (input.utterance.includes("?") || QUOTED.test(normalizedUtterance) || CORRECTION.test(normalizedUtterance))
      return { action: "other", authorization: "clarify", normalizedUtterance };
    return { action: "other", authorization: operationCommand.test(normalizedUtterance) ? "submit" : "clarify", normalizedUtterance };
  }
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
    action !== "other" &&
    input.toolArguments &&
    !resolvedTargetMatches(normalizedUtterance, input.toolArguments)
  ) {
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

function fullNameTarget(text: string): [string, string] | null {
  const patterns = [
    /\bcheck\s+([a-z'-]+)\s+([a-z'-]+)\s+(?:in|out)\b/,
    /\bcheck[ -]?(?:in|out)\s+([a-z'-]+)\s+([a-z'-]+)\b/,
    /\b([a-z'-]+)\s+([a-z'-]+)\s+(?:is\s+)?(?:coming in|arriving|leaving|departing)\b/,
    /\b(?:admit)\s+([a-z'-]+)\s+([a-z'-]+)\b/,
    /\bcomplete\s+([a-z'-]+)\s+([a-z][a-z'-]*?)(?:'s)?\s+check[ -]?(?:in|out)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return [match[1], match[2]];
  }
  return null;
}

function hasSufficientNewTarget(text: string): boolean {
  return PLATE_TARGET.test(text) || fullNameTarget(text) !== null;
}

function resolvedTargetMatches(
  text: string,
  args: Record<string, unknown>,
): boolean {
  const spokenName = fullNameTarget(text);
  const spokenPlate = text.match(PLATE_TARGET)?.[0] ?? null;
  if (spokenName) {
    const firstName = normalize(String(args.firstName ?? ""));
    const lastName = normalize(String(args.lastName ?? ""));
    if (firstName !== spokenName[0] || lastName !== spokenName[1]) return false;
  }
  if (spokenPlate) {
    const resolvedPlate = String(args.vehiclePlate ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const normalizedSpokenPlate = spokenPlate.replace(/[^a-z0-9]/g, "");
    if (!resolvedPlate || resolvedPlate !== normalizedSpokenPlate) return false;
  }
  return Boolean(spokenName || spokenPlate);
}
