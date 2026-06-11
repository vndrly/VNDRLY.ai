import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { BrandZoomControlInMap } from "@/components/brand-zoom-control";
import "leaflet/dist/leaflet.css";
import { Link } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, BatteryLow, Clock, Gauge, MapPin, Navigation, RefreshCw, Shield, UserCheck } from "lucide-react";
import { visitsApi, type VisitorRow } from "@/lib/visits-api";
import { useListSiteLocations, getListSiteLocationsQueryKey } from "@workspace/api-client-react";
import LiveConnectionPill, { type LiveConnectionStatus } from "@/components/live-connection-pill";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { GeofenceCirclesLayer, type GeofenceSite } from "@/components/map/geofence-circles-layer";
import {
  isProblemCrewMember,
} from "@workspace/map-utils";
import { Checkbox } from "@/components/ui/checkbox";
import { RecentTripsCard } from "@/components/map/recent-trips-card";

const LOW_BATTERY_THRESHOLD = 0.2;

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// Safety re-sync polls for when the live SSE channel drops or misses events.
const LOCATIONS_FALLBACK_POLL_MS = 5 * 60_000;
const VISITORS_FALLBACK_POLL_MS = 60_000;
// Drop crew pins that have not pinged in this long (matches server freshness window).
const LIVE_PING_FRESH_MS = 15 * 60_000;
// Task #116 — when the live-locations SSE channel has been errored for more
// than this long, we (a) surface a prominent "Live updates paused" indicator
// so the dispatcher knows the pins they're staring at may be minutes stale
// rather than seconds, and (b) force a manual close+reopen of the
// `EventSource`. The browser handles transient drops on its own, but proxy
// 502s and laptop sleep/wake cycles can leave the underlying socket wedged
// indefinitely — at which point only an explicit reconnect kick recovers
// without a page reload. After a successful reopen we re-fetch
// `/api/live-locations` once to backfill any pings that landed during the
// gap.
const LIVE_STUCK_RECONNECT_MS = 10_000;

type LiveLocation = {
  employeeId: number;
  employeeName: string;
  ticketId: number;
  vendorId: number;
  lifecycleState: string | null;
  siteName: string | null;
  siteCode: string | null;
  // Destination site coords (when assigned). Used to draw the route line and
  // compute distance / ETA. Null for tickets without geocoded sites.
  siteLatitude: number | null;
  siteLongitude: number | null;
  latitude: number;
  longitude: number;
  batteryLevel: number | null;
  // Compass bearing in degrees (0=N, 90=E). null when stationary or unknown.
  heading: number | null;
  // Ground speed in meters/second from the device GPS, or null when unknown.
  speedMps: number | null;
  recordedAt: string;
};

// Average road speed assumption used to convert straight-line distance into
// an ETA when the device isn't actively reporting speed (or speed is too low
// to be meaningful, e.g. parked at a light).
const ETA_DEFAULT_MPH = 31;
// Below this speed (≈ 4 mph) we treat the employee as stationary and don't
// rely on it for ETA — they're likely parked, walking around the truck, etc.
const SPEED_MIN_MOVING_MPS = 1.8;
// Within this distance the employee is "at the site" — don't show an ETA.
const AT_SITE_RADIUS_M = 150;
// Conversion constants. We always render in miles/mph regardless of locale.
const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.23694;

function toRad(d: number): number { return (d * Math.PI) / 180; }

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatSpeed(
  mps: number | null,
  t: (k: string, opts?: any) => string,
): string {
  if (mps == null || mps < SPEED_MIN_MOVING_MPS) return t("crewMap.speedParked");
  return t("crewMap.speedMph", { mph: Math.round(mps * MPS_TO_MPH) });
}

function formatDistance(
  meters: number,
  t: (k: string, opts?: any) => string,
): string {
  const mi = meters / METERS_PER_MILE;
  return t("crewMap.distanceToSiteMi", { mi: mi < 10 ? mi.toFixed(1) : Math.round(mi) });
}

// Compute ETA in minutes from current location to site. Use device speed when
// it's a meaningful "moving" reading, otherwise fall back to the road-speed
// assumption. Returns null when no site coords are available.
function etaMinutes(
  fromLat: number,
  fromLng: number,
  siteLat: number | null,
  siteLng: number | null,
  speedMps: number | null,
): { meters: number; minutes: number } | null {
  if (siteLat == null || siteLng == null) return null;
  const meters = haversineMeters(fromLat, fromLng, siteLat, siteLng);
  if (meters < AT_SITE_RADIUS_M) return { meters, minutes: 0 };
  const mph =
    speedMps != null && speedMps >= SPEED_MIN_MOVING_MPS
      ? speedMps * MPS_TO_MPH
      : ETA_DEFAULT_MPH;
  const minutes = (meters / METERS_PER_MILE / mph) * 60;
  return { meters, minutes };
}

function formatEta(min: number, t: (k: string, opts?: any) => string): string {
  if (min < 1) return t("crewMap.atSite");
  if (min < 60) return t("crewMap.etaMin", { min: Math.round(min) });
  const hr = Math.floor(min / 60);
  const rem = Math.round(min - hr * 60);
  return t("crewMap.etaHr", { hr, min: rem });
}

// Top-down car silhouette used as the live crew pin. The SVG is drawn nose-up
// (north) at viewBox center so we can rotate the whole element by `heading`
// degrees (CW from N) and the front of the car will point in the direction
// of travel. When heading is null we lock it to nose-up and dim the body
// slightly so it reads as "parked / stationary".
function carSvg(color: string, headingKnown: boolean): string {
  const opacity = headingKnown ? 1 : 0.78;
  return `
    <svg viewBox="-20 -28 40 56" width="40" height="56" xmlns="http://www.w3.org/2000/svg" style="opacity:${opacity};filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));">
      <!-- Body -->
      <rect x="-10" y="-22" width="20" height="44" rx="6" ry="8" fill="${color}" stroke="white" stroke-width="1.5"/>
      <!-- Windshield (front) -->
      <path d="M-8 -12 L8 -12 L6 -19 L-6 -19 Z" fill="rgba(255,255,255,.85)"/>
      <!-- Rear window -->
      <path d="M-7 14 L7 14 L6 19 L-6 19 Z" fill="rgba(255,255,255,.55)"/>
      <!-- Side mirrors -->
      <rect x="-12" y="-10" width="2.5" height="3" fill="${color}" stroke="white" stroke-width="0.6"/>
      <rect x="9.5" y="-10" width="2.5" height="3" fill="${color}" stroke="white" stroke-width="0.6"/>
      <!-- Headlight cue at the nose -->
      <circle cx="0" cy="-23" r="1.6" fill="#fef3c7"/>
    </svg>`;
}

function carIcon(
  lowBattery: boolean,
  heading: number | null,
  lifecycleState: string | null,
  titles: { lowBattery: string; stationary: string; heading: (deg: number) => string },
  flashing: boolean = false,
) {
  // Color the car by lifecycle state so the demo audience can read at a glance:
  // amber = en route, green = on site, sky = anything else (fallback).
  const color =
    lifecycleState === "en_route"
      ? "#f59e0b"
      : lifecycleState === "on_location"
        ? "#6366f1"
        : lifecycleState === "on_site"
      ? "#10b981"
      : "#0ea5e9";
  const rotation = heading != null ? heading : 0;
  const headingTitle =
    heading != null ? titles.heading(Math.round(heading)) : titles.stationary;
  const badge = lowBattery
    ? `<div title="${titles.lowBattery}" style="position:absolute;right:-2px;top:-2px;width:14px;height:14px;border-radius:50%;background:#dc2626;border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700;font-family:sans-serif;line-height:1;z-index:2;">!</div>`
    : "";
  // When `flashing` is true we render an extra absolutely-positioned ring
  // overlay that pulses outward for ~2s. We deliberately do NOT animate the
  // outer container itself: the outer div carries an inline `transform:
  // translate(-20px,-28px)` that anchors the pin on the geo-coordinate, and
  // any keyframe `transform` on that element would replace the translate and
  // make the pin jump. The ring is its own sibling element so the car body
  // (and the existing rotation transform on the SVG wrapper) stay untouched.
  const ring = flashing
    ? `<div data-testid="crew-car-pin-flash-ring" class="lifecycle-flash-pin-ring" aria-hidden="true"></div>`
    : "";
  const html = `
    <div title="${headingTitle}" data-testid="crew-car-pin" data-heading="${heading != null ? Math.round(heading) : ""}" data-lifecycle="${lifecycleState ?? ""}" data-flashing="${flashing ? "1" : "0"}" style="position:relative;width:40px;height:56px;transform:translate(-20px,-28px);overflow:visible;">
      ${ring}
      <div style="position:absolute;inset:0;transform:rotate(${rotation}deg);transform-origin:50% 50%;z-index:2;">
        ${carSvg(color, heading != null)}
      </div>
      ${badge}
    </div>`;
  return L.divIcon({
    html,
    className: "vndrly-crew-car-pin",
    iconSize: [40, 56],
    iconAnchor: [20, 28],
    popupAnchor: [0, -28],
  });
}

function compassPoint(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

function visitorIcon() {
  const html = `<div style="position:relative;width:32px;height:40px;transform:translate(-16px,-36px);">
    <div style="position:absolute;left:0;top:0;width:32px;height:32px;border-radius:50%;background:#7c3aed;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;font-family:sans-serif;">V</div>
    <div style="position:absolute;left:13px;top:30px;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-top:8px solid #7c3aed;"></div>
  </div>`;
  return L.divIcon({ html, className: "vndrly-visitor-pin", iconSize: [32, 40], iconAnchor: [16, 36], popupAnchor: [0, -34] });
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return iso; }
}

function timeAgo(iso: string, t?: (k: string, opts?: any) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!t) {
    if (ms < 60_000) return "just now";
    const m0 = Math.floor(ms / 60_000);
    if (m0 < 60) return `${m0}m ago`;
    const h0 = Math.floor(m0 / 60);
    return `${h0}h ago`;
  }
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return t("notifications.timeAgo.seconds", { count: sec });
  const m = Math.floor(sec / 60);
  if (m < 60) return t("notifications.timeAgo.minutes", { count: m });
  const h = Math.floor(m / 60);
  return t("notifications.timeAgo.hours", { count: h });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function lifecycleLabel(
  state: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!state) return "";
  const key = `crewMap.lifecycleState.${state}`;
  const translated = t(key);
  if (translated === key) {
    return state.replace(/_/g, " ");
  }
  return translated;
}

export type CrewMapPageProps = { portalMode?: "default" | "foreman" };

export default function CrewMapPage({ portalMode = "default" }: CrewMapPageProps) {
  const isForemanPortal = portalMode === "foreman";
  const { t } = useTranslation();
  const { user } = useAuth();
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [visitors, setVisitors] = useState<VisitorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const [visitorsError, setVisitorsError] = useState<string | null>(null);
  // Set when the SSE channel reconnects after potentially missing visit
  // events (e.g. brief network blip). The banner stays until the auto
  // re-fetch we kick off here completes, so the user always sees fresh data.
  const [visitorGap, setVisitorGap] = useState(false);
  // Set when the crew location SSE channel reconnects after potentially
  // missing pings (gap flag from the `location.hello` event). Cleared after
  // we re-fetch the live locations snapshot so the user sees fresh pins.
  const [locationsGap, setLocationsGap] = useState(false);
  // Task #116 — set after the live-locations SSE channel has been in
  // an errored state for more than `LIVE_STUCK_RECONNECT_MS`. The
  // pill already turns "reconnecting" the moment onerror fires, but
  // for a wedged proxy 502 / laptop-sleep scenario we want a louder,
  // sentence-length banner so dispatchers can tell at a glance the
  // pins are minutes stale, not seconds. Cleared as soon as the
  // EventSource reopens.
  const [liveStuck, setLiveStuck] = useState(false);
  // Task #710 — capture per-resource 429 errors so the rate-limit gate
  // can park the corresponding poll/SSE-driven re-fetch path. The
  // imperative fetchers below set these to the raw structured error
  // (which carries `status`, `data.code`, `data.retryAfterSeconds`,
  // and `headers`) instead of just an error message string. Two
  // independent gates: one for `/api/live-locations*`, one for
  // `/api/visits*`. Each gate parks its own poll without affecting the
  // other resource.
  const [locationsLimitError, setLocationsLimitError] = useState<unknown>(null);
  const [visitorsLimitError, setVisitorsLimitError] = useState<unknown>(null);
  // Task #666 — drives the shared LiveConnectionPill rendered in the
  // header. Mirrors the open/error/hello-with-gap state machine the
  // ticket list and detail pages use; here we attach it to the live
  // crew-locations stream (the central feed for this page) so a
  // dispatcher can tell at a glance whether the pins they're staring
  // at are actually being pushed live.
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>("connecting");
  const liveRefreshedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashLiveRefreshed = () => {
    setLiveStatus("refreshed");
    if (liveRefreshedTimerRef.current) clearTimeout(liveRefreshedTimerRef.current);
    liveRefreshedTimerRef.current = setTimeout(() => {
      liveRefreshedTimerRef.current = null;
      // Only fall back to "live" if we're still in the refreshed hold —
      // a later disconnect may have already moved us to "reconnecting"
      // and we mustn't clobber that.
      setLiveStatus((prev) => (prev === "refreshed" ? "live" : prev));
    }, 3000);
  };
  useEffect(() => {
    return () => {
      if (liveRefreshedTimerRef.current) {
        clearTimeout(liveRefreshedTimerRef.current);
        liveRefreshedTimerRef.current = null;
      }
    };
  }, []);
  // Briefly highlight a crew row when its ticket transitions between
  // lifecycle stages (en_route → on_site → pending_review etc.) so an
  // audience watching the demo sees the live transition.
  const lifecycleByTicketRef = useRef<Map<number, string | null>>(new Map());
  const flashTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const initialSeedDoneRef = useRef(false);
  const [flashingEmployeeIds, setFlashingEmployeeIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    return () => {
      flashTimersRef.current.forEach((t) => clearTimeout(t));
      flashTimersRef.current.clear();
    };
  }, []);
  // Seed (and keep up to date) the per-ticket lifecycle map from the
  // current `locations` snapshot. The initial REST fetch and any fallback
  // poll go through here, so the SSE ping handler always has a baseline
  // to compare against. We only mark seeding "done" once a non-empty
  // snapshot has been observed; until then SSE pings for never-before-
  // seen tickets are recorded silently (no flash storm on first paint).
  useEffect(() => {
    if (loadedAt && !initialSeedDoneRef.current) {
      for (const loc of locations) {
        if (!lifecycleByTicketRef.current.has(loc.ticketId)) {
          lifecycleByTicketRef.current.set(loc.ticketId, loc.lifecycleState ?? null);
        }
      }
      initialSeedDoneRef.current = true;
    }
  }, [loadedAt, locations]);
  const flashEmployee = (employeeId: number) => {
    setFlashingEmployeeIds((prev) => {
      if (prev.has(employeeId)) return prev;
      const next = new Set(prev);
      next.add(employeeId);
      return next;
    });
    const existing = flashTimersRef.current.get(employeeId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      flashTimersRef.current.delete(employeeId);
      setFlashingEmployeeIds((prev) => {
        if (!prev.has(employeeId)) return prev;
        const next = new Set(prev);
        next.delete(employeeId);
        return next;
      });
    }, 2000);
    flashTimersRef.current.set(employeeId, timer);
  };
  const [siteFilter, setSiteFilter] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    try {
      return window.localStorage.getItem("vndrly:crew-map:site-filter") ?? "all";
    } catch {
      return "all";
    }
  });
  const [problemFilterOnly, setProblemFilterOnly] = useState(false);
  const [showGeofences, setShowGeofences] = useState(true);
  useEffect(() => {
    try {
      window.localStorage.setItem("vndrly:crew-map:site-filter", siteFilter);
    } catch {
      // ignore storage errors (e.g. private mode)
    }
  }, [siteFilter]);
  const siteParams = !isForemanPortal && user?.role === "partner" && user.partnerId ? { partnerId: user.partnerId } : undefined;
  const { data: vendorSites } = useListSiteLocations(siteParams, {
    query: { enabled: !isForemanPortal && siteParams != null, queryKey: getListSiteLocationsQueryKey(siteParams) },
  });
  const [fieldSites, setFieldSites] = useState<Array<{ id: number; name: string }>>([]);
  useEffect(() => {
    if (!isForemanPortal) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/field/sites`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled) {
          setFieldSites(
            Array.isArray(rows)
              ? rows.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name }))
              : [],
          );
        }
      })
      .catch(() => {
        if (!cancelled) setFieldSites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isForemanPortal]);
  const sites = isForemanPortal ? fieldSites : vendorSites;
  const selectedSiteId = siteFilter === "all" ? null : Number(siteFilter);

  const geofenceSites = useMemo((): GeofenceSite[] => {
    const raw = (sites as any)?.items ?? sites;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (s: any) =>
          s.latitude != null &&
          s.longitude != null &&
          Number.isFinite(Number(s.latitude)) &&
          Number.isFinite(Number(s.longitude)),
      )
      .map((s: any) => ({
        id: Number(s.id),
        name: s.name,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
        siteRadiusMeters: s.siteRadiusMeters ?? null,
      }));
  }, [sites]);

  const displayedLocations = useMemo(() => {
    if (!problemFilterOnly) return locations;
    return locations.filter((loc) =>
      isProblemCrewMember({
        batteryLevel: loc.batteryLevel,
        recordedAt: loc.recordedAt,
        lifecycleState: loc.lifecycleState,
        siteLatitude: loc.siteLatitude,
        siteLongitude: loc.siteLongitude,
        latitude: loc.latitude,
        longitude: loc.longitude,
        speedMps: loc.speedMps,
      }),
    );
  }, [locations, problemFilterOnly]);

  // Task #710 — per-resource gates. The fetchers below early-return
  // while parked, but we also stash the latest `rateLimited` flag in a
  // ref so the closure-captured setInterval/SSE handlers (which never
  // re-bind across renders) read the current value without rebuilding.
  const locationsGate = useRateLimitGate(
    locationsLimitError,
    "live_locations.rate_limited",
  );
  const visitorsGate = useRateLimitGate(
    visitorsLimitError,
    "visits.rate_limited",
  );
  const locationsRateLimitedRef = useRef(false);
  locationsRateLimitedRef.current = locationsGate.rateLimited;
  const visitorsRateLimitedRef = useRef(false);
  visitorsRateLimitedRef.current = visitorsGate.rateLimited;
  const rateLimited = locationsGate.rateLimited || visitorsGate.rateLimited;
  const retryAfterSeconds =
    Math.max(
      locationsGate.retryAfterSeconds ?? 0,
      visitorsGate.retryAfterSeconds ?? 0,
    ) || null;

  const fetchLocationsOnly = async () => {
    // Skip while the live-locations limiter has us parked. The gate
    // auto-clears after Retry-After elapses; once cleared the next
    // poll tick will pick up fresh state.
    if (locationsRateLimitedRef.current) return;
    try {
      const params = new URLSearchParams();
      if (user?.role === "vendor" && user.vendorId) params.set("vendorId", String(user.vendorId));
      if (selectedSiteId) params.set("siteLocationId", String(selectedSiteId));
      const r = await fetch(`${API_BASE}/api/live-locations?${params}`, { credentials: "include" });
      if (!r.ok) {
        // Surface 429s with their structured body to the rate-limit
        // gate so it can park the next poll for the indicated
        // Retry-After window. Other non-OK responses keep the prior
        // simple-message error path so the existing crew-error banner
        // renders as before.
        if (r.status === 429) {
          let data: unknown = null;
          try {
            data = await r.json();
          } catch {
            // Non-JSON 429 — gate falls back to its default cooldown.
          }
          const err = new Error("rate-limited") as Error & {
            status: number;
            data: unknown;
            headers: Headers;
          };
          err.status = r.status;
          err.data = data;
          err.headers = r.headers;
          setLocationsLimitError(err);
          return;
        }
        throw new Error(`HTTP ${r.status}`);
      }
      const json = await r.json();
      setLocations(json.locations ?? []);
      setLoadedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("crewMap.failedToLoad"));
    }
  };

  const fetchVisitorsOnly = async () => {
    if (visitorsRateLimitedRef.current) return;
    try {
      const rows = await visitsApi.list(selectedSiteId ? { siteLocationId: selectedSiteId } : undefined);
      setVisitors(
        rows.filter(
          (v) =>
            v.checkOutTime == null &&
            v.checkInLatitude != null &&
            v.checkInLongitude != null,
        ),
      );
      setVisitorsError(null);
    } catch (err) {
      // Same shape as live-locations: hand a 429 to the gate so we
      // pause the next 60s poll, but keep the inline visitor-error
      // banner for everything else.
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) {
        setVisitorsLimitError(err);
        return;
      }
      const msg = err instanceof Error ? err.message : t("crewMap.failedToLoadVisitors");
      setVisitorsError(msg);
    }
  };

  const fetchLocations = async () => {
    if (isForemanPortal) {
      await fetchLocationsOnly();
      return;
    }
    await Promise.all([fetchLocationsOnly(), fetchVisitorsOnly()]);
  };

  useEffect(() => {
    fetchLocations();
    // Long fallback polls only — the live SSE channel below is the primary
    // path for both crew pings and visitor pins.
    let locId: ReturnType<typeof setInterval> | null = setInterval(
      fetchLocationsOnly,
      LOCATIONS_FALLBACK_POLL_MS,
    );
    let visId: ReturnType<typeof setInterval> | null = setInterval(
      fetchVisitorsOnly,
      VISITORS_FALLBACK_POLL_MS,
    );

    // Periodically prune stale crew pins that fell out of the freshness window
    // (e.g. employee went off-shift) so we don't keep ghost markers indefinitely.
    let pruneId: ReturnType<typeof setInterval> | null = setInterval(() => {
      const cutoff = Date.now() - LIVE_PING_FRESH_MS;
      setLocations((prev) => {
        const next = prev.filter((l) => new Date(l.recordedAt).getTime() >= cutoff);
        return next.length === prev.length ? prev : next;
      });
    }, 60_000);

    // Subscribe to the live channels: visitor events and crew location pings.
    // For visitor events we re-fetch the visitor list so that any active
    // filters (current or future) are honored authoritatively by the server.
    // For location pings we merge them into local state directly.
    let visitsEs: EventSource | null = null;
    let locsEs: EventSource | null = null;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    // Task #116 — gates around the locations SSE channel:
    //   • `locsStuckTimer` — pending 10s timer that fires the
    //     "wedged-channel" recovery path (force close + reopen + show
    //     the louder indicator). Cleared the moment we see a healthy
    //     `onopen`.
    //   • `locsErroredSinceOpen` — true while the most recent
    //     transition on the channel was `onerror` (so the next
    //     `onopen` is genuinely a *recovery*, not the initial
    //     connect). Drives the "refetch on reconnect" backfill.
    let locsStuckTimer: ReturnType<typeof setTimeout> | null = null;
    let locsErroredSinceOpen = false;
    const clearLocsStuckTimer = () => {
      if (locsStuckTimer) {
        clearTimeout(locsStuckTimer);
        locsStuckTimer = null;
      }
    };
    const scheduleVisitorResync = () => {
      if (resyncTimer) return;
      resyncTimer = setTimeout(() => {
        resyncTimer = null;
        fetchVisitorsOnly();
      }, 100);
    };
    const onLocationPing = (msg: MessageEvent) => {
      try {
        const parsed = JSON.parse(msg.data) as { type: string; location: LiveLocation };
        const incoming = parsed.location;
        if (!incoming || typeof incoming.employeeId !== "number") return;
        const prevLifecycle = lifecycleByTicketRef.current.get(incoming.ticketId);
        const incomingLifecycle = incoming.lifecycleState ?? null;
        lifecycleByTicketRef.current.set(incoming.ticketId, incomingLifecycle);
        if (
          (prevLifecycle !== undefined && prevLifecycle !== incomingLifecycle) ||
          // First time we see this ticket on the wire after the initial
          // snapshot — e.g. demo cycle reset created a fresh en_route
          // ticket. Flash the pin so the new live entry is obvious.
          (prevLifecycle === undefined && initialSeedDoneRef.current)
        ) {
          flashEmployee(incoming.employeeId);
        }
        setLocations((prev) => {
          const idx = prev.findIndex((l) => l.employeeId === incoming.employeeId);
          if (idx === -1) return [...prev, incoming];
          const cur = prev[idx];
          // Keep the newer ping; events normally arrive in order but be defensive.
          if (new Date(cur.recordedAt).getTime() > new Date(incoming.recordedAt).getTime()) {
            return prev;
          }
          const next = prev.slice();
          next[idx] = { ...cur, ...incoming };
          return next;
        });
        setLoadedAt(new Date());
        setError(null);
      } catch {
        // Ignore malformed payloads.
      }
    };
    const openStreams = () => {
      if (!isForemanPortal && !visitsEs) {
        try {
          visitsEs = new EventSource(`${API_BASE}/api/visits/events`, { withCredentials: true });
          visitsEs.addEventListener("visit.checked_in", scheduleVisitorResync);
          visitsEs.addEventListener("visit.checked_out", scheduleVisitorResync);
          // The server sends a `visit.hello` event on every (re)connection
          // with `gap: true` when our last seen event id is behind its
          // current sequence — meaning a notification may have been dropped
          // (DB blip, brief offline, SSE reconnect, etc.). Show a subtle
          // banner and re-sync the visitor list immediately.
          visitsEs.addEventListener("visit.hello", (e: MessageEvent) => {
            try {
              const data = JSON.parse(e.data) as { gap?: boolean };
              if (data.gap) {
                setVisitorGap(true);
                fetchVisitorsOnly()
                  .then(() => setVisitorGap(false))
                  .catch(() => {
                    /* leave the banner up so the user knows to refresh */
                  });
              }
            } catch {
              /* ignore malformed hello */
            }
          });
          visitsEs.onerror = () => {
            // Browser auto-reconnects; fallback poll keeps state fresh.
          };
        } catch {
          visitsEs = null;
        }
      }
      if (!locsEs) {
        try {
          const params = new URLSearchParams();
          if (user?.role === "vendor" && user.vendorId) params.set("vendorId", String(user.vendorId));
          if (selectedSiteId) params.set("siteLocationId", String(selectedSiteId));
          const qs = params.toString();
          locsEs = new EventSource(
            `${API_BASE}/api/live-locations/events${qs ? `?${qs}` : ""}`,
            { withCredentials: true },
          );
          locsEs.addEventListener("location.ping", onLocationPing as EventListener);
          // Task #666 — drive the LiveConnectionPill from the same
          // EventSource lifecycle the existing gap-banner uses. onopen
          // fires both on initial connect and after every successful
          // auto-reconnect; we don't clobber a "refreshed" hold a hello
          // arriving milliseconds later may have queued.
          locsEs.onopen = () => {
            // Task #116 — a healthy open kills any pending stuck
            // recovery and clears the louder banner. We always do
            // this *before* deciding whether to backfill so even a
            // late-arriving open beats the timer race.
            clearLocsStuckTimer();
            setLiveStuck(false);
            setLiveStatus((prev) => (prev === "refreshed" ? prev : "live"));
            // Task #116 — when this open is *recovering* from a prior
            // error (rather than the initial mount connect), backfill
            // the locations snapshot once. The hello.gap path below
            // also triggers a refetch but only fires when the server
            // has detected a missed sequence id; for fast reconnects
            // the gap flag may stay false even though pings landed
            // during the dead window, so we belt-and-suspenders on
            // the client side too. flashLiveRefreshed gives the
            // dispatcher the same "Reconnected — refreshed"
            // confirmation they get on the gap path.
            if (locsErroredSinceOpen) {
              locsErroredSinceOpen = false;
              flashLiveRefreshed();
              fetchLocationsOnly();
            }
          };
          // Mirror of the visitor gap pattern: the server sends a
          // `location.hello` event on every (re)connection with `gap: true`
          // when our last seen seq is behind its current sequence. Show a
          // subtle banner and re-sync the live locations immediately.
          locsEs.addEventListener("location.hello", (e: MessageEvent) => {
            try {
              const data = JSON.parse(e.data) as { gap?: boolean };
              if (data.gap) {
                setLocationsGap(true);
                // Task #666 — also flash the pill so users who don't
                // notice the inline banner see the live indicator
                // briefly confirm the reconnect re-fetched.
                flashLiveRefreshed();
                fetchLocationsOnly()
                  .then(() => setLocationsGap(false))
                  .catch(() => {
                    /* leave the banner up so the user knows to refresh */
                  });
              }
            } catch {
              /* ignore malformed hello */
            }
          });
          locsEs.onerror = () => {
            // Browser auto-reconnects; fallback poll keeps state fresh.
            // Surface the state so the dispatcher knows pins may be stale.
            setLiveStatus("reconnecting");
            // Task #116 — remember that we've been errored so the
            // next healthy open backfills the snapshot, and arm the
            // 10s "wedged channel" recovery timer if it isn't
            // already armed. The browser may still be auto-trying
            // every few seconds; if any of those succeed, the open
            // handler clears the timer before it fires.
            locsErroredSinceOpen = true;
            if (!locsStuckTimer) {
              locsStuckTimer = setTimeout(() => {
                locsStuckTimer = null;
                // Show the louder "Live updates paused" banner so a
                // dispatcher staring at stale pins isn't fooled by
                // the steady-looking map.
                setLiveStuck(true);
                // Force a manual close + reopen. Browser
                // auto-reconnect handles transient drops well, but
                // proxy 502s and laptop-sleep cycles can leave the
                // socket in `CLOSED` without ever firing onopen
                // again — so we tear it down explicitly and let
                // openStreams() build a fresh EventSource. If this
                // reopen also errors, onerror re-arms the timer for
                // another attempt.
                if (locsEs) {
                  try { locsEs.close(); } catch { /* ignore */ }
                  locsEs = null;
                }
                openStreams();
              }, LIVE_STUCK_RECONNECT_MS);
            }
          };
        } catch {
          locsEs = null;
          // EventSource isn't available — don't sit on "Connecting…"
          // forever; surface the offline state.
          setLiveStatus("reconnecting");
        }
      }
    };
    const closeStreams = () => {
      if (visitsEs) { visitsEs.close(); visitsEs = null; }
      if (locsEs) { locsEs.close(); locsEs = null; }
      // Task #116 — drop any pending stuck-recovery timer so a
      // deliberate teardown (page hide, unmount, filter change)
      // doesn't fire a force-reopen against a torn-down closure.
      // We also clear the louder banner — the next openStreams()
      // call will re-arm everything from a clean baseline.
      clearLocsStuckTimer();
      locsErroredSinceOpen = false;
      setLiveStuck(false);
    };
    openStreams();

    const onVisibility = () => {
      if (document.hidden) {
        if (locId) { clearInterval(locId); locId = null; }
        if (visId) { clearInterval(visId); visId = null; }
        if (pruneId) { clearInterval(pruneId); pruneId = null; }
        closeStreams();
        // Task #666 — once we deliberately drop the SSE on hide, the
        // pill should reflect that we're no longer live until the
        // visibility-change reopens it.
        setLiveStatus("reconnecting");
      } else {
        // Refresh immediately on return, then resume intervals + stream.
        fetchLocations();
        if (!locId) locId = setInterval(fetchLocationsOnly, LOCATIONS_FALLBACK_POLL_MS);
        if (!visId) visId = setInterval(fetchVisitorsOnly, VISITORS_FALLBACK_POLL_MS);
        if (!pruneId) {
          pruneId = setInterval(() => {
            const cutoff = Date.now() - LIVE_PING_FRESH_MS;
            setLocations((prev) => {
              const next = prev.filter((l) => new Date(l.recordedAt).getTime() >= cutoff);
              return next.length === prev.length ? prev : next;
            });
          }, 60_000);
        }
        openStreams();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (locId) clearInterval(locId);
      if (visId) clearInterval(visId);
      if (pruneId) clearInterval(pruneId);
      if (resyncTimer) { clearTimeout(resyncTimer); resyncTimer = null; }
      closeStreams();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.vendorId, selectedSiteId]);

  const center = useMemo<[number, number]>(() => {
    const points: { lat: number; lng: number }[] = [
      ...locations.map((l) => ({ lat: l.latitude, lng: l.longitude })),
      ...visitors.map((v) => ({ lat: v.checkInLatitude as number, lng: v.checkInLongitude as number })),
    ];
    if (points.length === 0) return [39.5, -98.35]; // continental US
    const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
    return [lat, lng];
  }, [locations, visitors]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={isForemanPortal ? "/foreman" : "/"} className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{isForemanPortal ? t("foremanMap.title") : t("crewMap.title")}</h1>
              <LiveConnectionPill status={liveStatus} testId="crew-map-live-connection-pill" />
            </div>
            <p className="text-sm text-muted-foreground">{isForemanPortal ? t("foremanMap.subtitle") : t("crewMap.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-site-filter">
              <SelectValue placeholder={t("crewMap.allSites")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="option-site-all">{t("crewMap.allSites")}</SelectItem>
              {(sites ?? []).map((s) => (
                <SelectItem key={s.id} value={String(s.id)} data-testid={`option-site-${s.id}`}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PngPillButton
            color="blue"
            onClick={fetchLocations}
            className="px-3 gap-2"
            data-testid="button-refresh-crew"
          >
            <RefreshCw className="h-4 w-4" />
            {t("crewMap.refresh")}
          </PngPillButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={problemFilterOnly}
            onCheckedChange={(v) => setProblemFilterOnly(v === true)}
            data-testid="checkbox-problem-filter"
          />
          {t("crewMap.problemFilter", "Needs attention only")}
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={showGeofences}
            onCheckedChange={(v) => setShowGeofences(v === true)}
            data-testid="checkbox-show-geofences"
          />
          {t("crewMap.showGeofences", "Show site geofences")}
        </label>
      </div>

      <Card className="border-dashed">
        <CardContent className="py-3 text-xs text-muted-foreground flex items-start gap-2">
          <Shield className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <strong className="text-foreground">{t("crewMap.privacyHeader")}</strong> {t("crewMap.privacyText")}
          </div>
        </CardContent>
      </Card>

      {rateLimited && (
        <div
          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-2"
          data-testid="crew-map-slow-down"
          role="status"
          aria-live="polite"
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>
            {retryAfterSeconds != null
              ? t("common.slowDown.retryIn", { seconds: retryAfterSeconds })
              : t("common.slowDown.brief")}
          </span>
        </div>
      )}
      {error && !rateLimited && (
        <div className="text-sm text-destructive" data-testid="text-crew-error">{error}</div>
      )}
      {visitorsError && (
        <div
          className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1"
          data-testid="text-visitors-error"
        >
          {t("crewMap.visitorsUnavailable", { error: visitorsError })}
        </div>
      )}
      {liveStuck && (
        <div
          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-2"
          data-testid="text-live-updates-paused"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{t("crewMap.liveUpdatesPaused")}</span>
          <button
            type="button"
            className="underline ml-auto"
            onClick={() => {
              fetchLocationsOnly();
            }}
            data-testid="button-live-updates-paused-refresh"
          >
            {t("crewMap.refreshNow")}
          </button>
        </div>
      )}
      {locationsGap && (
        <div
          className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-2"
          data-testid="text-locations-gap-warning"
          role="status"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{t("crewMap.locationsGapWarning")}</span>
          <button
            type="button"
            className="underline ml-auto"
            onClick={() => {
              fetchLocationsOnly().finally(() => setLocationsGap(false));
            }}
            data-testid="button-locations-gap-refresh"
          >
            {t("crewMap.refreshNow")}
          </button>
        </div>
      )}
      {visitorGap && (
        <div
          className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-2"
          data-testid="text-visitor-gap-warning"
          role="status"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{t("crewMap.visitorGapWarning")}</span>
          <button
            type="button"
            className="underline ml-auto"
            onClick={() => {
              fetchVisitorsOnly().finally(() => setVisitorGap(false));
            }}
            data-testid="button-visitor-gap-refresh"
          >
            {t("crewMap.refreshNow")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="border-2" style={{ borderColor: "var(--brand-primary)" }}>
            <CardContent className="p-0">
              <div style={{ height: 520, isolation: "isolate" }}>
                <MapContainer center={center} zoom={locations.length + visitors.length > 0 ? 8 : 4} zoomControl={false} style={{ height: "100%", width: "100%" }}>
                  <BrandZoomControlInMap />
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {showGeofences && geofenceSites.length > 0 && (
                    <GeofenceCirclesLayer
                      sites={geofenceSites}
                      highlightSiteId={selectedSiteId}
                    />
                  )}
                  {displayedLocations.map((loc) => {
                    const lowBattery = loc.batteryLevel != null && loc.batteryLevel <= LOW_BATTERY_THRESHOLD;
                    const eta = etaMinutes(
                      loc.latitude,
                      loc.longitude,
                      loc.siteLatitude,
                      loc.siteLongitude,
                      loc.speedMps,
                    );
                    return (
                      <Marker
                        key={loc.employeeId}
                        position={[loc.latitude, loc.longitude]}
                        icon={carIcon(
                          lowBattery,
                          loc.heading,
                          loc.lifecycleState,
                          {
                            lowBattery: t("crewMap.lowBatteryTitle"),
                            stationary: t("crewMap.stationary"),
                            heading: (deg) => t("crewMap.headingTitle", { deg }),
                          },
                          flashingEmployeeIds.has(loc.employeeId),
                        )}
                      >
                        <Popup>
                          <div className="text-sm space-y-1 min-w-[200px]">
                            <div className="font-semibold">{loc.employeeName}</div>
                            <div className="text-xs">
                              <Link href={`/tickets/${loc.ticketId}`} className="underline">
                                {t("crewMap.ticketLabel", { id: loc.ticketId })}
                              </Link>
                              {" — "}{lifecycleLabel(loc.lifecycleState, t)}
                            </div>
                            {loc.siteName && <div className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" />{loc.siteName}</div>}
                            <div
                              className="text-xs flex items-center gap-1 text-foreground font-medium"
                              data-testid={`text-speed-${loc.employeeId}`}
                            >
                              <Gauge className="h-3 w-3 text-sky-600" />
                              {formatSpeed(loc.speedMps, t)}
                            </div>
                            {eta && (
                              <div
                                className="text-xs flex items-center gap-1 text-muted-foreground"
                                data-testid={`text-eta-${loc.employeeId}`}
                              >
                                <Navigation className="h-3 w-3 text-emerald-600" />
                                {formatDistance(eta.meters, t)}
                                {" · "}
                                {formatEta(eta.minutes, t)}
                              </div>
                            )}
                            <div
                              className="text-xs text-muted-foreground flex items-center gap-1"
                              data-testid={`text-heading-${loc.employeeId}`}
                            >
                              {loc.heading != null ? (
                                <>
                                  <Navigation
                                    className="h-3 w-3 text-sky-600"
                                    style={{ transform: `rotate(${loc.heading}deg)` }}
                                  />
                                  {t("crewMap.heading")} {compassPoint(loc.heading)} ({Math.round(loc.heading)}&deg;)
                                </>
                              ) : (
                                <>
                                  <Navigation className="h-3 w-3 opacity-40" />
                                  {t("crewMap.stationary")}
                                </>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{t("crewMap.lastSeen", { when: timeAgo(loc.recordedAt, t) })}</div>
                            {loc.batteryLevel != null && (
                              <div
                                className={`text-xs flex items-center gap-1 ${lowBattery ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                                data-testid={`text-battery-${loc.employeeId}`}
                              >
                                {lowBattery && <BatteryLow className="h-3 w-3" />}
                                {t("crewMap.battery", { pct: Math.round(loc.batteryLevel * 100) })}
                                {lowBattery && ` ${t("crewMap.lowSuffix")}`}
                              </div>
                            )}
                            <div className="flex gap-1 pt-1">
                              <a
                                className="inline-flex items-center text-xs underline"
                                href={
                                  loc.siteLatitude != null && loc.siteLongitude != null
                                    ? `https://www.google.com/maps/dir/?api=1&origin=${loc.latitude},${loc.longitude}&destination=${loc.siteLatitude},${loc.siteLongitude}`
                                    : `https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}`
                                }
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Navigation className="h-3 w-3 mr-0.5" />
                                {t("crewMap.directions")}
                              </a>
                              <span>·</span>
                              <Link href={`/crew-map/${loc.employeeId}?date=${todayISO()}`} className="text-xs underline">
                                {t("crewMap.replayToday")}
                              </Link>
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                  {/* Destination route lines: dashed polyline from each en-route
                      car to its assigned site. Only drawn for en_route tickets
                      so on-site cars don't get a tiny vestigial line through
                      themselves. */}
                  {locations.map((loc) => {
                    if (loc.lifecycleState !== "en_route") return null;
                    if (loc.siteLatitude == null || loc.siteLongitude == null) return null;
                    return (
                      <Polyline
                        key={`route-${loc.employeeId}`}
                        positions={[
                          [loc.latitude, loc.longitude],
                          [loc.siteLatitude, loc.siteLongitude],
                        ]}
                        pathOptions={{
                          color: "#f59e0b",
                          weight: 3,
                          opacity: 0.85,
                          dashArray: "8 6",
                        }}
                      />
                    );
                  })}
                  {/* Site marker for each unique destination so the audience can
                      see the car closing in on a real point on the map. */}
                  {Array.from(
                    new Map(
                      locations
                        .filter(
                          (l) =>
                            l.lifecycleState === "en_route" &&
                            l.siteLatitude != null &&
                            l.siteLongitude != null,
                        )
                        .map((l) => [
                          `${l.siteLatitude},${l.siteLongitude}`,
                          {
                            key: `site-${l.siteLatitude},${l.siteLongitude}`,
                            lat: l.siteLatitude as number,
                            lng: l.siteLongitude as number,
                            name: l.siteName,
                          },
                        ]),
                    ).values(),
                  ).map((s) => (
                    <Marker
                      key={s.key}
                      position={[s.lat, s.lng]}
                      icon={L.divIcon({
                        html: `<div style="position:relative;width:24px;height:32px;transform:translate(-12px,-28px);">
                          <div style="position:absolute;left:0;top:0;width:24px;height:24px;border-radius:50%;background:#dc2626;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;font-family:sans-serif;">📍</div>
                        </div>`,
                        className: "vndrly-site-pin",
                        iconSize: [24, 32],
                        iconAnchor: [12, 28],
                        popupAnchor: [0, -26],
                      })}
                    >
                      <Popup>
                        <div className="text-xs font-medium">{s.name ?? t("crewMap.atSite")}</div>
                      </Popup>
                    </Marker>
                  ))}
                  {!isForemanPortal
                    ? visitors.map((v) => {
                    const host = v.hostType === "partner" ? v.hostPartnerName : v.hostVendorName;
                    return (
                      <Marker
                        key={`visitor-${v.id}`}
                        position={[v.checkInLatitude as number, v.checkInLongitude as number]}
                        icon={visitorIcon()}
                      >
                        <Popup>
                          <div className="text-sm space-y-1 min-w-[180px]" data-testid={`popup-visitor-${v.id}`}>
                            <div className="font-semibold flex items-center gap-1">
                              <UserCheck className="h-3.5 w-3.5 text-violet-600" />
                              {v.firstName} {v.lastName}
                              {v.company ? <span className="text-xs text-muted-foreground">({v.company})</span> : null}
                            </div>
                            {host && (
                              <div className="text-xs">
                                <span className="text-muted-foreground">{t("crewMap.visiting")}</span> {host}
                              </div>
                            )}
                            {v.purpose && (
                              <div className="text-xs">
                                <span className="text-muted-foreground">{t("crewMap.purpose")}</span> {v.purpose}
                              </div>
                            )}
                            {v.siteName && <div className="text-xs">{v.siteName}</div>}
                            <div className="text-xs text-muted-foreground">
                              {t("crewMap.visitorCheckedIn", { time: formatTime(v.checkInTime), ago: timeAgo(v.checkInTime, t) })}
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })
                    : null}
                </MapContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("crewMap.onShiftNow", { count: displayedLocations.length })}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[520px] overflow-y-auto">
              {displayedLocations.length === 0 ? (
                <div className="text-sm text-muted-foreground">{t("crewMap.nobodyOnClock")}</div>
              ) : (
                displayedLocations.map((loc) => {
                  const lowBattery = loc.batteryLevel != null && loc.batteryLevel <= LOW_BATTERY_THRESHOLD;
                  return (
                  <div
                    key={loc.employeeId}
                    className={`border rounded p-2 text-sm${flashingEmployeeIds.has(loc.employeeId) ? " lifecycle-flash" : ""}`}
                    data-testid={`crew-row-${loc.employeeId}`}
                  >
                    <div className="font-medium flex items-center gap-1.5">
                      {loc.employeeName}
                      {lowBattery && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5"
                          title={t("crewMap.lowBattery", { pct: Math.round((loc.batteryLevel ?? 0) * 100) })}
                          data-testid={`badge-low-battery-${loc.employeeId}`}
                        >
                          <BatteryLow className="h-3 w-3" />
                          {Math.round((loc.batteryLevel ?? 0) * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("crewMap.ticketLabel", { id: loc.ticketId })} · {lifecycleLabel(loc.lifecycleState, t)} · {timeAgo(loc.recordedAt, t)}
                    </div>
                    <div className="flex gap-2 mt-1.5">
                      <a
                        className="text-xs underline inline-flex items-center"
                        href={`https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        data-testid={`button-directions-${loc.employeeId}`}
                      >
                        <Navigation className="h-3 w-3 mr-0.5" />
                        {t("crewMap.directions")}
                      </a>
                      <Link href={`/crew-map/${loc.employeeId}?date=${todayISO()}`} className="text-xs underline">
                        {t("crewMap.replayToday")}
                      </Link>
                    </div>
                  </div>
                  );
                })
              )}
              {loadedAt && (
                <div className="text-[10px] text-muted-foreground pt-1">
                  {t("crewMap.updated", { time: loadedAt.toLocaleTimeString() })}
                </div>
              )}
            </CardContent>
          </Card>

          <RecentTripsCard
            siteLocationId={selectedSiteId}
            vendorId={user?.role === "vendor" && user.vendorId ? user.vendorId : undefined}
          />

          {!isForemanPortal && visitors.length > 0 && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-violet-600" />
                  {t("crewMap.visitorsOnSite", { count: visitors.length })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
                {visitors.map((v) => {
                  const host = v.hostType === "partner" ? v.hostPartnerName : v.hostVendorName;
                  return (
                    <div
                      key={v.id}
                      className="border rounded p-2 text-sm"
                      data-testid={`visitor-row-${v.id}`}
                    >
                      <div className="font-medium">
                        {v.firstName} {v.lastName}
                        {v.company ? <span className="text-xs text-muted-foreground"> · {v.company}</span> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {host ? t("crewMap.visitingHost", { host }) : t("crewMap.visitor")}
                        {v.purpose ? ` · ${v.purpose}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {v.siteName ? `${v.siteName} · ` : ""}{t("crewMap.visitorCheckedInShort", { ago: timeAgo(v.checkInTime, t) })}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
