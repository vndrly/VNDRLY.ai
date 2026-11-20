import { interpretGateSpeech, type GateSpeechFields } from "./voice-command";
import { fillGateCheckIn, openGateCheckIn, type GateVoiceDraft } from "./voice-draft";

type Context = { path?: string; gateDraft?: unknown };
type CheckInFields = GateSpeechFields & { plateState?: string; destination?: string; note?: string };
type PlateStateParsers = {
  normalizePlateState: (value: string | undefined) => string | null;
  parseSpokenPlateState: (transcript: string) => string | null;
};
const command = /^(?:(?:hey[,.\s]+)?(?:ask\s+)?v[,.\s]+)?(?:(?:uh|um)[,.\s]+)*(?:please\s+)?(?:I (?:want|need) to\s+)?check[ -]?(in|out)\b[,:.\s-]*/i;
export const isGateVoicePage = (path?: string) => /^\/(?:mobile\/)?gate\/?(?:[?#]|$)/.test(path ?? "");
export function gateVoiceTrigger(text: string): "in" | "out" | undefined {
  const trigger = command.exec(text.trim())?.[1]?.toLowerCase();
  return trigger === "in" || trigger === "out" ? trigger : undefined;
}
export const isGateVoiceConfirm = (text: string) => /^confirm[.!\s]*$/i.test(text.trim());

export const askVAudioInput = {
  transcription: { model: "gpt-4o-mini-transcribe", prompt: "Transcribe exactly what you hear. Preserve names, company names, license plate characters, issuing states, destinations, and observations as spoken." },
  turnDetection: { type: "semantic_vad", eagerness: "medium", createResponse: false, interruptResponse: true },
} as const;
export function gateVoiceAudioInput(path?: string) {
  return isGateVoicePage(path) ? {
    ...askVAudioInput,
    turnDetection: { ...askVAudioInput.turnDetection, eagerness: "high", interruptResponse: false },
  } as const : askVAudioInput;
}

export function gateCheckInBinding(draft: GateVoiceDraft | undefined): string | null {
  return draft ? JSON.stringify([draft.siteLocationId, draft.gateStationId, draft.entryRevision]) : null;
}

function entryDraft(context: Context): GateVoiceDraft | null {
  if (!isGateVoicePage(context.path) || !context.gateDraft || typeof context.gateDraft !== "object") return null;
  return context.gateDraft as GateVoiceDraft;
}

function checkInExtras(text: string) {
  const cues = /(?:^|[,;]\s*|\s+(?:and\s+)?)(?:(?<destination>(?:(?:his|her|their|the)\s+)?destination\s*(?:is\b|:)|(?:he(?:'s| is)|she(?:'s| is)|they(?:'re| are)|driver is)\s+(?:going|heading)\s+to\b)|(?<note>(?:add\s+(?:a\s+)?)?notes?\s*(?:are\b|is\b|:|\b))|(?<observation>(?:(?:this|the|his|her|their)\s+(?:truck|vehicle|trailer|driver|load)\s+(?:looks?|has|had|was|is|needs?|appears?|seems?)|(?:I am|I'm|we are|we're|he is|he's|she is|she's)\s+here\s+(?:to|for))\b))/gi;
  const matches = [...text.matchAll(cues)];
  let destination: string | undefined;
  const notes: string[] = [];
  for (const [index, match] of matches.entries()) {
    const observation = match.groups?.observation;
    const begin = match.index + match[0].length - (observation?.length ?? 0);
    const end = matches[index + 1]?.index ?? text.length;
    const value = text.slice(begin, end)
      .replace(/^(?:[\s,:;.]|(?:uh|um)\b)+/i, "")
      .replace(/\s*(?:\b(?:and\s+)?(?:then|check (?:him|her|them) in|confirm)\b.*|[;,\s]+)$/i, "")
      .trim();
    if (!value) continue;
    if (match.groups?.destination) destination = value.slice(0, 120);
    else if (observation || match.groups?.note) notes.push(value);
  }
  return {
    identity: matches.length ? text.slice(0, matches[0].index).trim() : text,
    destination,
    note: notes.length ? notes.join(" ") : undefined,
  };
}

function checkInFields(text: string, opening: boolean, expectName: boolean, { normalizePlateState, parseSpokenPlateState }: PlateStateParsers): CheckInFields {
  const { identity, destination, note } = checkInExtras(text.replace(/’/g, "'"));
  const fieldText = identity
    .replace(/(^|[,;])\s*(?:(?:uh|um)\s*[,;]\s*)+/gi, "$1 ")
    .replace(/\b(?:I am|I'm|we are|we're)\s+(?:here|going|dropping|delivering)\b.*$/i, "")
    .replace(/\b(plate|tag)\s*[,;:]\s*/gi, "$1 ")
    .replace(/[.!]+(?=\s|$)/g, ";");
  const speech = interpretGateSpeech(fieldText);
  const fields: CheckInFields = { ...speech.fields, ...(destination && { destination }), ...(note && { note }) };
  if (!speech.text) return fields;
  const company = /\b(?:company(?:\s+name)?|from|with)\s*(?:is\s+|:\s*|\s+)(.+?)(?=[,;]|\s+(?:first name|last name|(?:license\s+)?plate|tag|state|purpose|notes|duration|here for|here to)\b|$)/i.exec(speech.text)?.[1]?.trim();
  if (company) fields.company = company;
  const stated = /\b(?:issuing\s+)?state\s*(?:is\s+|of\s+|:\s*|\s+)(.+?)(?=[,;.!]|\s+(?:and\s+)?(?:tag|(?:license\s+)?plate|company|first name|last name|purpose|notes)\b|$)/i.exec(speech.text)?.[1];
  const state = normalizePlateState(stated) ?? parseSpokenPlateState(speech.text) ?? normalizePlateState(speech.text);
  if (state) fields.plateState = state;

  if (!fields.firstName && !fields.lastName) {
    const lead = speech.text.match(/^(?:my name is|name is|this is|i'm|i am|it's)\s+([^,;]+)/i)?.[1]
      ?? (opening || expectName || /\b(?:from|with)\s+\S/i.test(speech.text) ? speech.text : "");
    const name = lead.split(/[,;]|\s+(?:from|with|company|(?:license )?plate|tag|state|purpose|notes)\b/i)[0].trim();
    const fieldOrInstruction = /^(?:company|first name|last name|driver|tag|plate|state|and|the|next|another|somebody|someone|this|that|me|us|him|her|check|confirm|red|white|blue|black|green|silver|gray|grey)\b/i;
    const nameWords = /^[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){1,3}$/u;
    if (!normalizePlateState(name) && !fieldOrInstruction.test(name) && nameWords.test(name)) {
      const [firstName, ...lastName] = name.split(/\s+/);
      fields.firstName = firstName;
      fields.lastName = lastName.join(" ");
    }
  }
  if (opening && fields.firstName && fields.lastName && fields.vehiclePlate && !fields.company) {
    const candidate = speech.text.split(/[,;]/)[1]?.trim();
    if (candidate && !normalizePlateState(candidate) && !/\b(?:tag|plate|state|notes?|purpose|first name|last name|truck|vehicle)\b/i.test(candidate)) {
      fields.company = candidate;
    }
  }
  return fields;
}

export function gateCheckInReview(draft: GateVoiceDraft | null | undefined) {
  if (!draft || !draft.silentCheckIn) return null;
  const field = (key: string) => typeof draft[key] === "string" ? (draft[key] as string).trim() : "";
  const firstName = field("firstName"), lastName = field("lastName"), company = field("company"),
    vehiclePlate = field("vehiclePlate"), plateState = field("plateState");
  const details = [...new Set([field("purpose"), field("notes")].filter(Boolean))];
  const destinationName = field("destinationName");
  const destinationNeedsReview = draft.destinationNeedsReview === true;
  const ready = Boolean(draft.siteLocationId && firstName && lastName && company && vehiclePlate && plateState);
  const route = destinationName ? [field("destinationId"), destinationName, destinationNeedsReview] : [];
  const key = JSON.stringify([gateCheckInBinding(draft), firstName, lastName, company, vehiclePlate, plateState, details, ...route]);
  return { key, firstName, lastName, company, vehiclePlate, plateState, destinationName, destinationNeedsReview, details, ready };
}

/** A completed audio turn either belongs to the open form or to the assistant. */
export function createSilentGateCheckIn(plateState: PlateStateParsers) {
  let gate: string | null = null;
  let entry: string | null = null;
  let waiting: CheckInFields | null = null;
  const gateOf = (draft: GateVoiceDraft) => JSON.stringify([draft.siteLocationId, draft.gateStationId]);
  function attach(context: Context) {
    if (!isGateVoicePage(context.path)) { gate = entry = waiting = null; return; }
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
      return isGateVoicePage(context.path) && (waiting !== null || (draft ? gate === gateOf(draft) : gate !== null));
    },
    review(context: Context) {
      const draft = entryDraft(context);
      return draft && entry === gateCheckInBinding(draft) ? gateCheckInReview(draft) : null;
    },
    hear(context: Context, transcript: string): "start" | "collect" | null {
      attach(context);
      if (!isGateVoicePage(context.path)) return null;
      const draft = entryDraft(context);
      const text = transcript.trim();
      const prefix = command.exec(text);
      if (prefix?.[1]?.toLowerCase() === "out") { gate = entry = waiting = null; return null; }
      const fields = () => checkInFields(prefix ? text.slice(prefix[0].length) : text, Boolean(prefix), !(draft?.firstName || draft?.lastName || waiting?.firstName || waiting?.lastName), plateState);
      if (!draft) {
        const started = Boolean(prefix && !waiting);
        if (started) waiting = {};
        if (waiting) { Object.assign(waiting, fields()); return started ? "start" : "collect"; }
        return gate ? "collect" : null;
      }
      const nextGate = gateOf(draft), nextEntry = gateCheckInBinding(draft);
      const started = Boolean(prefix) && entry !== nextEntry;
      if (prefix) { gate = nextGate; entry = nextEntry; }
      if (gate !== nextGate) { gate = entry = null; return null; }
      if (entry !== nextEntry) return "collect";
      if (started) openGateCheckIn();
      const updates = fields();
      if (Object.keys(updates).length) fillGateCheckIn(updates);
      return started ? "start" : "collect";
    },
  };
}
