import { findAskVTool } from "./tool-registry";

export type ConfirmationDecision = "confirm" | "cancel" | "none";

const CONFIRM_PHRASES = new Set([
  "confirm",
  "sounds good",
  "execute",
  "do it",
  "yes",
  "that's right",
  "thats right",
  "send it",
  "submit it",
  "go ahead",
  "i confirm",
  "yes confirm",
  "yes i confirm",
  "yes continue",
  "yes please",
  "yes go ahead",
  "please go ahead",
  "yes do it",
  "yes submit it",
  "yes please continue",
  "okay go ahead",
  "yes that's correct",
  "please do it",
  "let's continue",
  "lets continue",
  "please continue",
  "that's correct",
  "thats correct",
  "i approve",
  "sí",
  "si",
  "confirmo",
  "sí confirmo",
  "si confirmo",
  "sí adelante",
  "si adelante",
  "adelante",
]);

const CANCEL_PHRASES = new Set([
  "no",
  "cancel",
  "stop",
  "never mind",
  "do not do that",
  "don't do that",
  "no cancel",
  "please cancel",
  "don't proceed",
  "do not proceed",
  "no stop",
  "cancelar",
  "cancela",
  "no cancela",
]);

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/’/g, "'").replace(/[,!¡.]+/g, " ").replace(/\s+/g, " ").trim();
}

export function classifyConfirmation(text: string): ConfirmationDecision {
  // Recognize whole replies, not approval words embedded in corrections,
  // questions, quotes or new instructions. Binding to the exact pending
  // action and a later saved user turn is still enforced by the caller.
  const normalized = normalize(text);
  if (CONFIRM_PHRASES.has(normalized)) return "confirm";
  if (CANCEL_PHRASES.has(normalized)) return "cancel";
  return "none";
}

export function requiresVoiceConfirmation(toolName: string): boolean {
  return findAskVTool(toolName)?.confirmation === "required";
}
