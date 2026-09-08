import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { Card, CardContent, CardHeader, CardTitle, CARD_INNER_TILE_HOVER_CLASS, CARD_TITLE_ICON_CLASS } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, BatteryLow, Clock, Gauge, MapPin, Navigation, RefreshCw, Shield, UserCheck } from "lucide-react";
import { visitsApi, type VisitorRow } from "@/lib/visits-api";
import { useListSiteLocations, getListSiteLocationsQueryKey } from "@workspace/api-client-react";
import LiveConnectionPill, { type LiveConnectionStatus } from "@/components/live-connection-pill";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import {
  isProblemCrewMember,
} from "@workspace/map-utils";
import { Checkbox } from "@/components/ui/checkbox";
import { RecentTripsCard } from "@/components/map/recent-trips-card";
import { CrewInspector } from "@/components/map/crew-inspector";
import { MapComplianceIssuesCard } from "@/components/map/map-compliance-issues-card";
import type { MapboxCircle, MapboxLine, MapboxPoint } from "@/components/mapbox-map";

const LazyMapboxMap = lazy(() =>
  import("@/components/mapbox-map").then((mod) => ({ default: mod.MapboxMap })),
);

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

type GeofenceSite = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  siteRadiusMeters?: number | null;
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

function compassPoint(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
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

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type CrewMapPageProps = { portalMode?: "default" | "foreman" };

export default function CrewMapPage({ portalMode = "default" }: CrewMapPageProps) {
  const isForemanPortal = portalMode === "foreman";
  const { t } = useTranslation();
  const { user } = useAuth();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
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
      flashTimersRef.current.forEach((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
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
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [showVisitors, setShowVisitors] = useState(true);
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
    query: { enabled: !isForemanPortal && !!user, queryKey: getListSiteLocationsQueryKey(siteParams) },
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
    return locations.filter((loc) =>
      (employeeFilter === "all" || String(loc.employeeId) === employeeFilter) &&
      (activityFilter === "all" || loc.lifecycleState === activityFilter) &&
      (!problemFilterOnly || isProblemCrewMember({
        batteryLevel: loc.batteryLevel,
        recordedAt: loc.recordedAt,
        lifecycleState: loc.lifecycleState,
        siteLatitude: loc.siteLatitude,
        siteLongitude: loc.siteLongitude,
        latitude: loc.latitude,
        longitude: loc.longitude,
        speedMps: loc.speedMps,
      })),
    );
  }, [locations, problemFilterOnly, employeeFilter, activityFilter]);

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

  const mapPoints = useMemo<MapboxPoint[]>(() => {
    const points: MapboxPoint[] = displayedLocations.map((loc) => {
      const lowBattery = loc.batteryLevel != null && loc.batteryLevel <= LOW_BATTERY_THRESHOLD;
      const color =
        lowBattery
          ? "#dc2626"
          : loc.lifecycleState === "en_route"
            ? "#f59e0b"
            : loc.lifecycleState === "on_location"
              ? "#6366f1"
              : loc.lifecycleState === "on_site"
                ? "#10b981"
                : "#0ea5e9";
      const heading = loc.heading != null ? `${compassPoint(loc.heading)} ${Math.round(loc.heading)}°` : t("crewMap.stationary", "Stationary");
      return {
        id: `crew-${loc.employeeId}`,
        latitude: loc.latitude,
        longitude: loc.longitude,
        color,
        label: lowBattery ? "!" : "C",
        title: loc.employeeName,
        flashing: flashingEmployeeIds.has(loc.employeeId),
        popupHtml: `
          <div class="text-sm space-y-1 min-w-[200px]">
            <div class="font-semibold">${escapeHtml(loc.employeeName)}</div>
            <div class="text-xs"><a href="/tickets/${loc.ticketId}" class="underline">${escapeHtml(t("crewMap.ticketLabel", { id: loc.ticketId }))}</a></div>
            ${loc.vendorId ? `<div class="text-xs text-muted-foreground">${escapeHtml(t("crewMap.vendorId", "Vendor ID"))}: ${loc.vendorId}</div>` : ""}
            ${loc.siteName ? `<div class="text-xs">${escapeHtml(loc.siteName)}</div>` : ""}
            ${loc.lifecycleState ? `<div class="text-xs">${escapeHtml(lifecycleLabel(loc.lifecycleState, t))}</div>` : ""}
            <div class="text-xs">${escapeHtml(heading)}</div>
            <div class="text-xs">${escapeHtml(formatSpeed(loc.speedMps, t))}</div>
            <div class="text-xs">${escapeHtml(t("crewMap.lastSeen", "Last seen"))}: ${escapeHtml(timeAgo(loc.recordedAt, t))}</div>
          </div>`,
      };
    });
    const sitePoints = Array.from(
      new Map(
        displayedLocations
          .filter((l) => l.siteLatitude != null && l.siteLongitude != null)
          .map((l) => [
            `${l.siteLatitude},${l.siteLongitude}`,
            {
              id: `site-${l.siteLatitude}-${l.siteLongitude}`,
              latitude: l.siteLatitude as number,
              longitude: l.siteLongitude as number,
              color: "#2563eb",
              label: "S",
              title: l.siteName ?? t("crewMap.atSite"),
              popupHtml: `<div class="text-xs font-medium">${escapeHtml(l.siteName ?? t("crewMap.atSite"))}</div>`,
            } satisfies MapboxPoint,
          ]),
      ).values(),
    );
    const visitorPoints: MapboxPoint[] = isForemanPortal || !showVisitors
      ? []
      : visitors.map((v) => ({
          id: `visitor-${v.id}`,
          latitude: Number(v.checkInLatitude),
          longitude: Number(v.checkInLongitude),
          color: "#7c3aed",
          label: "V",
          title: `${v.firstName} ${v.lastName}`,
          popupHtml: `
            <div class="text-sm space-y-1 min-w-[180px]" data-testid="popup-visitor-${v.id}">
              <div class="font-semibold">${escapeHtml(`${v.firstName} ${v.lastName}`)}${v.company ? ` <span class="text-xs text-muted-foreground">(${escapeHtml(v.company)})</span>` : ""}</div>
              <div class="text-xs">${escapeHtml(v.siteName ?? "")}</div>
              <div class="text-xs">${escapeHtml(t("crewMap.lastSeen", "Last seen"))}: ${escapeHtml(timeAgo(v.checkInTime, t))}</div>
            </div>`,
        }));
    return [...points, ...sitePoints, ...visitorPoints];
  }, [displayedLocations, flashingEmployeeIds, isForemanPortal, showVisitors, t, visitors]);

  const mapLines = useMemo<MapboxLine[]>(
    () =>
      displayedLocations
        .filter((loc) => loc.lifecycleState === "en_route" && loc.siteLatitude != null && loc.siteLongitude != null)
        .map((loc) => ({
          id: `route-${loc.employeeId}`,
          coordinates: [
            [loc.latitude, loc.longitude],
            [loc.siteLatitude as number, loc.siteLongitude as number],
          ],
          color: "#f59e0b",
          width: 2,
          opacity: 0.75,
        })),
    [displayedLocations],
  );

  const mapCircles = useMemo<MapboxCircle[]>(
    () =>
      showGeofences
        ? geofenceSites
            .filter((site) => site.latitude != null && site.longitude != null)
            .map((site) => ({
              id: `geofence-${site.id}`,
              latitude: site.latitude as number,
              longitude: site.longitude as number,
              radiusMeters: site.siteRadiusMeters ?? 402,
              color: selectedSiteId === site.id ? "#f59e0b" : "#2563eb",
              opacity: selectedSiteId === site.id ? 0.14 : 0.06,
            }))
        : [],
    [geofenceSites, selectedSiteId, showGeofences],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
          <SelectTrigger className="w-full sm:w-[220px]" aria-label={t("crewMap.employeeFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("crewMap.allEmployees")}</SelectItem>
            {Array.from(new Map(locations.map((loc) => [loc.employeeId, loc])).values()).map((loc) => (
              <SelectItem key={loc.employeeId} value={String(loc.employeeId)}>{loc.employeeName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={activityFilter} onValueChange={setActivityFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label={t("crewMap.activityFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("crewMap.allActivities")}</SelectItem>
            {["en_route", "on_location", "on_site"].map((state) => (
              <SelectItem key={state} value={state}>{lifecycleLabel(state, t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isForemanPortal && <label className="inline-flex items-center gap-2 cursor-pointer">
          <Checkbox checked={showVisitors} onCheckedChange={(value) => setShowVisitors(value === true)} />
          {t("crewMap.showVisitors")}
        </label>}
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
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">
                      {t("crewMap.loadingMap", "Loading map...")}
                    </div>
                  }
                >
                  <LazyMapboxMap
                    points={mapPoints}
                    lines={mapLines}
                    circles={mapCircles}
                    center={[center[1], center[0]]}
                    zoom={locations.length + visitors.length > 0 ? 8 : 4}
                    styleKind="street"
                    height="100%"
                  />
                </Suspense>
              </div>
            </CardContent>
          </Card>
          {employeeFilter !== "all" && displayedLocations[0] && <CrewInspector point={displayedLocations[0]} scope={`${user?.userId}:${user?.role}:${user?.vendorId}:${user?.partnerId}`} />}
        </div>

        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Clock className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
                {t("crewMap.onShiftNow", { count: displayedLocations.length })}
              </CardTitle>
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
                    className={cn(
                      CARD_INNER_TILE_HOVER_CLASS,
                      "text-sm",
                      flashingEmployeeIds.has(loc.employeeId) && "lifecycle-flash",
                    )}
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

          <MapComplianceIssuesCard siteLocationId={selectedSiteId} />

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
