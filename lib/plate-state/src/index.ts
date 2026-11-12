export * from "./recognition";

export interface PlateState {
  code: string;
  name: string;
}

/** The 50 USPS state codes plus the District of Columbia, by display name. */
export const US_PLATE_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
] as const;

export type PlateStateCode = (typeof US_PLATE_STATES)[number]["code"];

export const NATIONAL_PLATE_STATE_FALLBACK = [
  "CA",
  "TX",
  "NY",
  "FL",
  "OH",
] as const;

export const PLATE_OCR_STATE_CONFIDENCE_THRESHOLD = 0.8;

const STATE_BY_CODE = new Map<string, (typeof US_PLATE_STATES)[number]>(
  US_PLATE_STATES.map((state) => [state.code, state]),
);

const STATE_CODE_BY_NAME = new Map<string, PlateStateCode>(
  US_PLATE_STATES.map((state) => [state.name.toLowerCase(), state.code]),
);

const AMBIGUOUS_SPOKEN_STATE_CODES = new Set<PlateStateCode>([
  "HI",
  "ID",
  "IN",
  "ME",
  "OH",
  "OK",
  "OR",
]);

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SPOKEN_STATE_NAME_PATTERN = [...US_PLATE_STATES]
  .sort((a, b) => b.name.length - a.name.length)
  .map((state) => escapeRegExp(state.name))
  .join("|");

const SPOKEN_STATE_CODE_PATTERN = US_PLATE_STATES.map(
  (state) => state.code,
).join("|");

const UNAMBIGUOUS_SPOKEN_STATE_CODE_PATTERN = US_PLATE_STATES.map(
  (state) => state.code,
)
  .filter((code) => !AMBIGUOUS_SPOKEN_STATE_CODES.has(code))
  .join("|");

const SPOKEN_PLATE_LABEL_PATTERN = "(?:license\\s+plate|plate|tag)";
const SPOKEN_LABEL_SEPARATOR_PATTERN = "(?:\\s+|\\s*[,;:.!?-]\\s*)";

const EXPLICIT_SPOKEN_STATE_PATTERN = new RegExp(
  `(?:^|\\s)state\\s*[:,-]?\\s+(${SPOKEN_STATE_NAME_PATTERN}|${SPOKEN_STATE_CODE_PATTERN})(?=${SPOKEN_LABEL_SEPARATOR_PATTERN}${SPOKEN_PLATE_LABEL_PATTERN}\\b)`,
  "i",
);

const FULL_NAME_BEFORE_PLATE_PATTERN = new RegExp(
  `(?:^|\\s)(${SPOKEN_STATE_NAME_PATTERN})(?=${SPOKEN_LABEL_SEPARATOR_PATTERN}${SPOKEN_PLATE_LABEL_PATTERN}\\b)`,
  "i",
);

const UNAMBIGUOUS_CODE_BEFORE_PLATE_PATTERN = new RegExp(
  `(?:^|\\s)(${UNAMBIGUOUS_SPOKEN_STATE_CODE_PATTERN})(?=${SPOKEN_LABEL_SEPARATOR_PATTERN}${SPOKEN_PLATE_LABEL_PATTERN}\\b)`,
  "i",
);

const STATE_SEARCH_PREFIXES = [...US_PLATE_STATES]
  .sort((a, b) => b.name.length - a.name.length)
  .flatMap((state) =>
    [state.name, state.code].map((label) => ({
      state: state.code,
      pattern: new RegExp(
        `^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|[•:])+(.+)$`,
        "i",
      ),
    })),
  );

/** Returns a canonical USPS code for a full state name or abbreviation. */
export function normalizePlateState(
  state: string | null | undefined,
): PlateStateCode | null {
  if (typeof state !== "string") return null;

  const normalized = state.trim().toUpperCase();
  if (STATE_BY_CODE.has(normalized)) return normalized as PlateStateCode;

  return STATE_CODE_BY_NAME.get(state.trim().toLowerCase()) ?? null;
}

/** Normalizes entered plate text for display while retaining its punctuation. */
export function normalizePlateNumber(
  plate: string | null | undefined,
): string | null {
  if (typeof plate !== "string") return null;

  const normalized = plate.trim().toUpperCase();
  return normalized || null;
}

export interface AutomatedPlateUpdate {
  currentPlate: string | null | undefined;
  currentState: string | null | undefined;
  automatedPlate: string | null | undefined;
  automatedState: string | null | undefined;
}

/**
 * Reconciles OCR/voice output without carrying a manual state onto a different
 * vehicle. Plate identity ignores display punctuation, matching the rest of
 * the gate workflow. An automated valid state is authoritative; otherwise a
 * manual state survives only when the normalized plate identity is unchanged.
 */
export function reconcileAutomatedPlateUpdate({
  currentPlate,
  currentState,
  automatedPlate,
  automatedState,
}: AutomatedPlateUpdate): {
  vehiclePlate: string | null;
  plateState: PlateStateCode | null;
} {
  const normalizedCurrentPlate = normalizePlateNumber(currentPlate);
  const normalizedAutomatedPlate = normalizePlateNumber(automatedPlate);
  const vehiclePlate = normalizedAutomatedPlate ?? normalizedCurrentPlate;
  const recognizedState = normalizePlateState(automatedState);
  if (recognizedState) return { vehiclePlate, plateState: recognizedState };

  const identity = (plate: string | null) =>
    plate?.replace(/[^A-Z0-9]/g, "") || null;
  const plateChanged =
    normalizedAutomatedPlate !== null &&
    identity(normalizedAutomatedPlate) !== identity(normalizedCurrentPlate);

  return {
    vehiclePlate,
    plateState: plateChanged ? null : normalizePlateState(currentState),
  };
}

/** Formats a plate in the state-qualified style used across check-in surfaces. */
export function formatPlate(
  state: string | null | undefined,
  plate: string | null | undefined,
): string | null {
  const normalizedState = normalizePlateState(state);
  const normalizedPlate = normalizePlateNumber(plate);
  return [normalizedState, normalizedPlate].filter(Boolean).join(" • ") || null;
}

/** Adds the translated legacy-state marker used by plate presentation surfaces. */
export function formatPlateForDisplay(
  state: string | null | undefined,
  plate: string | null | undefined,
  stateUnconfirmedLabel: string,
): string | null {
  const formatted = formatPlate(state, plate);
  if (!formatted) return null;
  return normalizePlateState(state)
    ? formatted
    : `${formatted} (${stateUnconfirmedLabel})`;
}

/**
 * Reads a state immediately before a spoken plate label. Codes that are also
 * ordinary English words require an explicit "state" cue; full names do not.
 */
export function parseSpokenPlateState(
  transcript: string | null | undefined,
): PlateStateCode | null {
  if (typeof transcript !== "string") return null;

  const spoken =
    EXPLICIT_SPOKEN_STATE_PATTERN.exec(transcript)?.[1] ??
    FULL_NAME_BEFORE_PLATE_PATTERN.exec(transcript)?.[1] ??
    UNAMBIGUOUS_CODE_BEFORE_PLATE_PATTERN.exec(transcript)?.[1];
  return normalizePlateState(spoken);
}

/** Builds a punctuation-insensitive, state-aware key for plate matching. */
export function plateMatchKey(
  state: string | null | undefined,
  plate: string | null | undefined,
) {
  const normalizedState = normalizePlateState(state);
  const normalizedPlate = normalizePlateNumber(plate);
  const plateKey = normalizedPlate?.replace(/[^A-Z0-9]/g, "");
  return normalizedState && plateKey ? `${normalizedState}:${plateKey}` : null;
}

/** Matches plate-only or state-qualified search text without punctuation sensitivity. */
export function plateMatchesSearch(
  state: string | null | undefined,
  plate: string | null | undefined,
  query: string | null | undefined,
): boolean {
  const normalizedPlate = normalizePlateNumber(plate);
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  if (!normalizedQuery) return true;
  if (!normalizedPlate) return false;

  const normalizedState = normalizePlateState(state);
  const stateQualifiedQuery = STATE_SEARCH_PREFIXES.map(
    ({ state: queryState, pattern }) => ({
      state: queryState,
      match: pattern.exec(normalizedQuery),
    }),
  ).find(({ match }) => Boolean(match));
  if (stateQualifiedQuery?.match) {
    const plateQuery = stateQualifiedQuery.match[1]
      .replace(/[^a-z0-9]/gi, "")
      .toUpperCase();
    const plateKey = normalizedPlate.replace(/[^a-z0-9]/gi, "").toUpperCase();
    return (
      normalizedState === stateQualifiedQuery.state &&
      Boolean(plateQuery) &&
      plateKey.includes(plateQuery)
    );
  }

  const stateName = normalizedState
    ? (STATE_BY_CODE.get(normalizedState)?.name ?? null)
    : null;
  const candidates = [
    normalizedPlate,
    formatPlate(normalizedState, normalizedPlate),
    normalizedState ? `${normalizedState} ${normalizedPlate}` : null,
    stateName ? `${stateName} ${normalizedPlate}` : null,
  ].filter((value): value is string => Boolean(value));
  const searchKey = normalizedQuery.replace(/[^a-z0-9]/g, "");
  return (
    Boolean(searchKey) &&
    candidates.some((candidate) =>
      candidate
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .includes(searchKey),
    )
  );
}

/**
 * Places normalized preferred codes first, then appends every unseen catalog
 * state in alphabetical name order before applying an optional search query.
 */
export function orderPlateStates(
  preferredStates: readonly (string | null | undefined)[],
  query: string | null | undefined = "",
): readonly (typeof US_PLATE_STATES)[number][] {
  const search = query?.trim().toLowerCase() ?? "";
  const seen = new Set<PlateStateCode>();
  const ordered: (typeof US_PLATE_STATES)[number][] = [];

  const addState = (value: string | null | undefined) => {
    const code = normalizePlateState(value);
    if (!code || seen.has(code)) return;

    const state = STATE_BY_CODE.get(code);
    if (!state) return;
    seen.add(code);
    ordered.push(state);
  };

  preferredStates.forEach(addState);
  US_PLATE_STATES.forEach((state) => addState(state.code));

  return ordered.filter(
    (state) =>
      !search ||
      state.code.toLowerCase().includes(search) ||
      state.name.toLowerCase().includes(search),
  );
}
