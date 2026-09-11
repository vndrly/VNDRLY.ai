export type GateAskVHostOption = {
  label: string;
  type: "partner" | "vendor";
};

export type GateAskVDraftContext = {
  selectedSite: { name: string; address: string | null } | null;
  draft: {
    firstName: string;
    lastName: string;
    company: string;
    vehiclePlate: string;
    plateState: string | null;
    purpose: string;
    notes: string;
    expectedDurationMinutes: number | null;
  };
  selectedHost: GateAskVHostOption | null;
  authorizedHosts: GateAskVHostOption[];
};

export type GateAskVTurn =
  | { kind: "answer"; topic: "duration"; messageKey: string; params: Record<string, string>; contextEpoch: number }
  | { kind: "host-selection"; host: GateAskVHostOption; messageKey: string; params: Record<string, string>; contextEpoch: number }
  | { kind: "clarification"; reason: "no-site" | "missing-duration" | "missing-host" | "ambiguous-host"; messageKey: string; params?: Record<string, string>; contextEpoch: number }
  | { kind: "unhandled"; contextEpoch: number };

const DURATION_QUESTION = /\b(?:how\s+long|expected\s+(?:duration|time)|duration\s+(?:did|do|is|was)|capture(?:d)?\s+how\s+long)\b/i;
const HOST_COMMAND = /\bhost\s+(?:is\s+)?(.+?)\s*[?.!]*$/i;

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourText = `${hours} hour${hours === 1 ? "" : "s"}`;
  return remainder
    ? `${hourText} ${remainder} minute${remainder === 1 ? "" : "s"}`
    : hourText;
}

export function evaluateGateAskVTurn(
  transcript: string,
  context: GateAskVDraftContext,
  contextEpoch: number,
): GateAskVTurn {
  const asksDuration = DURATION_QUESTION.test(transcript);
  const hostRequest = HOST_COMMAND.exec(transcript)?.[1];
  if (!asksDuration && !hostRequest) return { kind: "unhandled", contextEpoch };
  if (!context.selectedSite) {
    return {
      kind: "clarification",
      reason: "no-site",
      messageKey: "gatekeeper.askvSelectSite",
      contextEpoch,
    };
  }
  if (asksDuration) {
    const duration = context.draft.expectedDurationMinutes;
    if (!duration || duration <= 0) {
      return {
        kind: "clarification",
        reason: "missing-duration",
        messageKey: "gatekeeper.askvDurationMissing",
        contextEpoch,
      };
    }
    return {
      kind: "answer",
      topic: "duration",
      messageKey: "gatekeeper.askvDurationCaptured",
      params: { duration: formatDuration(duration) },
      contextEpoch,
    };
  }
  const requested = normalized(hostRequest!);
  const matches = context.authorizedHosts.filter((host) => {
    const label = normalized(host.label);
    return label === requested || label.startsWith(`${requested} `);
  });
  if (matches.length === 1) {
    return {
      kind: "host-selection",
      host: matches[0],
      messageKey: "gatekeeper.askvHostSelected",
      params: { host: matches[0].label },
      contextEpoch,
    };
  }
  if (matches.length > 1) {
    return {
      kind: "clarification",
      reason: "ambiguous-host",
      messageKey: "gatekeeper.askvHostAmbiguous",
      params: { options: matches.map((host) => host.label).join(" or ") },
      contextEpoch,
    };
  }
  return {
    kind: "clarification",
    reason: "missing-host",
    messageKey: "gatekeeper.askvHostMissing",
    contextEpoch,
  };
}

export function applyGateAskVTurn(
  result: GateAskVTurn,
  currentContextEpoch: number,
): GateAskVTurn | { kind: "stale" } {
  return result.contextEpoch === currentContextEpoch ? result : { kind: "stale" };
}
