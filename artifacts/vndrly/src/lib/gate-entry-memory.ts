import { normalizePlate } from "@/lib/gatekeeper-log-export";
import type { VisitorRow } from "@/lib/visits-api";
import {
  normalizePlateState,
  plateMatchKey,
  type PlateStateCode,
} from "@workspace/plate-state";

export const MIN_SUGGESTION_LENGTH = 1;
export const MIN_AUTO_FILL_LENGTH = 2;
export const MAX_SUGGESTIONS = 8;

export type GateMemoryField =
  | "firstName"
  | "lastName"
  | "company"
  | "vehiclePlate";

export type GateEntryDraft = {
  firstName: string;
  lastName: string;
  company: string;
  vehiclePlate: string;
  plateState: PlateStateCode | null;
  purpose: string;
  notes: string;
  expectedDuration: string;
};

export type GateMemorySuggestion = {
  id: string;
  label: string;
  detail: string;
  visit: VisitorRow;
  mode: "company" | "visitor";
};

export type GateMemoryResult = {
  suggestions: GateMemorySuggestion[];
  fill: Partial<GateEntryDraft> | null;
};

type GateEntryStringKey = Exclude<keyof GateEntryDraft, "plateState">;

const DRAFT_STRING_KEYS: GateEntryStringKey[] = [
  "firstName",
  "lastName",
  "company",
  "vehiclePlate",
  "purpose",
  "notes",
  "expectedDuration",
];

export function emptyGateDraft(): GateEntryDraft {
  return {
    firstName: "",
    lastName: "",
    company: "",
    vehiclePlate: "",
    plateState: null,
    purpose: "",
    notes: "",
    expectedDuration: "60",
  };
}

export function fillFromVisit(visit: VisitorRow): GateEntryDraft {
  return {
    firstName: visit.firstName,
    lastName: visit.lastName,
    company: visit.company ?? "",
    vehiclePlate: (visit.vehiclePlate ?? "").toUpperCase(),
    plateState: normalizePlateState(visit.plateState),
    purpose: visit.purpose ?? "",
    notes: visit.notes ?? "",
    expectedDuration:
      visit.expectedDurationMinutes != null ? String(visit.expectedDurationMinutes) : "",
  };
}

export function draftsEqual(a: GateEntryDraft, b: GateEntryDraft): boolean {
  return a.plateState === b.plateState
    && DRAFT_STRING_KEYS.every((key) => a[key] === b[key]);
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}


function prefixMatch(value: string | null | undefined, query: string): boolean {
  if (!query.trim()) return true;
  return norm(value).startsWith(norm(query));
}

function platePrefix(value: string | null | undefined, query: string): boolean {
  const needle = normalizePlate(query);
  if (!needle) return true;
  return normalizePlate(value).startsWith(needle);
}


function identityKey(visit: VisitorRow): string {
  return `${norm(visit.firstName)}|${norm(visit.lastName)}|${norm(visit.company)}`;
}

function newestFirst(visits: VisitorRow[]): VisitorRow[] {
  return [...visits].sort((a, b) => {
    const delta = Date.parse(b.checkInTime) - Date.parse(a.checkInTime);
    return delta !== 0 ? delta : b.id - a.id;
  });
}

function visitMatchesDraft(
  visit: VisitorRow,
  draft: GateEntryDraft,
  activeField: GateMemoryField,
): boolean {
  const editingDriver = activeField === "firstName" || activeField === "lastName";
  // A plate prefills the last driver. Once the gatekeeper edits either name,
  // the opposite prefilled name must not exclude another driver at the same
  // company from autocomplete results.
  if (
    (!editingDriver || activeField === "firstName")
    && draft.firstName.trim()
    && !prefixMatch(visit.firstName, draft.firstName)
  ) return false;
  if (
    (!editingDriver || activeField === "lastName")
    && draft.lastName.trim()
    && !prefixMatch(visit.lastName, draft.lastName)
  ) return false;
  if (draft.company.trim()) {
    const companyMatches = editingDriver
      ? norm(visit.company) === norm(draft.company)
      : prefixMatch(visit.company, draft.company);
    if (!companyMatches) return false;
  }
  // A truck can have different drivers. While finding a driver, use the known
  // company but do not let the truck's last plate/driver pairing hide coworkers.
  if (
    activeField !== "firstName"
    && activeField !== "lastName"
    && draft.vehiclePlate.trim()
    && !platePrefix(visit.vehiclePlate, draft.vehiclePlate)
  ) return false;
  if (
    activeField !== "firstName"
    && activeField !== "lastName"
    && draft.plateState
    && normalizePlateState(visit.plateState)
    && normalizePlateState(visit.plateState) !== draft.plateState
  ) return false;
  return true;
}

function plateStateMatchPriority(
  visit: VisitorRow,
  draft: GateEntryDraft,
  activeField: GateMemoryField,
): number {
  if (activeField === "firstName" || activeField === "lastName" || !draft.plateState) return 0;
  return normalizePlateState(visit.plateState) === draft.plateState ? 0 : 1;
}

function rankedMatches(
  visits: VisitorRow[],
  draft: GateEntryDraft,
  activeField: GateMemoryField,
): VisitorRow[] {
  return newestFirst(visits).sort((a, b) =>
    plateStateMatchPriority(a, draft, activeField)
    - plateStateMatchPriority(b, draft, activeField));
}

function queryLength(field: GateMemoryField, value: string): number {
  if (field === "vehiclePlate") return normalizePlate(value).length;
  return value.trim().length;
}

function suggestionDetail(visit: VisitorRow, hide: GateMemoryField | "name"): string {
  const name = `${visit.firstName} ${visit.lastName}`.trim();
  const parts: string[] = [];
  if (hide !== "name") parts.push(name);
  if (hide !== "company" && visit.company) parts.push(visit.company);
  if (hide !== "vehiclePlate" && visit.vehiclePlate) parts.push(visit.vehiclePlate);
  return parts.filter(Boolean).join(" · ");
}

function uniqueBy<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function alreadyMatchesSuggestion(draft: GateEntryDraft, visit: VisitorRow, field: GateMemoryField): boolean {
  if (field === "company") return Boolean(draft.company.trim()) && norm(draft.company) === norm(visit.company);
  if (field === "vehiclePlate") {
    const exactDraftKey = plateMatchKey(draft.plateState, draft.vehiclePlate);
    const exactVisitKey = plateMatchKey(visit.plateState, visit.vehiclePlate);
    const plateMatches = exactDraftKey
      ? exactDraftKey === exactVisitKey
      : normalizePlate(draft.vehiclePlate) === normalizePlate(visit.vehiclePlate);
    return Boolean(normalizePlate(draft.vehiclePlate))
      && plateMatches
      && Boolean(draft.firstName.trim());
  }
  return (
    Boolean(draft.firstName.trim())
    && Boolean(draft.lastName.trim())
    && norm(draft.firstName) === norm(visit.firstName)
    && norm(draft.lastName) === norm(visit.lastName)
    && (!draft.company.trim() || norm(draft.company) === norm(visit.company))
  );
}

function visitorSuggestions(
  matches: VisitorRow[],
  draft: GateEntryDraft,
  field: GateMemoryField,
): GateMemorySuggestion[] {
  const grouped = uniqueBy(matches, (visit) => {
    if (field === "vehiclePlate") {
      return plateMatchKey(visit.plateState, visit.vehiclePlate)
        ?? `legacy:${normalizePlate(visit.vehiclePlate)}`;
    }
    if (field === "company") return norm(visit.company);
    return identityKey(visit);
  });
  return grouped.slice(0, MAX_SUGGESTIONS).flatMap((visit) => {
    const label = field === "vehiclePlate"
      ? (visit.vehiclePlate ?? "").trim()
      : field === "company"
        ? (visit.company ?? "").trim()
        : `${visit.firstName} ${visit.lastName}`.trim();
    if (!label) return [];
    if (alreadyMatchesSuggestion(draft, visit, field)) return [];
    return [{
      id: `${field}:${identityKey(visit)}:${plateMatchKey(visit.plateState, visit.vehiclePlate) ?? `legacy:${normalizePlate(visit.vehiclePlate)}`}`,
      label,
      detail: suggestionDetail(
        visit,
        field === "vehiclePlate" ? "vehiclePlate" : field === "company" ? "company" : "name",
      ),
      visit,
      mode: field === "company" ? "company" : "visitor",
    }];
  });
}

function sameNormalized(
  get: (visit: VisitorRow) => string,
  compare: (value: string) => string,
  matches: VisitorRow[],
): string | undefined {
  const values = new Set(matches.map((visit) => compare(get(visit))));
  if (values.size !== 1) return undefined;
  const [only] = values;
  if (!only) return undefined;
  const source = matches.find((visit) => compare(get(visit)) === only) ?? matches[0];
  return get(source);
}

function sharedFill(matches: VisitorRow[]): Partial<GateEntryDraft> {
  if (matches.length === 0) return {};
  const newest = matches[0];
  const plates = new Set(
    matches.map((visit) => normalizePlate(visit.vehiclePlate)).filter(Boolean),
  );
  if (plates.size === 1) return fillFromVisit(newest);
  const identities = new Set(matches.map(identityKey));
  if (identities.size === 1) return fillFromVisit(newest);

  const fill: Partial<GateEntryDraft> = {};
  const firstName = sameNormalized((visit) => visit.firstName, norm, matches);
  const lastName = sameNormalized((visit) => visit.lastName, norm, matches);
  const company = sameNormalized((visit) => visit.company ?? "", norm, matches);
  const vehiclePlate = sameNormalized((visit) => visit.vehiclePlate ?? "", normalizePlate, matches);
  if (firstName) fill.firstName = firstName;
  if (lastName) fill.lastName = lastName;
  if (company) fill.company = company;
  if (vehiclePlate) fill.vehiclePlate = vehiclePlate;
  return fill;
}

export function shouldApplyField(
  current: string,
  suggested: string,
  key: GateEntryStringKey,
): boolean {
  if (!suggested) return false;
  const trimmed = current.trim();
  if (!trimmed) return true;
  if (key === "vehiclePlate") {
    const currentPlate = normalizePlate(trimmed);
    const suggestedPlate = normalizePlate(suggested);
    return suggestedPlate.startsWith(currentPlate) || currentPlate.startsWith(suggestedPlate);
  }
  if (key === "expectedDuration") {
    return trimmed === "60" || trimmed === suggested;
  }
  return suggested.toLowerCase().startsWith(trimmed.toLowerCase());
}

function effectivelyEqual(key: GateEntryStringKey, current: string, suggested: string): boolean {
  if (current === suggested) return true;
  if (key === "vehiclePlate") {
    return Boolean(normalizePlate(current)) && normalizePlate(current) === normalizePlate(suggested);
  }
  if (key === "company" || key === "firstName" || key === "lastName") {
    return Boolean(norm(current)) && norm(current) === norm(suggested);
  }
  return false;
}

function fillIsUseful(fill: Partial<GateEntryDraft>, draft: GateEntryDraft): boolean {
  if (!draft.plateState && fill.plateState) return true;
  return DRAFT_STRING_KEYS.some((key) => {
    const suggested = fill[key];
    if (suggested == null || suggested === "") return false;
    return shouldApplyField(draft[key], suggested, key) && !effectivelyEqual(key, draft[key], suggested);
  });
}

export function mergeGateFill(current: GateEntryDraft, fill: Partial<GateEntryDraft>): GateEntryDraft {
  const next = { ...current };
  for (const key of DRAFT_STRING_KEYS) {
    const suggested = fill[key];
    if (suggested == null) continue;
    if (shouldApplyField(current[key], suggested, key)) next[key] = suggested;
  }
  if (!current.plateState && fill.plateState) next.plateState = fill.plateState;
  return next;
}

export function pickSuggestionFill(suggestion: GateMemorySuggestion): Partial<GateEntryDraft> {
  if (suggestion.mode === "company") {
    return { company: suggestion.visit.company ?? suggestion.label };
  }
  return fillFromVisit(suggestion.visit);
}

export function applyGateMemorySuggestion(
  draft: GateEntryDraft,
  suggestion: GateMemorySuggestion,
  activeField: GateMemoryField | null,
): GateEntryDraft {
  const next = mergeGateFill(draft, pickSuggestionFill(suggestion));
  if (
    suggestion.mode === "visitor"
    && (activeField === "firstName" || activeField === "lastName")
  ) {
    next.firstName = suggestion.visit.firstName;
    next.lastName = suggestion.visit.lastName;
  }
  return next;
}

export function evaluateGateMemory(input: {
  visits: VisitorRow[];
  draft: GateEntryDraft;
  activeField: GateMemoryField | null;
  isDeleting?: boolean;
  minAutoFillLength?: number;
  minSuggestionLength?: number;
}): GateMemoryResult {
  const {
    visits,
    draft,
    activeField,
    isDeleting = false,
    minAutoFillLength = MIN_AUTO_FILL_LENGTH,
    minSuggestionLength = MIN_SUGGESTION_LENGTH,
  } = input;
  const query = activeField ? draft[activeField] : "";
  const length = activeField ? queryLength(activeField, query) : 0;
  const browsingExactCompanyDrivers = Boolean(
    (activeField === "firstName" || activeField === "lastName")
    && !query.trim()
    && draft.company.trim()
    && visits.some((visit) => norm(visit.company) === norm(draft.company)),
  );
  if (!activeField || (!browsingExactCompanyDrivers && length < minSuggestionLength)) {
    return { suggestions: [], fill: null };
  }
  const matches = rankedMatches(
    visits.filter((visit) => visitMatchesDraft(visit, draft, activeField)),
    draft,
    activeField,
  );
  const suggestionSource = activeField === "company"
    ? uniqueBy(matches.filter((visit) => (visit.company ?? "").trim()), (visit) => norm(visit.company))
    : matches;
  const suggestions = visitorSuggestions(suggestionSource, draft, activeField);

  if (browsingExactCompanyDrivers || isDeleting || length < minAutoFillLength) {
    return { suggestions, fill: null };
  }

  const exactPlateMatches = activeField !== "firstName" && activeField !== "lastName" && draft.plateState
    ? matches.filter((visit) =>
        plateMatchKey(visit.plateState, visit.vehiclePlate)
        === plateMatchKey(draft.plateState, draft.vehiclePlate))
    : [];
  const fill = sharedFill(exactPlateMatches.length > 0 ? exactPlateMatches : matches);
  if (!fillIsUseful(fill, draft)) {
    return { suggestions, fill: null };
  }
  return { suggestions, fill };
}
