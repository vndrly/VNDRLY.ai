import {
  normalizePlateState,
  parseSpokenPlateState,
  type PlateStateCode,
} from "@workspace/plate-state";

export type GateVoiceFill = {
  firstName?: string;
  lastName?: string;
  company?: string;
  vehiclePlate?: string;
  plateState?: PlateStateCode;
  purpose?: string;
  notes?: string;
  duration?: string;
};

export type GateVoiceIntent = "check-in" | "check-out" | "fill";
export type GateVoiceCommand = { intent: GateVoiceIntent; fill: GateVoiceFill };
export type GateCheckoutVisit = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  vehiclePlate?: string | null;
  plateState?: string | null;
  checkInTime: string;
};

export type GateVoiceRecovery = {
  ready: boolean;
  missing: Array<"name" | "plate" | "plateState">;
  prompt: "name" | "plate" | "plateState" | null;
  offerCamera: boolean;
  suggestedPlates: Array<{
    vehiclePlate: string;
    plateState: PlateStateCode | null;
  }>;
};

const CHECK_OUT = /\b(?:check\s*out|checking\s*out)\b/i;
const CHECK_IN = /\b(?:check\s*in|checking\s*in)\b/i;
const FIELD_LABELS = "license plate|plate|tag|state|driver name|driver|name|company|from|with|truck|vehicle|purpose|reason|here for|for|here to|notes|note|remark|comment|duration|time|checking in|check in|checking out|check out";

function valueAfter(text: string, labels: string[]): string | undefined {
  const label = labels.join("|");
  return new RegExp(`(?:${label})\\s*(?:is|number|name)?\\s*[:,-]?\\s*(.+?)(?=\\s+(?:${FIELD_LABELS})\\b|$)`, "i")
    .exec(text)?.[1]?.trim().replace(/[.,;]+$/g, "");
}

function valueAfterToEnd(text: string, labels: string[]): string | undefined {
  const label = labels.join("|");
  return new RegExp(`(?:${label})\\s*(?:is|:)?\\s*(.+)$`, "i")
    .exec(text)?.[1]?.trim()
    .replace(/\s+(?:checking\s+out|check\s+out|checking\s+in|check\s+in)\b.*$/i, "")
    .replace(/[.,;]+$/g, "") || undefined;
}

function applyName(result: GateVoiceFill, driver: string | undefined): void {
  const nameParts = driver?.split(/\s+/).filter(Boolean) ?? [];
  if (!nameParts.length) return;
  result.firstName = nameParts[0];
  if (nameParts.length > 1) result.lastName = nameParts.slice(1).join(" ");
}

function implicitDriver(text: string): string | undefined {
  const withoutAction = text.replace(CHECK_OUT, " ").replace(CHECK_IN, " ").trim();
  const withoutLead = withoutAction.replace(/^(?:please\s+)?(?:the\s+)?(?:visitor\s+)?/i, "");
  const cutoff = withoutLead.search(/\b(?:from|with|company|license\s+plate|plate|tag|truck|vehicle|purpose|reason|here\s+for|for|here\s+to|notes|note|remark|comment|duration|time)\b/i);
  const candidate = (cutoff >= 0 ? withoutLead.slice(0, cutoff) : withoutLead)
    .replace(/^(?:driver|name)\s+/i, "")
    .trim()
    .replace(/[.,;]+$/g, "");
  if (!candidate || !/^[\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,3}$/u.test(candidate)) return undefined;
  return candidate;
}

export function parseGateVoiceEntry(transcript: string): GateVoiceFill {
  const text = transcript.trim();
  const plate = valueAfter(text, ["license plate", "plate", "tag"]);
  const driver = valueAfter(text, ["driver name", "driver", "name"]);
  const company = valueAfter(text, ["company", "from", "with"]);
  const purpose = valueAfter(text, ["purpose", "reason", "here for", "for", "here to"]);
  const notes = valueAfterToEnd(text, ["notes", "note", "remark", "comment"]);
  const duration = valueAfter(text, ["duration", "time"]);
  const result: GateVoiceFill = {};
  if (plate) result.vehiclePlate = plate.replace(/\s+/g, "").toUpperCase();
  applyName(result, driver);
  if (company) result.company = company;
  if (purpose) result.purpose = purpose;
  if (notes) result.notes = notes;
  const minutes = duration?.match(/\d+/)?.[0];
  if (minutes) result.duration = minutes;
  const plateState = parseSpokenPlateState(text);
  if (plateState) result.plateState = plateState;
  return result;
}

export function parseGateVoiceCommand(transcript: string): GateVoiceCommand {
  const intent: GateVoiceIntent = CHECK_OUT.test(transcript) ? "check-out" : CHECK_IN.test(transcript) ? "check-in" : "fill";
  const fill = parseGateVoiceEntry(transcript);
  if (!fill.firstName && !fill.lastName) applyName(fill, implicitDriver(transcript));
  return { intent, fill };
}

export function recoverGateVoiceCommand<T extends GateCheckoutVisit>(
  command: GateVoiceCommand,
  recentVisits: T[],
): GateVoiceRecovery {
  const { fill } = command;
  const normalizedPlate = normalizePlate(fill.vehiclePlate);
  const missing: GateVoiceRecovery["missing"] = [];
  if (!fill.firstName?.trim() || !fill.lastName?.trim()) missing.push("name");
  if (!normalizedPlate || normalizedPlate.length < 4) missing.push("plate");
  else if (!normalizePlateState(fill.plateState)) missing.push("plateState");

  const firstName = normalize(fill.firstName);
  const lastName = normalize(fill.lastName);
  const company = normalize(fill.company);
  const seen = new Set<string>();
  const suggestedPlates = [...recentVisits]
    .filter(
      (visit) =>
        (!firstName || normalize(visit.firstName) === firstName) &&
        (!lastName || normalize(visit.lastName) === lastName) &&
        (!company || normalize(visit.company) === company),
    )
    .sort((a, b) => Date.parse(b.checkInTime) - Date.parse(a.checkInTime))
    .flatMap((visit) => {
      const vehiclePlate = normalizePlate(visit.vehiclePlate);
      const plateState = normalizePlateState(visit.plateState);
      const key = `${plateState ?? ""}:${vehiclePlate}`;
      if (!vehiclePlate || seen.has(key)) return [];
      seen.add(key);
      return [{ vehiclePlate, plateState }];
    })
    .slice(0, 5);

  return {
    ready: missing.length === 0,
    missing,
    prompt: missing[0] ?? null,
    offerCamera: missing.includes("plate") || missing.includes("plateState"),
    suggestedPlates,
  };
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizePlate(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function matchGateCheckoutVisits<T extends GateCheckoutVisit>(visits: T[], fill: GateVoiceFill): T[] {
  const plate = normalizePlate(fill.vehiclePlate);
  const plateState = normalizePlateState(fill.plateState);
  const firstName = normalize(fill.firstName);
  const lastName = normalize(fill.lastName);
  if (!plate && !firstName && !lastName) return [];
  return [...visits]
    .filter((visit) => {
      if (plate && normalizePlate(visit.vehiclePlate) !== plate) return false;
      if (
        plateState &&
        normalizePlateState(visit.plateState) !== plateState
      )
        return false;
      if (firstName && normalize(visit.firstName) !== firstName) return false;
      if (lastName && normalize(visit.lastName) !== lastName) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.checkInTime) - Date.parse(a.checkInTime));
}
