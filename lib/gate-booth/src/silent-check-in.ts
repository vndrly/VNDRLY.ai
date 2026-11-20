import { interpretGateSpeech, type GateSpeechFields } from "./voice-command";
import { fillGateCheckIn, openGateCheckIn, type GateVoiceDraft } from "./voice-draft";

type Context = { path?: string; gateDraft?: unknown };
type CheckInFields = GateSpeechFields & { plateState?: string };
type PlateStateParsers = {
  normalizePlateState: (value: string | undefined) => string | null;
  parseSpokenPlateState: (transcript: string) => string | null;
};
const command = /^(?:(?:hey\s+)?(?:ask\s+)?v[,.\s]+)?(?:please\s+)?check[ -]?in\b[,:.\s-]*/i;
const isGatePage = (path?: string) => /^\/(?:mobile\/)?gate\/?(?:[?#]|$)/.test(path ?? "");

export const askVAudioInput = {
  transcription: { model: "gpt-4o-mini-transcribe", prompt: "Transcribe exactly what you hear. Preserve names, company names, license plate characters, and issuing states as spoken." },
  turnDetection: { type: "semantic_vad", eagerness: "medium", createResponse: false, interruptResponse: true },
} as const;

export function gateCheckInBinding(draft: GateVoiceDraft | undefined): string | null {
  return draft ? JSON.stringify([draft.siteLocationId, draft.gateStationId, draft.entryRevision]) : null;
}

function entryDraft(context: Context): GateVoiceDraft | null {
  if (!isGatePage(context.path) || !context.gateDraft || typeof context.gateDraft !== "object") return null;
  return context.gateDraft as GateVoiceDraft;
}

function checkInFields(text: string, opening: boolean, { normalizePlateState, parseSpokenPlateState }: PlateStateParsers): CheckInFields {
  const fieldText = text
    .replace(/\b(?:I am|I'm|we are|we're)\s+(?:here|going|dropping|delivering)\b.*$/i, "")
    .replace(/[.!]+(?=\s|$)/g, ";");
  const speech = interpretGateSpeech(fieldText);
  if (!speech.text) return {};
  const fields: CheckInFields = { ...speech.fields };
  const stated = /\b(?:issuing\s+)?state\s*(?:is\s+|of\s+|:\s*|\s+)(.+?)(?=[,;.!]|\s+(?:and\s+)?(?:tag|(?:license\s+)?plate|company|first name|last name|purpose|notes)\b|$)/i.exec(speech.text)?.[1];
  const state = normalizePlateState(stated) ?? parseSpokenPlateState(speech.text) ?? normalizePlateState(speech.text);
  if (state) fields.plateState = state;

  if (!fields.firstName && !fields.lastName) {
    const lead = speech.text.match(/^(?:my name is|name is|this is|i'm|i am|it's)\s+([^,;]+)/i)?.[1]
      ?? (opening || /\b(?:from|with)\s+\S/i.test(speech.text) ? speech.text : "");
    const name = lead.split(/[,;]|\s+(?:from|with|company|(?:license )?plate|tag|state|purpose|notes)\b/i)[0].trim();
    if (!normalizePlateState(name) && !/^(?:and|the|next|another|somebody|someone|this|that|me|us|him|her)\b/i.test(name) && /^[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){1,3}$/u.test(name)) {
      const [firstName, ...lastName] = name.split(/\s+/);
      fields.firstName = firstName;
      fields.lastName = lastName.join(" ");
    }
  }
  return fields;
}

/** A completed audio turn either belongs to the open form or to the assistant. */
export function createSilentGateCheckIn(plateState: PlateStateParsers) {
  let gate: string | null = null;
  let entry: string | null = null;
  let waiting: CheckInFields | null = null;
  const gateOf = (draft: GateVoiceDraft) => JSON.stringify([draft.siteLocationId, draft.gateStationId]);
  function attach(context: Context) {
    if (!isGatePage(context.path)) { gate = entry = waiting = null; return; }
    const draft = entryDraft(context);
    if (!draft || !waiting) return;
    gate = gateOf(draft);
    entry = gateCheckInBinding(draft);
    const fields = waiting;
    waiting = null;
    openGateCheckIn();
    if (Object.keys(fields).length) fillGateCheckIn(fields);
  }
  return {
    attach,
    active(context: Context) {
      const draft = entryDraft(context);
      return isGatePage(context.path) && (waiting !== null || (draft ? gate === gateOf(draft) : gate !== null));
    },
    hear(context: Context, transcript: string): "start" | "collect" | null {
      attach(context);
      if (!isGatePage(context.path)) return null;
      const draft = entryDraft(context);
      const text = transcript.trim();
      const opening = command.exec(text);
      const fields = () => checkInFields(opening ? text.slice(opening[0].length) : text, Boolean(opening), plateState);
      if (!draft) {
        const started = Boolean(opening && !waiting);
        if (started) waiting = {};
        if (waiting) { Object.assign(waiting, fields()); return started ? "start" : "collect"; }
        return gate ? "collect" : null;
      }
      const nextGate = gateOf(draft), nextEntry = gateCheckInBinding(draft);
      const started = Boolean(opening) && entry !== nextEntry;
      if (opening) { gate = nextGate; entry = nextEntry; }
      if (gate !== nextGate) { gate = entry = null; return null; }
      if (entry !== nextEntry) return "collect";
      if (started) openGateCheckIn();
      const updates = fields();
      if (Object.keys(updates).length) fillGateCheckIn(updates);
      return started ? "start" : "collect";
    },
  };
}
