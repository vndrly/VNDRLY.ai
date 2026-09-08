import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import SphereBackButton from "@/components/sphere-back-button";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BatteryLow, Gauge, MapPin, Navigation, RefreshCw } from "lucide-react";
import LiveConnectionPill, { type LiveConnectionStatus } from "@/components/live-connection-pill";
import { resolveSiteMapRadiusMeters } from "@workspace/map-utils";
import { Checkbox } from "@/components/ui/checkbox";
import { RecentTicketsCard } from "@/components/map/recent-tickets-card";
import { MapComplianceIssuesCard } from "@/components/map/map-compliance-issues-card";
import {
  useListSiteLocations,
  getListSiteLocationsQueryKey,
} from "@workspace/api-client-react";
import { visitsApi, type VisitorRow } from "@/lib/visits-api";
import type { MapboxCircle, MapboxPoint } from "@/components/mapbox-map";
import SiteMapToolbox from "@/components/map/site-map-toolbox";

const LazyMapboxMap = lazy(() =>
  import("@/components/mapbox-map").then((mod) => ({ default: mod.MapboxMap })),
);

const LOW_BATTERY_THRESHOLD = 0.2;
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 2.23694;
const NEARBY_FALLBACK_POLL_MS = 60_000;
const SPEED_MIN_MOVING_MPS = 1.8;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type ActiveTicket = {
  ticketId: number;
  lifecycleState: string | null;
  siteLocationId: number | null;
  siteName: string | null;
  siteCode: string | null;
};

type NearbyEmployee = {
  employeeId: number;
  employeeName: string;
  vendorId: number | null;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  batteryLevel: number | null;
  heading: number | null;
  speedMps: number | null;
  recordedAt: string;
  activeTicket: ActiveTicket | null;
};

type SiteMapResponse = {
  site: {
    id: number;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    siteCode: string | null;
    partnerId: number | null;
  };
  radiusMeters: number;
  employees: NearbyEmployee[];
};

type GeofenceSite = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  siteRadiusMeters?: number | null;
};

type OverviewSite = GeofenceSite & {
  nearbyCount: number;
  radiusMeters: number;
  address?: string | null;
  siteCode?: string | null;
};

type OverviewResponse = {
  sites: OverviewSite[];
  employees: Array<NearbyEmployee & { nearestSiteId: number; ticketId: number; lifecycleState: string | null }>;
};

function formatSpeed(mps: number | null): string {
  if (mps == null || mps < SPEED_MIN_MOVING_MPS) return "Parked";
  return `${Math.round(mps * MPS_TO_MPH)} mph`;
}

function formatDistance(meters: number): string {
  const mi = meters / METERS_PER_MILE;
  if (mi < 0.1) return `${Math.round(meters)} m`;
  return `${mi < 10 ? mi.toFixed(2) : Math.round(mi)} mi`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function lifecycleLabel(
  state: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!state) return "";
  const key = `crewMap.lifecycleState.${state}`;
  const translated = t(key);
  if (translated === key) return state.replace(/_/g, " ");
  return translated;
}

// Top-down car silhouette identical to the Crew Map pin so the visual
// vocabulary stays consistent across the two pages. Color reflects the
// employee's current ticket lifecycle state when they are actively signed
// in to a ticket; otherwise we use a neutral slate color since they're on
// site without an active visit record.
function employeeColor(emp: NearbyEmployee): string {
  const lifecycle = emp.activeTicket?.lifecycleState ?? null;
  return (
    lifecycle === "en_route"
      ? "#f59e0b"
      : lifecycle === "on_location"
        ? "#6366f1"
        : lifecycle === "on_site"
          ? "#10b981"
          : "#64748b"
  );
}

function formatEta(distanceMeters: number, speedMps: number | null): string | null {
  if (speedMps == null || speedMps < SPEED_MIN_MOVING_MPS) return null;
  const minutes = Math.max(1, Math.round(distanceMeters / speedMps / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default function SiteMapPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const brand = useBrand();
  // Site Map is only meaningful for partners (their own sites) and admins
  // (any site). Vendor / field-employee users would only ever see 403s from
  // the API, so block at the page level for a cleaner UX.
  const allowed = user?.role === "partner" || user?.role === "admin";
  const initialSiteId = typeof window !== "undefined"
    ? Number(new URLSearchParams(window.location.search).get("siteId"))
    : NaN;
  const { data: sitesResp } = useListSiteLocations(undefined, {
    query: {
      enabled: allowed,
      queryKey: getListSiteLocationsQueryKey(),
    },
  });
  // The list endpoint returns `{ items: [...] }`, but with several
  // serializers in play the raw response may already be the array — handle
  // both shapes defensively.
  const sites = useMemo(() => {
    const items = (sitesResp as any)?.items ?? sitesResp;
    if (!Array.isArray(items)) return [];
    // Only sites with coords are useful as a map center.
    return items.filter(
      (s: any) =>
        s.latitude != null &&
        s.longitude != null &&
        Number.isFinite(Number(s.latitude)) &&
        Number.isFinite(Number(s.longitude)),
    );
  }, [sitesResp]);

  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"single" | "all">("single");
  const [data, setData] = useState<SiteMapResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveConnectionStatus>("connecting");
  const fetchSeqRef = useRef(0);

  // Auto-select the first site as soon as the list resolves so the user
  // lands on a usable map without an extra click.
  useEffect(() => {
    if (selectedSiteId == null && sites.length > 0) {
      const fromUrl = Number.isFinite(initialSiteId) && initialSiteId > 0 ? initialSiteId : null;
      const pick = fromUrl && sites.some((s: any) => Number(s.id) === fromUrl)
        ? fromUrl
        : Number(sites[0].id);
      setSelectedSiteId(pick);
    }
  }, [sites, selectedSiteId, initialSiteId]);

  const selectedSite = useMemo(
    () => sites.find((s: any) => Number(s.id) === selectedSiteId) ?? null,
    [sites, selectedSiteId],
  );

  async function fetchOverview(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    const seq = ++fetchSeqRef.current;
    try {
      const r = await fetch(`${API_BASE}/api/site-map/overview`, { credentials: "include" });
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      const json = (await r.json()) as OverviewResponse;
      if (seq !== fetchSeqRef.current) return;
      setOverview(json);
      setError(null);
      setLoadedAt(new Date());
    } catch (e: any) {
      if (seq === fetchSeqRef.current) setError(e?.message ?? "Failed to load");
    } finally {
      if (seq === fetchSeqRef.current && !opts.silent) setLoading(false);
    }
  }

  async function fetchNearby(siteId: number, opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    const seq = ++fetchSeqRef.current;
    try {
      const r = await fetch(
        `${API_BASE}/api/site-map/${siteId}/nearby`,
        { credentials: "include" },
      );
      if (!r.ok) {
        if (seq === fetchSeqRef.current) {
          setError(`Failed to load (${r.status})`);
          setData(null);
        }
        return;
      }
      const json = (await r.json()) as SiteMapResponse;
      // Drop the response if a newer fetch has already been kicked off.
      if (seq !== fetchSeqRef.current) return;
      setData(json);
      setError(null);
      setLoadedAt(new Date());
    } catch (e: any) {
      if (seq === fetchSeqRef.current) {
        setError(e?.message ?? "Failed to load");
      }
    } finally {
      if (seq === fetchSeqRef.current && !opts.silent) setLoading(false);
    }
  }

  // Fetch once on site change, then poll on a fixed interval. Polling is
  // simpler than wiring up a second SSE channel and is plenty responsive
  // for "who is near my site right now".
  useEffect(() => {
    if (!allowed) return;
    if (viewMode === "all") {
      fetchOverview();
      const id = window.setInterval(() => fetchOverview({ silent: true }), NEARBY_FALLBACK_POLL_MS);
      return () => window.clearInterval(id);
    }
    if (selectedSiteId == null) return;
    fetchNearby(selectedSiteId);
    const id = window.setInterval(() => {
      fetchNearby(selectedSiteId, { silent: true });
    }, NEARBY_FALLBACK_POLL_MS);
    return () => window.clearInterval(id);
  }, [selectedSiteId, viewMode, allowed]);

  useEffect(() => {
    if (!allowed || viewMode !== "single" || selectedSiteId == null) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/api/live-locations/events`, { withCredentials: true });
      es.onopen = () => setLiveStatus("live");
      es.onerror = () => setLiveStatus("reconnecting");
      es.addEventListener("location.ping", () => {
        setLiveStatus("live");
        fetchNearby(selectedSiteId, { silent: true });
      });
    } catch {
      setLiveStatus("reconnecting");
    }
    return () => {
      es?.close();
    };
  }, [allowed, viewMode, selectedSiteId]);

  const center: [number, number] | null = data?.site.latitude != null && data?.site.longitude != null
    ? [data.site.latitude, data.site.longitude]
    : selectedSite
      ? [Number(selectedSite.latitude), Number(selectedSite.longitude)]
      : null;

  // placeholder — recomputed below after geofenceSites
  let mapCenter = center;

  // Active visitors across ALL of the partner's site locations.
  // The /api/visits list endpoint is partner-scoped server-side
  // (see routes/visits.ts), so a partner only ever sees visits at
  // their own sites. We then narrow to "currently on site" by
  // dropping any visit that already has a checkOutTime, and to
  // pin-able by requiring a check-in lat/lng. Polled on the same
  // 30s interval the Visitors page uses to keep the load light.
  const { data: visitorsResp } = useQuery<VisitorRow[]>({
    queryKey: ["site-map-active-visitors"],
    queryFn: () => visitsApi.list(),
    enabled: allowed,
    refetchInterval: 30_000,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const activeVisitors = useMemo(() => {
    const list = Array.isArray(visitorsResp) ? visitorsResp : [];
    return list.filter(
      (v) =>
        v.checkOutTime == null &&
        v.checkInLatitude != null &&
        v.checkInLongitude != null &&
        Number.isFinite(Number(v.checkInLatitude)) &&
        Number.isFinite(Number(v.checkInLongitude)),
    );
  }, [visitorsResp]);

  const employees = viewMode === "all"
    ? (overview?.employees ?? []).map((e) => ({
        employeeId: e.employeeId,
        employeeName: e.employeeName,
        vendorId: null,
        latitude: e.latitude,
        longitude: e.longitude,
        distanceMeters: e.distanceMeters,
        batteryLevel: e.batteryLevel,
        heading: e.heading ?? null,
        speedMps: e.speedMps,
        recordedAt: e.recordedAt,
        activeTicket: {
          ticketId: e.ticketId,
          lifecycleState: e.lifecycleState,
          siteLocationId: e.nearestSiteId,
          siteName: sites.find((s: any) => Number(s.id) === e.nearestSiteId)?.name ?? null,
          siteCode: null,
        },
      }))
    : (data?.employees ?? []);
  const radiusMeters = viewMode === "all"
    ? resolveSiteMapRadiusMeters(selectedSite?.siteRadiusMeters ?? null)
    : (data?.radiusMeters ?? resolveSiteMapRadiusMeters(selectedSite?.siteRadiusMeters ?? null));
  const radiusMiles = radiusMeters / METERS_PER_MILE;
  const geofenceSites: GeofenceSite[] = useMemo(() => {
    if (viewMode === "all" && overview?.sites?.length) {
      return overview.sites.map((s) => ({
        id: s.id,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        siteRadiusMeters: s.siteRadiusMeters,
      }));
    }
    return sites.map((s: any) => ({
      id: Number(s.id),
      name: s.name,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      siteRadiusMeters: s.siteRadiusMeters ?? null,
    }));
  }, [viewMode, overview, sites]);

  if (viewMode === "all" && geofenceSites.length > 0) {
    const lat = geofenceSites.reduce((s, g) => s + g.latitude, 0) / geofenceSites.length;
    const lng = geofenceSites.reduce((s, g) => s + g.longitude, 0) / geofenceSites.length;
    mapCenter = [lat, lng];
  } else {
    mapCenter = center;
  }

  const mapPoints = useMemo<MapboxPoint[]>(() => {
    const points: MapboxPoint[] = [];
    if (viewMode === "single" && mapCenter) {
      points.push({
        id: "selected-site",
        latitude: mapCenter[0],
        longitude: mapCenter[1],
        color: "#2563eb",
        label: "S",
        imageUrl: brand.logoSquareUrl ?? brand.logoUrl,
        title: data?.site.name ?? selectedSite?.name ?? t("siteMap.siteLabel", "Site location"),
        popupHtml: `
          <div class="text-sm space-y-1 min-w-[180px]">
            <div class="font-semibold">${escapeHtml(data?.site.name ?? selectedSite?.name ?? "")}</div>
            ${data?.site.address ? `<div class="text-xs text-muted-foreground">${escapeHtml(data.site.address)}</div>` : ""}
            <div class="text-xs text-muted-foreground">${escapeHtml(t("siteMap.radius", "Radius"))}: ${radiusMiles.toFixed(2)} mi</div>
          </div>`,
      });
    }

    if (viewMode === "all") {
      for (const site of geofenceSites) {
        points.push({
          id: `site-${site.id}`,
          latitude: site.latitude,
          longitude: site.longitude,
          color: "var(--brand-primary)",
          imageUrl: brand.logoSquareUrl ?? brand.logoUrl,
          label: "S",
          title: site.name,
          popupHtml: `<div class="text-sm min-w-[180px]"><div class="font-semibold">${escapeHtml(site.name)}</div></div>`,
        });
      }
    }

    for (const v of activeVisitors) {
      const visitorName =
        [v.firstName, v.lastName].filter(Boolean).join(" ") ||
        t("siteMap.visitor.unknownName", "Visitor");
      points.push({
        id: `visitor-${v.id}`,
        latitude: Number(v.checkInLatitude),
        longitude: Number(v.checkInLongitude),
        color: "var(--brand-primary)",
        label: "V",
        title: visitorName,
        popupHtml: `
          <div class="text-sm space-y-1 min-w-[200px]" data-testid="popup-site-visitor-${v.id}">
            <div class="font-semibold">${escapeHtml(visitorName)}</div>
            ${v.company ? `<div class="text-xs text-muted-foreground">${escapeHtml(v.company)}</div>` : ""}
            ${v.siteName ? `<div class="text-xs">${escapeHtml(v.siteName)}</div>` : ""}
            ${(v.hostPartnerName || v.hostVendorName) ? `<div class="text-xs text-muted-foreground">${escapeHtml(t("siteMap.visitor.hostedBy", "Hosted by"))}: ${escapeHtml(v.hostType === "vendor" ? v.hostVendorName : v.hostPartnerName)}</div>` : ""}
            <div class="text-xs text-muted-foreground">${escapeHtml(t("siteMap.visitor.checkedIn", "Checked in"))}: ${escapeHtml(timeAgo(v.checkInTime))}</div>
          </div>`,
      });
    }

    for (const emp of employees) {
      const lowBattery = emp.batteryLevel != null && emp.batteryLevel <= LOW_BATTERY_THRESHOLD;
      const eta = formatEta(emp.distanceMeters, emp.speedMps);
      points.push({
        id: `employee-${emp.employeeId}`,
        latitude: emp.latitude,
        longitude: emp.longitude,
        color: lowBattery ? "#dc2626" : employeeColor(emp),
        label: lowBattery ? "!" : "C",
        title: emp.employeeName,
        popupHtml: `
          <div class="text-sm space-y-1 min-w-[220px]" data-testid="popup-site-employee-${emp.employeeId}">
            <div class="font-semibold">${escapeHtml(emp.employeeName)}</div>
            ${emp.activeTicket ? `<div class="text-xs"><a href="/tickets/${emp.activeTicket.ticketId}" class="underline">${escapeHtml(t("crewMap.ticketLabel", { id: emp.activeTicket.ticketId }))}</a> - ${escapeHtml(lifecycleLabel(emp.activeTicket.lifecycleState, t))}</div>` : `<div class="text-xs italic text-muted-foreground">${escapeHtml(t("siteMap.noActiveTicket", "Not signed in to a ticket"))}</div>`}
            ${emp.activeTicket?.siteName ? `<div class="text-xs">${escapeHtml(emp.activeTicket.siteName)}</div>` : ""}
            ${emp.activeTicket?.siteName ? `<div class="text-xs text-muted-foreground">${escapeHtml(t("siteMap.destination", "Destination"))}: ${escapeHtml(emp.activeTicket.siteName)}</div>` : ""}
            <div class="text-xs font-medium">${escapeHtml(formatDistance(emp.distanceMeters))} ${escapeHtml(t("siteMap.fromSite", "from site"))}</div>
            <div class="text-xs">${escapeHtml(formatSpeed(emp.speedMps))}</div>
            ${eta ? `<div class="text-xs font-medium">${escapeHtml(t("siteMap.eta", "ETA"))}: ${escapeHtml(eta)}</div>` : ""}
            <div class="text-xs text-muted-foreground">${escapeHtml(t("siteMap.lastSeen", "Last seen"))}: ${escapeHtml(timeAgo(emp.recordedAt))}</div>
            ${emp.batteryLevel != null ? `<div class="text-xs ${lowBattery ? "text-red-600 font-medium" : "text-muted-foreground"}">${Math.round(emp.batteryLevel * 100)}%</div>` : ""}
          </div>`,
      });
    }

    return points;
  }, [activeVisitors, brand.logoSquareUrl, brand.logoUrl, data, employees, geofenceSites, mapCenter, radiusMiles, selectedSite, t, viewMode]);

  const mapCircles = useMemo<MapboxCircle[]>(
    () =>
      geofenceSites.map((site) => ({
        id: `geofence-${site.id}`,
        latitude: site.latitude,
        longitude: site.longitude,
        radiusMeters: resolveSiteMapRadiusMeters(site.siteRadiusMeters ?? null),
        color: viewMode === "single" && selectedSiteId === site.id ? "#2563eb" : "var(--brand-primary)",
        opacity: viewMode === "single" && selectedSiteId === site.id ? 0.18 : 0.1,
      })),
    [geofenceSites, selectedSiteId, viewMode],
  );

  // Guard: a partner without sites should still see a clear empty state
  // instead of a broken-looking map.
  const noSites = sites.length === 0;

  if (!allowed) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{t("siteMap.title", "Site Map")}</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t(
              "siteMap.notAllowed",
              "Site Map is available to partner and admin accounts only.",
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-site-map-title">
              {t("siteMap.title", "Site Map")}
            </h1>
            <div className="flex items-center gap-2">
              <LiveConnectionPill status={liveStatus} testId="site-map-live-connection-pill" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t(
                "siteMap.subtitle",
                "See field employees currently within a quarter mile of your site location.",
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Dark-grey idle, brand-primary on hover — matches the
              brand-aware chrome elsewhere on this page (2px frame,
              on-site TogglePill, visitor pins). */}
          <button
            type="button"
            onClick={() => selectedSiteId != null && fetchNearby(selectedSiteId)}
            className="inline-flex items-center gap-1 text-xs underline text-gray-700 hover:text-[var(--brand-primary)] transition-colors"
            disabled={selectedSiteId == null || loading}
            data-testid="button-site-map-refresh"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            {t("siteMap.refresh", "Refresh")}
          </button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={viewMode === "all"}
              onCheckedChange={(v) => setViewMode(v === true ? "all" : "single")}
              data-testid="checkbox-site-map-all-sites"
            />
            {t("siteMap.allSitesView", "All sites overview")}
          </label>
          {viewMode === "single" && (
          <>
          <label className="text-sm font-medium" htmlFor="site-map-site-select">
            {t("siteMap.siteLabel", "Site location")}
          </label>
          <div className="min-w-[260px]">
            <Select
              value={selectedSiteId != null ? String(selectedSiteId) : ""}
              onValueChange={(v) => setSelectedSiteId(Number(v))}
              disabled={noSites}
            >
              <SelectTrigger
                id="site-map-site-select"
                data-testid="select-site-map-site"
              >
                <SelectValue
                  placeholder={
                    noSites
                      ? t("siteMap.noSites", "No site locations available")
                      : t("siteMap.choose", "Select a site...")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      {s.name}
                      {s.siteCode ? (
                        <span className="text-xs text-muted-foreground">
                          · {s.siteCode}
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedSite && (
            <div className="text-xs text-muted-foreground">
              {selectedSite.address ? selectedSite.address : null}
            </div>
          )}
          </>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          {/* 2px brand-primary frame so the map reads as the
              partner's primary surface, matching the rest of the
              brand-tinted chrome on the site detail pages.
              Default base tile is Esri World Imagery (satellite) —
              same provider used by SiteLocationMap and
              TicketRouteMap so the wellhead reads as a real-world
              place rather than a road map. */}
          <Card className="border-2" style={{ borderColor: "var(--brand-primary)" }}>
            <CardContent className="p-0">
              <div className="relative" style={{ height: 520 }}>
                {mapCenter ? (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">
                        {t("siteMap.loadingMap", "Loading map...")}
                      </div>
                    }
                  >
                    <LazyMapboxMap
                      points={mapPoints}
                      circles={mapCircles}
                      center={[mapCenter[1], mapCenter[0]]}
                      zoom={viewMode === "all" ? 8 : 15}
                      styleKind="satellite"
                      height="100%"
                    />
                  </Suspense>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    {noSites
                      ? t(
                          "siteMap.emptyNoSites",
                          "No site locations with coordinates yet.",
                        )
                      : t("siteMap.loadingMap", "Loading map...")}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle
                className="text-base"
                data-testid="text-on-site-now-title"
              >
                {t("siteMap.onSiteNow", "On Site Now")} ({employees.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[520px] overflow-y-auto">
              {selectedSiteId == null ? (
                <div className="text-sm text-muted-foreground">
                  {t(
                    "siteMap.pickSitePrompt",
                    "Select a site location to see who's on site.",
                  )}
                </div>
              ) : employees.length === 0 ? (
                <div
                  className="text-sm text-muted-foreground"
                  data-testid="text-site-map-empty"
                >
                  {t(
                    "siteMap.empty",
                    "No field employees within a quarter mile right now.",
                  )}
                </div>
              ) : (
                employees.map((emp) => {
                  const lowBattery =
                    emp.batteryLevel != null &&
                    emp.batteryLevel <= LOW_BATTERY_THRESHOLD;
                  return (
                    <div
                      key={emp.employeeId}
                      className="border rounded-md p-2 text-sm"
                      data-testid={`card-site-map-employee-${emp.employeeId}`}
                    >
                      <div className="font-medium flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: employeeColor(emp) }}
                        />
                        {emp.employeeName}
                        {lowBattery && (
                          <BatteryLow className="h-3.5 w-3.5 text-red-600" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {emp.activeTicket ? (
                          <>
                            <Link
                              href={`/tickets/${emp.activeTicket.ticketId}`}
                              className="underline"
                            >
                              {t("crewMap.ticketLabel", {
                                id: emp.activeTicket.ticketId,
                              })}
                            </Link>
                            {" · "}
                            {lifecycleLabel(emp.activeTicket.lifecycleState, t)}
                          </>
                        ) : (
                          <span className="italic">
                            {t("siteMap.noActiveTicket", "Not signed in to a ticket")}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatDistance(emp.distanceMeters)} · {timeAgo(emp.recordedAt)}
                      </div>
                      <Link
                        href={`/crew-map/${emp.employeeId}?date=${todayISO()}`}
                        className="text-xs underline mt-1 inline-block"
                      >
                        {t("crewMap.replayToday", "Replay today")}
                      </Link>
                    </div>
                  );
                })
              )}
              {loadedAt && (
                <div className="text-[10px] text-muted-foreground pt-1">
                  {t("siteMap.updated", "Updated")}: {loadedAt.toLocaleTimeString()}
                </div>
              )}
            </CardContent>
          </Card>
          <RecentTicketsCard
            siteLocationId={viewMode === "single" ? selectedSiteId : null}
          />

          <MapComplianceIssuesCard
            siteLocationId={viewMode === "single" ? selectedSiteId : null}
          />
        </div>
      </div>
      <SiteMapToolbox siteName={viewMode === "single" ? selectedSite?.name : "all authorized sites"} />
      {/* user is referenced solely so unused-imports stays quiet; the page
          relies on session cookies, not user object directly. */}
      <span className="hidden" aria-hidden>{user?.role ?? ""}</span>
    </div>
  );
}
