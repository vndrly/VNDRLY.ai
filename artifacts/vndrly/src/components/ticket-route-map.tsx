import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import SplitToggleHalf from "@/components/split-toggle-half";
import { pickTogglePillSrc, TOGGLE_IDLE_PILL_SRC } from "@/lib/pick-toggle-pill";
import { LONG_DWELL_MS as DEFAULT_LONG_DWELL_MS, deriveLongStops, formatDwell } from "@/lib/stops";
import type { MapboxCircle, MapboxLine, MapboxPoint } from "@/components/mapbox-map";

const LazyMapboxMap = lazy(() =>
  import("@/components/mapbox-map").then((mod) => ({ default: mod.MapboxMap })),
);

export type RoutePoint = {
  id?: number | string;
  latitude: number;
  longitude: number;
  recordedAt?: string | Date | null;
};

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

type Props = {
  site?: { latitude: number; longitude: number; name?: string } | null;
  checkIn?: { latitude: number; longitude: number; time?: string | Date | null } | null;
  checkOut?: { latitude: number; longitude: number; time?: string | Date | null } | null;
  tracking?: RoutePoint[];
  height?: number;
  selectedTrackingId?: number | string | null;
  onSelectTracking?: (id: number | string | null) => void;
  longStopThresholdMs?: number;
  showHeadings?: boolean;
  siteRadiusMeters?: number | null;
  visitPins?: Array<{
    key: string;
    latitude: number;
    longitude: number;
    label: string;
    title?: string;
  }>;
};

function popup(title: string, lines: Array<string | null | undefined>): string {
  return `<div class="text-xs"><div class="font-semibold">${title}</div>${lines
    .filter(Boolean)
    .map((line) => `<div>${line}</div>`)
    .join("")}</div>`;
}

function coordLine(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export function TicketRouteMap({
  site,
  checkIn,
  checkOut,
  tracking,
  height = 360,
  selectedTrackingId,
  onSelectTracking,
  longStopThresholdMs = DEFAULT_LONG_DWELL_MS,
  siteRadiusMeters = null,
  visitPins = [],
}: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<"map" | "satellite">("satellite");
  const brand = useBrand();

  const validSite = site && isValidLatLng(site.latitude, site.longitude) ? site : null;
  const validCheckIn = checkIn && isValidLatLng(checkIn.latitude, checkIn.longitude) ? checkIn : null;
  const validCheckOut = checkOut && isValidLatLng(checkOut.latitude, checkOut.longitude) ? checkOut : null;

  const sortedTracking = useMemo(() => {
    if (!tracking || tracking.length === 0) return [];
    return tracking
      .filter((p) => isValidLatLng(p.latitude, p.longitude))
      .slice()
      .sort((a, b) => {
        const at = a.recordedAt ? new Date(a.recordedAt).getTime() : 0;
        const bt = b.recordedAt ? new Date(b.recordedAt).getTime() : 0;
        return at - bt;
      });
  }, [tracking]);

  const pathPoints = useMemo<Array<[number, number]>>(() => {
    const pts: Array<[number, number]> = [];
    if (validCheckIn) pts.push([validCheckIn.latitude, validCheckIn.longitude]);
    for (const p of sortedTracking) pts.push([p.latitude, p.longitude]);
    if (validCheckOut) pts.push([validCheckOut.latitude, validCheckOut.longitude]);
    return pts;
  }, [validCheckIn, validCheckOut, sortedTracking]);

  const allPoints = useMemo<Array<[number, number]>>(() => {
    const pts: Array<[number, number]> = [...pathPoints];
    if (validSite) pts.push([validSite.latitude, validSite.longitude]);
    for (const pin of visitPins ?? []) {
      if (isValidLatLng(pin.latitude, pin.longitude)) pts.push([pin.latitude, pin.longitude]);
    }
    return pts;
  }, [pathPoints, validSite, visitPins]);

  const stops = useMemo(
    () => deriveLongStops(sortedTracking, longStopThresholdMs),
    [sortedTracking, longStopThresholdMs],
  );

  const mapPoints = useMemo<MapboxPoint[]>(() => {
    const pts: MapboxPoint[] = [];
    sortedTracking.forEach((p, i) => {
      const id = p.id != null ? String(p.id) : `tracking-${i}`;
      pts.push({
        id,
        latitude: p.latitude,
        longitude: p.longitude,
        color: p.id != null && p.id === selectedTrackingId ? "#f59e0b" : "#2563eb",
        label: "",
        title: t("ticketRouteMap.trackingPoint", { n: i + 1 }),
        popupHtml: popup(t("ticketRouteMap.trackingPoint", { n: i + 1 }), [
          p.recordedAt ? new Date(p.recordedAt).toLocaleString() : null,
          coordLine(p.latitude, p.longitude),
        ]),
        onClick: onSelectTracking && p.id != null ? () => onSelectTracking(p.id ?? null) : undefined,
      });
    });
    stops.forEach((stop, i) => {
      const targetId = stop.endPoint.id;
      pts.push({
        id: `stop-${targetId ?? i}`,
        latitude: stop.startPoint.latitude,
        longitude: stop.startPoint.longitude,
        color: "#F59E0B",
        label: String(i + 1),
        title: t("ticketRouteMap.stop", { n: i + 1 }),
        popupHtml: popup(t("ticketRouteMap.stop", { n: i + 1 }), [
          stop.startTime ? stop.startTime.toLocaleString() : null,
          t("ticketRouteMap.duration", { value: formatDwell(stop.durationMs) }),
          coordLine(stop.startPoint.latitude, stop.startPoint.longitude),
        ]),
        onClick: onSelectTracking && targetId != null ? () => onSelectTracking(targetId) : undefined,
      });
    });
    if (validSite) {
      pts.push({
        id: "site",
        latitude: validSite.latitude,
        longitude: validSite.longitude,
        color: "#f59e0b",
        label: "S",
        title: validSite.name || t("ticketRouteMap.siteLocation"),
        popupHtml: popup(validSite.name || t("ticketRouteMap.siteLocation"), [
          coordLine(validSite.latitude, validSite.longitude),
        ]),
      });
    }
    for (const pin of visitPins ?? []) {
      if (!isValidLatLng(pin.latitude, pin.longitude)) continue;
      pts.push({
        id: `visit-${pin.key}`,
        latitude: pin.latitude,
        longitude: pin.longitude,
        color: "#6366f1",
        label: pin.label,
        title: pin.title ?? pin.label,
        popupHtml: popup(pin.title ?? pin.label, []),
      });
    }
    if (validCheckIn) {
      pts.push({
        id: "check-in",
        latitude: validCheckIn.latitude,
        longitude: validCheckIn.longitude,
        color: "#16a34a",
        label: "In",
        title: t("ticketRouteMap.checkIn"),
        popupHtml: popup(t("ticketRouteMap.checkIn"), [
          validCheckIn.time ? new Date(validCheckIn.time).toLocaleString() : null,
          coordLine(validCheckIn.latitude, validCheckIn.longitude),
        ]),
      });
    }
    if (validCheckOut) {
      pts.push({
        id: "check-out",
        latitude: validCheckOut.latitude,
        longitude: validCheckOut.longitude,
        color: "#dc2626",
        label: "Out",
        title: t("ticketRouteMap.checkOut"),
        popupHtml: popup(t("ticketRouteMap.checkOut"), [
          validCheckOut.time ? new Date(validCheckOut.time).toLocaleString() : null,
          coordLine(validCheckOut.latitude, validCheckOut.longitude),
        ]),
      });
    }
    return pts;
  }, [onSelectTracking, selectedTrackingId, sortedTracking, stops, t, validCheckIn, validCheckOut, validSite, visitPins]);

  const lines = useMemo<MapboxLine[]>(
    () =>
      pathPoints.length >= 2
        ? [{ id: "route", coordinates: pathPoints, color: "#2563eb", width: 4, opacity: 0.85 }]
        : [],
    [pathPoints],
  );
  const circles = useMemo<MapboxCircle[]>(
    () =>
      validSite && siteRadiusMeters != null && siteRadiusMeters > 0
        ? [
            {
              id: "site-radius",
              latitude: validSite.latitude,
              longitude: validSite.longitude,
              radiusMeters: siteRadiusMeters,
              color: "#2563eb",
              opacity: 0.07,
            },
          ]
        : [],
    [siteRadiusMeters, validSite],
  );

  if (allPoints.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded border border-border bg-muted/40 text-sm text-muted-foreground"
        style={{ height }}
      >
        {t("ticketRouteMap.noGps")}
      </div>
    );
  }

  const activePillSrc = pickTogglePillSrc(brand.primary, brand.name);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="inline-flex items-stretch rounded-full overflow-hidden" data-testid="map-view-toggle">
          <SplitToggleHalf
            side="left"
            active={view === "map"}
            pillSrc={view === "map" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
            onClick={() => setView("map")}
            data-testid="button-map-view-map"
            aria-pressed={view === "map"}
          >
            {t("ticketRouteMap.viewMap")}
          </SplitToggleHalf>
          <span aria-hidden className="w-px shrink-0 self-stretch bg-gray-300" />
          <SplitToggleHalf
            side="right"
            active={view === "satellite"}
            pillSrc={view === "satellite" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
            onClick={() => setView("satellite")}
            data-testid="button-map-view-satellite"
            aria-pressed={view === "satellite"}
          >
            {t("ticketRouteMap.viewSatellite")}
          </SplitToggleHalf>
        </div>
      </div>
      <div
        className={cn("relative overflow-hidden rounded border-[3px]")}
        style={{ borderColor: "var(--brand-primary, #f59e0b)" }}
      >
        <Suspense
          fallback={
            <div
              className="flex items-center justify-center bg-muted/40 text-sm text-muted-foreground"
              style={{ height }}
            >
              {t("common.loading")}
            </div>
          }
        >
          <LazyMapboxMap
            points={mapPoints}
            lines={lines}
            circles={circles}
            height={height}
            styleKind={view === "satellite" ? "satellite" : "street"}
            selectedPointId={selectedTrackingId != null ? String(selectedTrackingId) : null}
          />
        </Suspense>
      </div>
    </div>
  );
}
