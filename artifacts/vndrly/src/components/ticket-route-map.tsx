import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";
import SplitToggleHalf from "@/components/split-toggle-half";
import {
  pickTogglePillSrc,
  SPLIT_TOGGLE_ACTIVE_TEXT_SHADOW,
  SPLIT_TOGGLE_IDLE_TEXT_CLASS,
  TOGGLE_IDLE_PILL_SRC,
} from "@/lib/pick-toggle-pill";
import { BrandZoomControlInMap } from "@/components/brand-zoom-control";
import { LONG_DWELL_MS as DEFAULT_LONG_DWELL_MS, deriveLongStops, formatDwell } from "@/lib/stops";

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
  // When true, render rotated arrow icons for each tracking ping using a
  // heading computed from the next consecutive ping (or a stationary
  // indicator when the device didn't move). Used by the day-replay view to
  // mirror the live Crew Map.
  showHeadings?: boolean;
};

function makePinIcon(color: string, label: string) {
  const html = `
    <div style="position: relative; width: 28px; height: 36px; transform: translate(-14px, -32px);">
      <div style="
        position: absolute;
        left: 0; top: 0;
        width: 28px; height: 28px;
        border-radius: 50%;
        background: ${color};
        border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        display: flex; align-items: center; justify-content: center;
        color: white; font-weight: 700; font-size: 12px; font-family: sans-serif;
      ">${label}</div>
      <div style="
        position: absolute;
        left: 11px; top: 26px;
        width: 0; height: 0;
        border-left: 3px solid transparent;
        border-right: 3px solid transparent;
        border-top: 8px solid ${color};
      "></div>
    </div>`;
  return L.divIcon({
    html,
    className: "vndrly-route-pin",
    iconSize: [28, 36],
    iconAnchor: [14, 32],
    popupAnchor: [0, -30],
  });
}

function makeStopIcon(label: string, selected: boolean) {
  const bg = selected ? "#f59e0b" : "#ea580c";
  const ring = selected ? "box-shadow: 0 0 0 3px rgba(245,158,11,0.45), 0 1px 4px rgba(0,0,0,0.5);" : "box-shadow: 0 1px 4px rgba(0,0,0,0.45);";
  const size = selected ? 32 : 28;
  const fontSize = selected ? 13 : 12;
  const html = `
    <div style="position: relative; width: ${size}px; height: ${size + 8}px; transform: translate(-${size / 2}px, -${size + 4}px);">
      <div style="
        position: absolute;
        left: 0; top: 0;
        width: ${size}px; height: ${size}px;
        border-radius: 50%;
        background: ${bg};
        border: 2px solid white;
        ${ring}
        display: flex; align-items: center; justify-content: center;
        color: white; font-weight: 700; font-size: ${fontSize}px; font-family: sans-serif;
      ">${label}</div>
      <div style="
        position: absolute;
        left: ${size / 2 - 3}px; top: ${size - 2}px;
        width: 0; height: 0;
        border-left: 3px solid transparent;
        border-right: 3px solid transparent;
        border-top: 8px solid ${bg};
      "></div>
    </div>`;
  return L.divIcon({
    html,
    className: "vndrly-route-stop-pin",
    iconSize: [size, size + 8],
    iconAnchor: [size / 2, size + 4],
    popupAnchor: [0, -size],
  });
}

const trackingDot = L.divIcon({
  html: `<div style="
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #2563eb;
    border: 2px solid white;
    box-shadow: 0 0 2px rgba(0,0,0,0.5);
  "></div>`,
  className: "vndrly-route-dot",
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const trackingDotSelected = L.divIcon({
  html: `<div style="
    width: 18px; height: 18px;
    border-radius: 50%;
    background: #f59e0b;
    border: 3px solid white;
    box-shadow: 0 0 0 2px #f59e0b, 0 0 6px rgba(0,0,0,0.6);
  "></div>`,
  className: "vndrly-route-dot-selected",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Bearing from point A to point B in degrees clockwise from north.
// Returns null if the two points are effectively the same location, so we
// don't fabricate a heading for stationary pings.
function computeBearing(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number | null {
  const dLat = b.latitude - a.latitude;
  const dLng = b.longitude - a.longitude;
  // Roughly < ~1.1m of movement at the equator: treat as stationary.
  if (Math.abs(dLat) < 1e-5 && Math.abs(dLng) < 1e-5) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLngRad = toRad(dLng);
  const y = Math.sin(dLngRad) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLngRad);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

// Arrow icon used on the day-replay timeline. The triangle points "up" in the
// raw SVG and we rotate the wrapper so it ends up pointing along `heading`
// (degrees clockwise from north — same convention as the live Crew Map).
function trackingArrowIcon(heading: number, selected: boolean, title: string) {
  const fill = selected ? "#f59e0b" : "#2563eb";
  const size = selected ? 22 : 16;
  const rounded = Math.round(heading);
  const html = `<div data-testid="replay-pin-heading" data-heading="${rounded}" title="${title}" style="width:${size}px;height:${size}px;transform:rotate(${heading}deg);display:flex;align-items:center;justify-content:center;">
    <div style="width:0;height:0;border-left:${size / 2}px solid transparent;border-right:${size / 2}px solid transparent;border-bottom:${size}px solid ${fill};filter:drop-shadow(0 1px 1px rgba(0,0,0,.5));"></div>
  </div>`;
  return L.divIcon({
    html,
    className: selected ? "vndrly-route-arrow-selected" : "vndrly-route-arrow",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Stationary indicator used on the day-replay timeline. Mirrors the dashed
// neutral ring from the live Crew Map so the two views read the same way.
function trackingStationaryIcon(selected: boolean, title: string) {
  const size = selected ? 18 : 12;
  const dot = selected ? "#f59e0b" : "#2563eb";
  const html = `<div data-testid="replay-pin-heading-neutral" title="${title}" style="position:relative;width:${size + 8}px;height:${size + 8}px;display:flex;align-items:center;justify-content:center;">
    <div style="position:absolute;inset:0;border-radius:50%;border:2px dashed rgba(37,99,235,.55);"></div>
    <div style="width:${size}px;height:${size}px;border-radius:50%;background:${dot};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,0.5);"></div>
  </div>`;
  return L.divIcon({
    html,
    className: selected ? "vndrly-route-stationary-selected" : "vndrly-route-stationary",
    iconSize: [size + 8, size + 8],
    iconAnchor: [(size + 8) / 2, (size + 8) / 2],
  });
}

function FitBounds({ points, enabled }: { points: [number, number][]; enabled: boolean }) {
  const map = useMap();
  const lastKey = useRef<string>("");
  useEffect(() => {
    if (!enabled) return;
    if (points.length === 0) return;
    const key = points.map((p) => p.join(",")).join("|");
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (points.length === 1) {
      map.setView(points[0], 16);
    } else {
      const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17 });
    }
  }, [map, points, enabled]);
  return null;
}

function PanTo({ point }: { point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    const currentZoom = map.getZoom();
    map.setView(point, Math.max(currentZoom, 16), { animate: true });
  }, [map, point]);
  return null;
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
  showHeadings = false,
}: Props) {
  const { t } = useTranslation();
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

  const pathPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    if (validCheckIn) pts.push([validCheckIn.latitude, validCheckIn.longitude]);
    for (const p of sortedTracking) pts.push([p.latitude, p.longitude]);
    if (validCheckOut) pts.push([validCheckOut.latitude, validCheckOut.longitude]);
    return pts;
  }, [validCheckIn, validCheckOut, sortedTracking]);

  const allPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [...pathPoints];
    if (validSite) pts.push([validSite.latitude, validSite.longitude]);
    return pts;
  }, [pathPoints, validSite]);

  const siteIcon = useMemo(() => makePinIcon("#f59e0b", t("ticketRouteMap.sitePinLabel")), [t]);
  const checkInIcon = useMemo(() => makePinIcon("#16a34a", t("ticketRouteMap.checkInPinLabel")), [t]);
  const checkOutIcon = useMemo(() => makePinIcon("#dc2626", t("ticketRouteMap.checkOutPinLabel")), [t]);

  const stops = useMemo(
    () => deriveLongStops(sortedTracking, longStopThresholdMs),
    [sortedTracking, longStopThresholdMs],
  );

  // Heading per tracking ping (clockwise from north), derived from the
  // bearing toward the *next* ping. Stationary pings (essentially zero
  // displacement to the next ping) and the final ping (no next ping to
  // derive direction from) get null and render the neutral indicator.
  const headings = useMemo<(number | null)[]>(() => {
    if (!showHeadings || sortedTracking.length === 0) return [];
    const out: (number | null)[] = new Array(sortedTracking.length).fill(null);
    for (let i = 0; i < sortedTracking.length - 1; i++) {
      out[i] = computeBearing(sortedTracking[i], sortedTracking[i + 1]);
    }
    return out;
  }, [showHeadings, sortedTracking]);

  const selectedPoint = useMemo<[number, number] | null>(() => {
    if (selectedTrackingId == null) return null;
    const found = sortedTracking.find((p) => p.id === selectedTrackingId);
    return found ? [found.latitude, found.longitude] : null;
  }, [selectedTrackingId, sortedTracking]);

  const [view, setView] = useState<"map" | "satellite">("satellite");
  const brand = useBrand();

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

  const center = allPoints[0];
  const tileConfig = view === "satellite"
    ? {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxZoom: 19,
      }
    : {
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      };

  const activePillSrc = pickTogglePillSrc(brand.primary, brand.name);
  const activeText = cn("text-white", SPLIT_TOGGLE_ACTIVE_TEXT_SHADOW);
  const idleText = SPLIT_TOGGLE_IDLE_TEXT_CLASS;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div
          className="inline-flex items-stretch rounded-full overflow-hidden"
          data-testid="map-view-toggle"
        >
          <SplitToggleHalf
            side="left"
            pillSrc={view === "map" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
            bgClassName={view !== "map" ? "opacity-70" : undefined}
            textClassName={view === "map" ? activeText : idleText}
            onClick={() => setView("map")}
            data-testid="button-map-view-map"
            aria-pressed={view === "map"}
          >
            {t("ticketRouteMap.viewMap")}
          </SplitToggleHalf>
          <span aria-hidden className="w-px shrink-0 self-stretch bg-gray-300" />
          <SplitToggleHalf
            side="right"
            pillSrc={view === "satellite" ? activePillSrc : TOGGLE_IDLE_PILL_SRC}
            bgClassName={view !== "satellite" ? "opacity-70" : undefined}
            textClassName={view === "satellite" ? activeText : idleText}
            onClick={() => setView("satellite")}
            data-testid="button-map-view-satellite"
            aria-pressed={view === "satellite"}
          >
            {t("ticketRouteMap.viewSatellite")}
          </SplitToggleHalf>
        </div>
      </div>
      <div
        className="relative overflow-hidden rounded border-[3px]"
        style={{ height, borderColor: "var(--brand-primary, #f59e0b)" }}
      >
        <MapContainer
          center={center}
          zoom={15}
          zoomControl={false}
          scrollWheelZoom
          style={{ width: "100%", height: "100%" }}
        >
          <BrandZoomControlInMap />
        <TileLayer
          key={view}
          attribution={tileConfig.attribution}
          url={tileConfig.url}
          maxZoom={tileConfig.maxZoom}
        />
        <FitBounds points={allPoints} enabled={selectedPoint == null} />
        <PanTo point={selectedPoint} />
        {pathPoints.length >= 2 && (
          <Polyline positions={pathPoints} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.85 }} />
        )}
        {sortedTracking.map((p, i) => {
          const key =
            p.id != null
              ? `t-${p.id}`
              : p.recordedAt
                ? `t-${new Date(p.recordedAt).getTime()}-${p.latitude}-${p.longitude}`
                : `t-${p.latitude}-${p.longitude}-${i}`;
          const isSelected = p.id != null && p.id === selectedTrackingId;
          const heading = showHeadings ? headings[i] ?? null : null;
          const icon = showHeadings
            ? heading != null
              ? trackingArrowIcon(heading, isSelected, t("ticketRouteMap.heading", { deg: Math.round(heading) }))
              : trackingStationaryIcon(isSelected, t("ticketRouteMap.stationary"))
            : isSelected
              ? trackingDotSelected
              : trackingDot;
          return (
            <Marker
              key={key}
              position={[p.latitude, p.longitude]}
              icon={icon}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={
                onSelectTracking && p.id != null
                  ? { click: () => onSelectTracking(p.id ?? null) }
                  : undefined
              }
            >
              <Popup>
                <div className="text-xs">
                  <div className="font-semibold">{t("ticketRouteMap.trackingPoint", { n: i + 1 })}</div>
                  {p.recordedAt && <div>{new Date(p.recordedAt).toLocaleString()}</div>}
                  <div>
                    {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                  </div>
                  {showHeadings && (
                    <div data-testid={`text-replay-heading-${i}`}>
                      {heading != null
                        ? t("ticketRouteMap.heading", { deg: Math.round(heading) })
                        : t("ticketRouteMap.stationary")}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
        {stops.map((stop, i) => {
          const label = String(i + 1);
          const isSelected =
            stop.endPoint.id != null && stop.endPoint.id === selectedTrackingId;
          const icon = makeStopIcon(label, isSelected);
          const targetId = stop.endPoint.id;
          return (
            <Marker
              key={`stop-${stop.endPoint.id ?? `${stop.startPoint.latitude}-${stop.startPoint.longitude}-${i}`}`}
              position={[stop.startPoint.latitude, stop.startPoint.longitude]}
              icon={icon}
              zIndexOffset={isSelected ? 1500 : 500}
              eventHandlers={
                onSelectTracking && targetId != null
                  ? {
                      click: () => onSelectTracking(targetId),
                      mouseover: () => onSelectTracking(targetId),
                    }
                  : undefined
              }
            >
              <Popup>
                <div className="text-xs">
                  <div className="font-semibold">{t("ticketRouteMap.stop", { n: i + 1 })}</div>
                  {stop.startTime && (
                    <div>{stop.startTime.toLocaleString()}</div>
                  )}
                  <div>{t("ticketRouteMap.duration", { value: formatDwell(stop.durationMs) })}</div>
                  <div>
                    {stop.startPoint.latitude.toFixed(5)},{" "}
                    {stop.startPoint.longitude.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
        {validSite && (
          <Marker position={[validSite.latitude, validSite.longitude]} icon={siteIcon}>
            <Popup>
              <div className="text-xs">
                <div className="font-semibold">{validSite.name || t("ticketRouteMap.siteLocation")}</div>
                <div>
                  {validSite.latitude.toFixed(5)}, {validSite.longitude.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        )}
        {validCheckIn && (
          <Marker position={[validCheckIn.latitude, validCheckIn.longitude]} icon={checkInIcon}>
            <Popup>
              <div className="text-xs">
                <div className="font-semibold">{t("ticketRouteMap.checkIn")}</div>
                {validCheckIn.time && <div>{new Date(validCheckIn.time).toLocaleString()}</div>}
                <div>
                  {validCheckIn.latitude.toFixed(5)}, {validCheckIn.longitude.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        )}
        {validCheckOut && (
          <Marker position={[validCheckOut.latitude, validCheckOut.longitude]} icon={checkOutIcon}>
            <Popup>
              <div className="text-xs">
                <div className="font-semibold">{t("ticketRouteMap.checkOut")}</div>
                {validCheckOut.time && <div>{new Date(validCheckOut.time).toLocaleString()}</div>}
                <div>
                  {validCheckOut.latitude.toFixed(5)}, {validCheckOut.longitude.toFixed(5)}
                </div>
              </div>
            </Popup>
          </Marker>
        )}
        </MapContainer>
      </div>
    </div>
  );
}
