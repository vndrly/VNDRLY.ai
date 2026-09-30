/** Common speech controls for the web and native gate forms. No network or model state. */
const DIGITS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const NATO = "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu".split(" ");
export function normalizeSpokenPlate(value: string): string {
  return value.trim().split(/\s+/).map(token => {
    const word = token.toLowerCase().replace(/[.,]/g, "");
    const index = NATO.indexOf(word);
    return DIGITS[word] ?? (index >= 0 ? String.fromCharCode(65 + index) : token);
  }).join("").toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

export type GateSpeechFields = Partial<Record<"firstName" | "lastName" | "company" | "vehiclePlate", string>>;
/** Fill only when all matching history agrees on one identity; never overwrite operator facts. */
export function recoverGateSpeechFields(draft: GateSpeechFields, visits: Array<Partial<Record<keyof GateSpeechFields, string | null>> & { plateState?: string | null; checkInTime?: string }>): GateSpeechFields & { plateState?: string } {
  const keys = ["firstName", "lastName", "company", "vehiclePlate"] as const;
  const supplied = keys.filter(key => draft[key]?.trim());
  if (!supplied.length) return {};
  const normalized = (value?: string | null) => (value ?? "").trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const matches = visits.filter(visit => supplied.every(key => normalized(visit[key]) === normalized(draft[key])));
  if (!matches.length) return {};
  const identities = new Set(matches.map(visit => keys.map(key => normalized(visit[key])).join("|")));
  if (identities.size !== 1) return {};
  const latest = [...matches].sort((a,b) => Date.parse(b.checkInTime ?? "") - Date.parse(a.checkInTime ?? ""))[0];
  return {
    ...Object.fromEntries(keys.filter(key => !draft[key]?.trim() && latest[key]?.trim()).map(key => [key, latest[key]!])),
    ...(latest.plateState && new Set(matches.map(v => v.plateState)).size === 1 ? { plateState: latest.plateState } : {}),
  };
}
export function interpretGateSpeech(utterance: string): {
  action: "check-in" | "check-out" | "fill" | "cancel";
  submit: boolean;
  reset: boolean;
  text: string;
  fields: GateSpeechFields;
} {
  const original = utterance.replace(/’/g, "'").trim();
  const cancel = /\b(cancel(?: that)?|never mind|nevermind)\b/i.test(original);
  const inhibited = cancel || /\b(do not|don't|dont)\b/i.test(original) || /\?|\b(how do|how can|if I|he said|she said|they said)\b/i.test(original);
  const checkout = /\b(?:check(?:ing)?[ -]*(?:him\s+|her\s+|them\s+|it\s+)?out|log (?:him|her|them|it) out)\b/i;
  const checkin = /\b(?:check(?:ing)?[ -]*(?:him\s+|her\s+|them\s+|it\s+)?in|log (?:him|her|them|it)(?: in)?|submit|finish(?: it)?|complete(?: it)?)\b/i;
  const action = cancel ? "cancel" : checkout.test(original) ? "check-out" : checkin.test(original) ? "check-in" : "fill";
  const reset = /\bnext (?:truck|vehicle|visitor)\b/i.test(original);
  let text = original.replace(/^\s*(?:okay[, ]+)?(?:hey[, ]+)?V[, ]+/i, "")
    .replace(/\bnext (?:truck|vehicle|visitor)[, ]*/i, "")
    .replace(/\b(?:and\s+)?(?:check (?:him|her|them|it) (?:in|out)|log (?:him|her|them|it)(?: in| out)?|submit(?: that)?|finish(?: it)?|complete(?: it)?)[.! ]*$/i, "")
    .replace(/\b(?:change|correct)\s+(?:the\s+)?(plate|company|first name|last name|name)\s+to\s+/gi, "$1 ")
    .replace(/[, .!]+$/g, "").trim();
  if (/^(?:please\s+)?check[ -]?(?:in|out)(?:\s+and)?$/i.test(text)) text = "";
  const fields: GateSpeechFields = {};
  const labels = "first name|last name|license plate|plate|tag|driver name|driver|name|company|from|with|state|truck|vehicle|purpose|reason|here for|here to|for|notes|note|remark|comment|duration|time|checking in|check in|checking out|check out";
  const capture = (label: string) => new RegExp(`\\b(?:${label})\\s*(?:is|number|:)\\s*(.+?)(?=[,;]|\\s+(?:${labels})\\b|$)`, "i").exec(text)?.[1]?.trim()
    ?? new RegExp(`\\b(?:${label})\\s+(.+?)(?=[,;]|\\s+(?:${labels})\\b|$)`, "i").exec(text)?.[1]?.trim();
  const plate = capture("license plate|plate|tag");
  if (plate) fields.vehiclePlate = normalizeSpokenPlate(plate);
  const company = capture("company|from|with");
  if (company) fields.company = company;
  const first = capture("first name"), last = capture("last name");
  if (first) fields.firstName = first;
  if (last) fields.lastName = last;
  const named = text.match(/\b([\p{L}'-]+\s+[\p{L}'-]+)\s+is\s+(?:his|her|their)\s+name\b/u)?.[1];
  const name = named ?? (!first && !last ? capture("driver name|driver|name") : undefined);
  const assignName = (value: string) => {
    const parts = value.trim().split(/\s+/);
    if (parts.length >= 2 && parts.length <= 4) { fields.firstName = parts[0]; fields.lastName = parts.slice(1).join(" "); }
  };
  if (name) assignName(name);
  // Comma-delimited dispatch wording: "Bob's Trucking, Bob Vila, plate ...".
  const segments = text.split(/[,;]/).map(value => value.trim()).filter(Boolean);
  if (reset && segments.length >= 2 && !new RegExp(`\\b(?:${labels})\\b`, "i").test(segments[0])) {
    fields.company ??= segments[0];
    if (!fields.firstName && /^[\p{L}'-]+(?:\s+[\p{L}'-]+){1,3}$/u.test(segments[1])) assignName(segments[1]);
  }
  if (inhibited) return { action: cancel ? "cancel" : "fill", submit: false, reset: cancel, text: "", fields: {} };
  return { action, submit: action === "check-in" || action === "check-out", reset, text, fields };
}
