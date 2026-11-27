import { interpretGateSpeech, normalizeSpokenPlate, platePiece, type GateSpeechFields } from "./voice-command";
import { fillGateCheckIn, openGateCheckIn, dismissGateCheckIn, type GateVoiceDraft } from "./voice-draft";

type Context = { path?: string; gateDraft?: unknown };
type CheckInFields = GateSpeechFields & { plateState?: string; destination?: string; note?: string };
type PlateStateParsers = {
  normalizePlateState: (value: string | undefined) => string | null;
  parseSpokenPlateState: (transcript: string) => string | null;
};
// The transcriber also writes "check in" as "checking in", "chick in", "chicken" or "check and".
const command = /^(?:(?:hey[,.\s]+)?(?:ask\s+)?v[,.\s]+)?(?:(?:uh|um|okay|ok)[,.\s]+)*(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:I (?:want|need) to\s+)?(?:start\s+)?(?:ch[ei]ck(?:ing)?[ -]?(?:(?:him|her|them)\s+)?(in|out)\b|(?:the\s+)?(?:chicken|check and)\b)[,:.\s-]*/i;
const address = /^(?:(?:hey|ask)[,.\s]+v(?:ee)?\b|v(?:ee)?(?=[,.:!?]|$))[,.:!?\s]*/i;
// It also writes "V" as "Vee" or "V:", and operators lead with "Okay V," or "V, can you". Never "yes": that approves a read-back.
const leadIn = /^(?:(?:hey|okay|ok|alright|all right|so|um|uh|now|v|vee)[,.:;!\s—–-]+|(?:can|could|would|will) you\s+|let['’]?s\s+|go ahead and\s+|I(?:['’]d| would) like to\s+|please\s+)+(?=ch[ei]ck)/i;
function commandPrefix(text: string): RegExpExecArray | null {
  const strict = command.exec(text);
  if (strict) return strict;
  const lead = leadIn.exec(text)?.[0];
  const rest = lead ? command.exec(text.slice(lead.length)) : null;
  if (rest) rest[0] = lead + rest[0];
  return rest;
}
const commandKind = (prefix: RegExpExecArray | null) => prefix ? (prefix[1]?.toLowerCase() === "out" ? "out" : "in") : undefined;
export const isGateVoicePage = (path?: string) => /^\/(?:mobile\/)?gate\/?(?:[?#]|$)/.test(path ?? "");
export function gateVoiceTrigger(text: string): "in" | "out" | undefined {
  return commandKind(commandPrefix(text.trim()));
}
/** The visitor named after "check out", without the command or closing punctuation. */
export function gateCheckOutQuery(text: string): string {
  const prefix = commandPrefix(text.trim());
  return commandKind(prefix) === "out" ? text.trim().slice(prefix![0].length).replace(/[.!?,;:\s]+$/, "").trim() : "";
}

const IDENTITY = ["firstName", "lastName", "company", "vehiclePlate", "plateState"] as const;
export type GateCheckInField = (typeof IDENTITY)[number];
const QUESTIONS: Record<GateCheckInField, string> = { firstName: "First name?", lastName: "Last name?", company: "Company?", vehiclePlate: "Tag?", plateState: "State?" };
export const checkInQuestion = (field: GateCheckInField) => QUESTIONS[field];
/** Fields are asked for in the order the operator gives them. */
export function missingCheckInField(values: Record<string, unknown> | null | undefined): GateCheckInField | null {
  return IDENTITY.find(key => !(typeof values?.[key] === "string" && (values[key] as string).trim())) ?? null;
}
// The transcriber sometimes writes a short name as "webb" or "WEBB".
const properName = (value: string) => value.split(/\s+/).map(word => /^(?:\p{Ll}[\p{Ll}'-]*|\p{Lu}{3,})$/u.test(word) ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word).join(" ");
const NOT_AN_ANSWER = /^(?:yes|yeah|yep|no|nope|ok|okay|thanks|thank you|hello|hi|bye|confirm(?:ed)?|submit|cancel|stop|wait|hold on|hang on|never ?mind|sorry|pardon|huh|just|I|I'm|we|we're|he|he's|she|she's|they|they're|it|it's|you|this|that|is|are|do|does|did|can|could|would|should|will|why|when|which|start(?:ing)?|try(?:ing)?|again|next|another|check)\b/i;
/** A bare reply fills the field AskV is waiting for: "Halliburton", "ABC 123". */
function bareAnswer(field: GateCheckInField, text: string): CheckInFields {
  const value = text.replace(/^(?:(?:uh|um|the)[,\s]+)+/i, "").replace(/[\s.,!?;:]+$/, "").trim();
  if (!value || value.length > 60 || NOT_AN_ANSWER.test(value)) return {};
  const words = value.split(/\s+/);
  const named = words.every(word => /^\p{L}[\p{L}'-]*$/u.test(word));
  if (field === "firstName" && named && words.length <= 4) {
    return words.length === 1 ? { firstName: properName(value) } : { firstName: properName(words[0]), lastName: properName(words.slice(1).join(" ")) };
  }
  if (field === "lastName" && named && words.length <= 3) return { lastName: properName(value) };
  if (field === "company" && /\p{L}/u.test(value)) return { company: value };
  if (field === "vehiclePlate" && words.every(word => /^[a-z0-9-]+$/i.test(word))) {
    const plate = normalizeSpokenPlate(value);
    // A plain word ("Welding") is not a tag. Letters alone count only the way spelled letters are written: "BADBOY".
    if (plate.length >= 2 && plate.length <= 10 && (/\d/.test(plate) || value === value.toUpperCase())) return { vehiclePlate: plate };
  }
  return {};
}
/** A short approval. Question marks and a trailing "check in" still count; extra requests do not. */
export const isGateVoiceConfirm = (text: string) => /^(?:(?:please|okay|ok|yeah|yep)[,.\s]+)*(?:yes(?:[,.\s]+please)?|affirmative|confirm(?:ed)?|submit)(?:[.!\s,?-]*(?:check[ -]?in|that|it|him|her|them|this(?: one)?))?[.!?\s]*$/i.test(text.trim());

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

function checkInFields(text: string, opening: boolean, expectName: boolean, { normalizePlateState, parseSpokenPlateState }: PlateStateParsers, waitingFor?: (fields: CheckInFields) => GateCheckInField | null): CheckInFields {
  const { identity, destination, note } = checkInExtras(text.replace(/’/g, "'"));
  const fieldText = identity
    .replace(/(^|[,;])\s*(?:(?:uh|um)\s*[,;]\s*)+/gi, "$1 ")
    .replace(/\b(?:I am|I'm|we are|we're)\s+(?:here|going|dropping|delivering)\b.*$/i, "")
    .replace(/\b(plate|tag)\s*[,;:]\s*/gi, "$1 ")
    // A short answer said with rising intonation is transcribed "Halliburton?".
    .replace(waitingFor ? /[.!?]+(?=\s|$)/g : /[.!]+(?=\s|$)/g, ";");
  const speech = interpretGateSpeech(fieldText);
  const fields: CheckInFields = { ...speech.fields, ...(destination && { destination }), ...(note && { note }) };
  if (!speech.text) return fields;
  const company = /\b(?:company(?:\s+name)?|from|with)\s*(?:is\s+|:\s*|\s+)(.+?)(?=[,;]|\s+(?:first name|last name|(?:license\s+)?plate|tag|state|purpose|notes|duration|here for|here to)\b|$)/i.exec(speech.text)?.[1]?.trim();
  if (company) fields.company = company;
  // A company can be its own speech turn, before or after the driver's name.
  const segments = speech.text.split(/[,;]/).map(part => part.trim());
  // Dispatch speech may put a spelled plate immediately after the company,
  // with its "Texas plate" label in the following clause.
  let trailingCompany: string | undefined;
  for (const segment of segments) {
    const match = /^(.+?)\s+((?:[a-z0-9]\s+){2,}[a-z0-9]|[a-z0-9]*\d[a-z0-9]*)$/i.exec(segment);
    if (!match || !/[0-9]/.test(match[2]) || !/\b(?:trucking|transport(?:ation)?|logistics|services|solutions|construction|energy|llc|inc|company|corp(?:oration)?)$/i.test(match[1])) continue;
    trailingCompany = match[1];
    fields.vehiclePlate ||= normalizeSpokenPlate(match[2]);
  }
  const business = trailingCompany ?? segments.find(part =>
    /^[\p{L}\p{N}][\p{L}\p{N}'&. -]*\b(?:trucking|transport(?:ation)?|logistics|services|solutions|construction|energy|llc|inc|incorporated|company|corp(?:oration)?)$/iu.test(part)
    && !/^(?:first name|last name|plate|tag|state|notes?)\b/i.test(part));
  if (!fields.company && business) fields.company = business;
  const stated = /\b(?:issuing\s+)?state\s*(?:is\s+|of\s+|:\s*|\s+)(.+?)(?=[,;.!]|\s+(?:and\s+)?(?:tag|(?:license\s+)?plate|company|first name|last name|purpose|notes)\b|$)/i.exec(speech.text)?.[1];
  const state = normalizePlateState(stated) ?? parseSpokenPlateState(speech.text) ?? normalizePlateState(speech.text);
  if (state) fields.plateState = state;
  for (const segment of segments) {
    let candidate = segment.replace(/^(?:(?:at|uh|um)[,.\s]+)+/i, "").trim();
    const wholeState = normalizePlateState(candidate);
    if (wholeState) { fields.plateState ||= wholeState; continue; }
    const words = candidate.split(/\s+/);
    let bareState: string | null = null;
    for (let size = 1; size <= Math.min(3, words.length - 1); size++) {
      const suffix = normalizePlateState(words.slice(-size).join(" "));
      const prefix = normalizePlateState(words.slice(0, size).join(" "));
      if (suffix || prefix) {
        bareState = suffix ?? prefix;
        candidate = (suffix ? words.slice(0, -size) : words.slice(size)).join(" ");
        break;
      }
    }
    // Unlabeled plate dictation must consist of plate characters/digit words,
    // never arbitrary prose or a company/name containing a state name.
    // "ABC 123" is a plate; a second plain word ("One Oak") is not.
    const plateTokens = /^(?:[a-z0-9]+|zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s-]+(?:[a-z0-9]|[a-z0-9]{0,4}\d[a-z0-9]{0,4}|zero|oh|one|two|three|four|five|six|seven|eight|nine))*$/i;
    const normalized = normalizeSpokenPlate(candidate);
    if (plateTokens.test(candidate) && /\d/.test(normalized) && normalized.length >= 2 && normalized.length <= 10) {
      fields.vehiclePlate ||= normalized;
      if (bareState) fields.plateState ||= bareState;
    }
  }

  if (!fields.firstName && !fields.lastName) {
    const lead = speech.text.match(/^(?:my name is|name is)\s+([^,;]+)/i)?.[1]
      ?? (opening || expectName || /\S\s+(?:from|with)\s+\S/i.test(speech.text) ? speech.text : "");
    const name = lead.split(/[,;]|\s+(?:from|with|company|(?:license )?plate|tag|state|purpose|notes)\b/i)[0].trim();
    const fieldOrInstruction = /^(?:with|from|start(?:ing)?|try(?:ing)?|reset|stop|okay|ok|again|company|first name|last name|driver|tag|plate|state|and|the|next|another|somebody|someone|this|that|me|us|him|her|check|confirm|red|white|blue|black|green|silver|gray|grey)\b/i;
    const nameWords = /^[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){1,3}$/u;
    if (name !== business && !normalizePlateState(name) && !fieldOrInstruction.test(name) && !NOT_AN_ANSWER.test(name) && nameWords.test(name)) {
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
  if (waitingFor) {
    const taken = (part: string) => /\b(?:first name|last name|name|company|plate|tag|state)\b/i.test(part)
      || Boolean(normalizePlateState(part) ?? parseSpokenPlateState(part))
      || [fields.firstName, fields.lastName, fields.company].some(value => value && part.toLowerCase().includes(value.toLowerCase()))
      || Boolean(fields.vehiclePlate && normalizeSpokenPlate(part).includes(fields.vehiclePlate));
    // "A, B, C." is a plate being spelled, not three one-letter answers.
    const spelled = waitingFor(fields) === "vehiclePlate" ? platePiece(speech.text) : "";
    if (spelled.length >= 2 && spelled.length <= 10) fields.vehiclePlate = spelled;
    for (const part of segments) {
      const field = waitingFor(fields);
      if (!field) break;
      if (part && !taken(part)) Object.assign(fields, bareAnswer(field, part));
    }
  }
  if (fields.firstName) fields.firstName = properName(fields.firstName);
  if (fields.lastName) fields.lastName = properName(fields.lastName);
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
  let continuous = false;
  let requested = false;
  // The start of a plate heard in the previous turn, while the rest may still be coming.
  let partial: string | null = null;
  const gateOf = (draft: GateVoiceDraft) => JSON.stringify([draft.siteLocationId, draft.gateStationId]);
  function attach(context: Context) {
    if (!isGateVoicePage(context.path)) { gate = entry = waiting = null; continuous = false; return; }
    const draft = entryDraft(context);
    if (!draft || !waiting) return;
    gate = gateOf(draft);
    entry = gateCheckInBinding(draft);
    const fields = waiting;
    waiting = null;
    if (requested || Object.keys(fields).length) openGateCheckIn();
    if (Object.keys(fields).length) fillGateCheckIn(fields);
  }
  return {
    attach,
    reset() { gate = entry = waiting = null; requested = false; },
    /** Explicit engagement starts collection without inventing a spoken command. */
    engage(context: Context) {
      if (!isGateVoicePage(context.path) || this.active(context)) return;
      continuous = true;
      waiting = {};
      attach(context);
    },
    active(context: Context) {
      const draft = entryDraft(context);
      return isGateVoicePage(context.path) && (waiting !== null || (draft ? gate === gateOf(draft) : gate !== null));
    },
    review(context: Context) {
      const draft = entryDraft(context);
      if (!draft) return null;
      const preview = gateCheckInReview(draft);
      // The site or gate can finish loading after the last field. A ready form is still the one to submit.
      if (entry !== gateCheckInBinding(draft)) {
        // A reset clears the captured entry. A ready form whose gate id arrives later stays open.
        if (!entry || !preview?.ready) return null;
        entry = gateCheckInBinding(draft);
        gate = gateOf(draft);
      }
      return preview;
    },
    /** The next field to ask for after the operator has said "check in". */
    pending(context: Context): GateCheckInField | null {
      if (!requested || !isGateVoicePage(context.path)) return null;
      const draft = entryDraft(context);
      if (!draft) return waiting ? missingCheckInField(waiting) : null;
      // A saved or reset form is a new entry; wait for the next "check in".
      return entry === gateCheckInBinding(draft) ? missingCheckInField(draft) : null;
    },
    hear(context: Context, transcript: string): "start" | "collect" | null {
      attach(context);
      if (!isGateVoicePage(context.path)) return null;
      const draft = entryDraft(context);
      const said = transcript.trim(), text = said.replace(address, ""), addressed = text !== said;
      const prefix = commandPrefix(text);
      const wasRequested = requested;
      if (commandKind(prefix) === "out") { gate = entry = waiting = null; requested = false; dismissGateCheckIn(); return null; }
      if (prefix) requested = true;
      // Explicit assistant requests must not disappear into visitor field capture. The form keeps listening.
      if (!prefix && ((addressed && !text) || /^(?:who|show|what|where|how)\b/i.test(text))) return null;
      // Once check-in is requested, a bare reply answers the next missing field.
      const fields = () => checkInFields(prefix ? text.slice(prefix[0].length) : text, Boolean(prefix), requested && !(draft?.firstName || draft?.lastName || waiting?.firstName || waiting?.lastName), plateState,
        requested ? found => missingCheckInField({ ...(draft ?? waiting), ...found }) : undefined);
      if (addressed && !prefix && !Object.keys(fields()).length) return null;
      if (!draft) {
        const started = Boolean(prefix && !waiting);
        if (started) waiting = {};
        if (waiting) { Object.assign(waiting, fields()); return started ? "start" : "collect"; }
        return gate ? "collect" : null;
      }
      const nextGate = gateOf(draft), nextEntry = gateCheckInBinding(draft);
      // Explicitly engaged dictation follows the currently selected form, including
      // a gate that resolves after capture starts. Never replay prior fields.
      if (continuous && gate !== nextGate) {
        gate = nextGate; entry = nextEntry;
        if (requested) openGateCheckIn();
      }
      const started = Boolean(prefix) && (!wasRequested || entry !== nextEntry);
      if (prefix) { gate = nextGate; entry = nextEntry; }
      if (gate !== nextGate) { gate = entry = null; continuous = false; return null; }
      if (entry !== nextEntry) {
        if (!continuous) return "collect";
        entry = nextEntry;
        requested = false;
      }
      if (started) openGateCheckIn();
      const updates = fields();
      // A plate read aloud in pieces ("A B C" ... "1 2 3") arrives as separate turns. Join them.
      const found = Object.keys(updates);
      const piece = found.length === 1 && updates.vehiclePlate ? updates.vehiclePlate : found.length || prefix ? "" : platePiece(text);
      if (piece && partial && partial === draft.vehiclePlate && !piece.startsWith(partial) && (partial + piece).length <= 8 && !plateState.normalizePlateState(piece)) {
        updates.vehiclePlate = partial + piece;
        if (typeof draft.plateState === "string" && draft.plateState) updates.plateState = draft.plateState;
      }
      partial = piece && updates.vehiclePlate && updates.vehiclePlate.length <= 4 ? updates.vehiclePlate : null;
      // State and plate can arrive in separate audio turns. Filling the first
      // plate completes that identity; it must not discard its spoken state.
      if (updates.vehiclePlate && !draft.vehiclePlate && !updates.plateState && typeof draft.plateState === "string") {
        updates.plateState = draft.plateState;
      }
      if (Object.keys(updates).length) fillGateCheckIn(updates);
      return started ? "start" : "collect";
    },
  };
}
