import * as Location from "expo-location";

import { visitorCheckIn, type SiteContext } from "./guest";

export type HostOption = {
  key: string;
  label: string;
  type: "partner" | "vendor";
  id: number;
};

export function extractSiteCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const portalIdx = parts.indexOf("portal");
    if (portalIdx >= 0 && parts[portalIdx + 1]) {
      return decodeURIComponent(parts[portalIdx + 1]);
    }
    const visitIdx = parts.indexOf("visit");
    if (visitIdx >= 0 && parts[visitIdx + 1]) {
      return decodeURIComponent(parts[visitIdx + 1]);
    }
  } catch {
    // not a URL — fall through
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

export function buildHostOptions(ctx: SiteContext | null | undefined): HostOption[] {
  if (!ctx) return [];
  const opts: HostOption[] = [];
  if (ctx.partner) {
    opts.push({
      key: `partner:${ctx.partner.id}`,
      label: `${ctx.partner.name} (Partner)`,
      type: "partner",
      id: ctx.partner.id,
    });
  }
  for (const v of ctx.vendors) {
    opts.push({
      key: `vendor:${v.id}`,
      label: `${v.name} (Vendor)`,
      type: "vendor",
      id: v.id,
    });
  }
  return opts;
}

export function canSubmitCheckIn(
  hostKey: string | null,
  ctx: SiteContext | null | undefined,
  busy: boolean,
): boolean {
  if (busy) return false;
  if (!ctx) return false;
  if (!hostKey) return false;
  const opts = buildHostOptions(ctx);
  return opts.some((o) => o.key === hostKey);
}

export function parseDurationMinutes(raw: string): number | undefined {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type SubmitCheckInInput = {
  ctx: SiteContext;
  hostKey: string;
  purpose: string;
  durationStr: string;
};

export type SubmitCheckInResult =
  | { ok: true; visitId: number }
  | { ok: false; reason: "no-host" | "location-denied"; message?: string };

/**
 * Orchestrates the check-in submit path used by the visitor screen:
 *   - resolves the selected host from `buildHostOptions`
 *   - requests foreground location permission
 *   - reads current GPS position
 *   - calls the guest API `visitorCheckIn`
 *
 * Pulled out of the screen so it can be covered by unit tests with mocked
 * `expo-location` and `./guest`.
 */
export async function submitVisitorCheckIn(
  input: SubmitCheckInInput,
): Promise<SubmitCheckInResult> {
  const host = buildHostOptions(input.ctx).find((o) => o.key === input.hostKey);
  if (!host) return { ok: false, reason: "no-host" };

  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") {
    return { ok: false, reason: "location-denied" };
  }

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  const res = await visitorCheckIn({
    siteLocationId: input.ctx.site.id,
    hostType: host.type,
    hostPartnerId: host.type === "partner" ? host.id : undefined,
    hostVendorId: host.type === "vendor" ? host.id : undefined,
    purpose: input.purpose.trim() || undefined,
    expectedDurationMinutes: parseDurationMinutes(input.durationStr),
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
  });

  return { ok: true, visitId: res.id };
}
