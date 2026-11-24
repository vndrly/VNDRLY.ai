import { isQuickShiftNote } from "@workspace/askv-realtime-sdk/app-context";

export function shiftNoteFromCommand(utterance: string): string | null {
  if (!isQuickShiftNote(utterance)) return null;
  const english = /^.*?\b(?:add|record|make|create|write|new)\s+(?:a\s+)?(?:shift|handoff)\s+note\b\s*(?:that\s+|saying\s+|:|,|-)?\s*/i;
  const spanish = /^.*?\b(?:agrega|añade)\s+(?:una\s+)?nota\s+de\s+turno\b\s*(?:que\s+|diciendo\s+|:|,|-)?\s*/i;
  const text = utterance.replace(english.test(utterance) ? english : spanish, "").trim();
  return text && text !== utterance.trim() ? text : "";
}

export function reviseShiftNote(current: string, utterance: string): string | null {
  const text = utterance.trim();
  const replace = text.match(/^(?:please\s+)?(?:change|replace)\s+["“]?(.+?)["”]?\s+(?:to|with)\s+["“]?(.+?)["”]?[.!]?$/i);
  if (replace) {
    const start = current.toLowerCase().indexOf(replace[1].toLowerCase());
    if (start < 0) return null;
    return current.slice(0, start) + replace[2] + current.slice(start + replace[1].length);
  }
  const rewritten = text.match(/^(?:actually|correction|make that|use this instead)[:,]?\s*(.+)$/i);
  if (rewritten) return rewritten[1].trim();
  const appended = text.match(/^(?:also\s+)?(?:add|include)\s+(.+)$/i);
  if (appended) return `${current.replace(/[.!?]$/, "")}. ${appended[1].trim()}`;
  return null;
}

export function shiftNoteDecision(utterance: string): "approve" | "cancel" | null {
  const text = utterance.trim().replace(/[.!?]+$/, "");
  if (/^(?:yes|yep|yeah|confirm|confirmed|approve|approved|submit|send it|add it|go ahead|do it|that's right|that is right)$/i.test(text)) return "approve";
  if (/^(?:no|cancel|never mind|nevermind|discard|stop)$/i.test(text)) return "cancel";
  return null;
}

export function preparedShiftNoteMatchesDraft(arguments_: Record<string, unknown> | undefined, text: string): boolean {
  return arguments_?.action === "add_shift_note" && arguments_.text === text;
}
