import {
  formatMetersAsMiles,
  haversineMeters,
  METERS_PER_MILE,
} from "@workspace/map-utils";

export type GpsLockState = "locked" | "searching" | "denied" | "unavailable";

export type GpsFenceSite = {
  latitude: number;
  longitude: number;
  siteRadiusMeters: number;
};

export type GpsFenceInput = {
  gps: GpsLockState;
  origin: { latitude: number; longitude: number } | null;
  site: GpsFenceSite | null;
};

export type GpsFenceStatus = {
  gps: GpsLockState;
  milesToSite: number | null;
  radiusMiles: number | null;
  insideFence: boolean;
  canSubmit: boolean;
};

export type FenceSentence = {
  kind: "searching" | "denied" | "unavailable" | "noSite" | "tooFar" | "inside";
  miles: string | null;
  radius: string | null;
};

export const MAX_VISIT_NOTES_LENGTH = 2000;

export const GATE_DURATION_CHIPS = [
  { id: "30m", minutes: 30 },
  { id: "2h", minutes: 120 },
  { id: "allDay", minutes: 600 },
  { id: "overnight", minutes: 720 },
] as const;

export type GateDurationChipId = (typeof GATE_DURATION_CHIPS)[number]["id"];

export function minutesForDurationChip(id: string): number | null {
  return GATE_DURATION_CHIPS.find((chip) => chip.id === id)?.minutes ?? null;
}

function milesNumber(meters: number): number {
  return Math.round((meters / METERS_PER_MILE) * 10) / 10;
}

export function evaluateGpsFence(input: GpsFenceInput): GpsFenceStatus {
  const radiusMiles =
    input.site && Number.isFinite(input.site.siteRadiusMeters)
      ? milesNumber(input.site.siteRadiusMeters)
      : null;
  if (input.gps !== "locked" || !input.origin || !input.site) {
    return {
      gps: input.gps,
      milesToSite: null,
      radiusMiles,
      insideFence: false,
      canSubmit: false,
    };
  }
  const meters = haversineMeters(
    input.origin.latitude,
    input.origin.longitude,
    input.site.latitude,
    input.site.longitude,
  );
  const insideFence = meters <= input.site.siteRadiusMeters;
  return {
    gps: "locked",
    milesToSite: milesNumber(meters),
    radiusMiles,
    insideFence,
    canSubmit: insideFence,
  };
}

export function formatFenceMilesSentence(status: GpsFenceStatus): FenceSentence {
  const radius = status.radiusMiles == null ? null : formatMetersAsMiles(status.radiusMiles * METERS_PER_MILE);
  if (status.gps === "searching") return { kind: "searching", miles: null, radius };
  if (status.gps === "denied") return { kind: "denied", miles: null, radius };
  if (status.gps === "unavailable") return { kind: "unavailable", miles: null, radius };
  if (status.milesToSite == null) return { kind: "noSite", miles: null, radius };
  const miles = formatMetersAsMiles(status.milesToSite * METERS_PER_MILE);
  return {
    kind: status.insideFence ? "inside" : "tooFar",
    miles,
    radius,
  };
}

export type NamedSite = {
  name: string;
  latitude: number;
  longitude: number;
};

export function siteDisplayName(site: { name: string }): string {
  return site.name.trim();
}

export function siteLabelExposesCode(label: string): boolean {
  return /\bSITE-[A-Z0-9]+\b/i.test(label);
}

export function sortSitesByNameAndDistance<T extends NamedSite>(
  sites: T[],
  origin: { latitude: number; longitude: number } | null,
): Array<T & { distanceMeters: number | null }> {
  const ranked = sites.map((site) => ({
    ...site,
    distanceMeters: origin
      ? haversineMeters(origin.latitude, origin.longitude, site.latitude, site.longitude)
      : null,
  }));
  ranked.sort((a, b) => {
    if (a.distanceMeters != null && b.distanceMeters != null) {
      const delta = a.distanceMeters - b.distanceMeters;
      if (delta !== 0) return delta;
    }
    return siteDisplayName(a).localeCompare(siteDisplayName(b));
  });
  return ranked;
}

export function trimVisitNotes(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_VISIT_NOTES_LENGTH);
  return trimmed || null;
}

export function onSiteDwell(input: {
  checkInTime: string;
  expectedDurationMinutes: number | null | undefined;
  nowMs?: number;
}): { minutesOnSite: number; overdue: boolean; overdueMinutes: number } {
  const start = Date.parse(input.checkInTime);
  const now = input.nowMs ?? Date.now();
  const minutesOnSite = Number.isFinite(start)
    ? Math.max(0, Math.round((now - start) / 60000))
    : 0;
  const expected =
    typeof input.expectedDurationMinutes === "number" && input.expectedDurationMinutes > 0
      ? input.expectedDurationMinutes
      : null;
  const overdueMinutes =
    expected != null && minutesOnSite > expected ? minutesOnSite - expected : 0;
  return {
    minutesOnSite,
    overdue: overdueMinutes > 0,
    overdueMinutes,
  };
}
export * from "./change-over";
