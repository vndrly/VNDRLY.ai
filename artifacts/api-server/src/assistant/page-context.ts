/** Browser path the client sends so askV can tailor answers to "this page". */
export type AssistantPageContext = {
  path: string;
  entityId?: number | null;
  gateDraft?: Record<string, unknown>;
  currentLocation?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number | null;
    capturedAt?: string | null;
    source: "mobile_device" | "web_browser";
  };
};
export function parseGateDraft(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const allowed = new Set(["firstName", "lastName", "company", "vehiclePlate", "plateState", "purpose", "notes", "siteLocationId", "expectedDurationMinutes"]);
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) => allowed.has(key) &&
    ((typeof value === "string" && value.length <= 1000) || (typeof value === "number" && Number.isFinite(value)))));
}

function parseCurrentLocation(raw: unknown): AssistantPageContext["currentLocation"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const latitude = (raw as { latitude?: unknown }).latitude;
  const longitude = (raw as { longitude?: unknown }).longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }
  const accuracyRaw = (raw as { accuracyMeters?: unknown }).accuracyMeters;
  const capturedAtRaw = (raw as { capturedAt?: unknown }).capturedAt;
  const sourceRaw = (raw as { source?: unknown }).source;
  const source = sourceRaw === "web_browser" ? "web_browser" : "mobile_device";
  return {
    latitude,
    longitude,
    accuracyMeters:
      typeof accuracyRaw === "number" && Number.isFinite(accuracyRaw)
        ? accuracyRaw
        : null,
    capturedAt: typeof capturedAtRaw === "string" ? capturedAtRaw : null,
    source,
  };
}

/** Parse optional pageContext from the assistant chat POST body. */
export function parsePageContext(
  raw: unknown,
): AssistantPageContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const path = typeof (raw as { path?: unknown }).path === "string"
    ? (raw as { path: string }).path.trim()
    : "";
  if (!path || path.length > 512) return undefined;
  const entityIdRaw = (raw as { entityId?: unknown }).entityId;
  const entityId =
    typeof entityIdRaw === "number" && Number.isFinite(entityIdRaw)
      ? Math.floor(entityIdRaw)
      : undefined;
  const currentLocation = parseCurrentLocation((raw as { currentLocation?: unknown }).currentLocation);
  return {
    path,
    ...(entityId != null ? { entityId } : {}),
    ...(currentLocation ? { currentLocation } : {}),
    ...(parseGateDraft((raw as AssistantPageContext).gateDraft) ? { gateDraft: parseGateDraft((raw as AssistantPageContext).gateDraft) } : {}),
  };
}
