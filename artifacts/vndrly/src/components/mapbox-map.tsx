import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection, Position } from "geojson";
import mapboxgl, { type GeoJSONSource, type LngLatBoundsLike, type Map as MapboxMapInstance } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./mapbox-map.css";
import { getMapboxStyleUrl, loadMapboxAccessToken, readMapboxAccessToken, type MapboxMapStyle } from "@/lib/maps";

export type MapboxPoint = {
  id: string;
  latitude: number;
  longitude: number;
  color?: string;
  label?: string;
  imageUrl?: string | null;
  title?: string;
  popupHtml?: string;
  onClick?: () => void;
  flashing?: boolean;
};

export type MapboxLine = {
  id: string;
  coordinates: Array<[number, number]>;
  color?: string;
  width?: number;
  opacity?: number;
  dashArray?: number[];
};

export type MapboxCircle = {
  id: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  color?: string;
  opacity?: number;
};

type Props = {
  points?: MapboxPoint[];
  lines?: MapboxLine[];
  circles?: MapboxCircle[];
  center?: [number, number];
  zoom?: number;
  styleKind?: MapboxMapStyle;
  height?: number | string;
  className?: string;
  fitToData?: boolean;
  selectedPointId?: string | null;
  scrollZoom?: boolean;
  onPointDrag?: (id: string, latitude: number, longitude: number) => void;
};

const EMPTY_COLLECTION: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function isValidLatLng(latitude: unknown, longitude: unknown): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function mapboxMarkerContent(point: Pick<MapboxPoint, "label" | "imageUrl" | "title">): string {
  if (point.imageUrl) {
    return `<img class="vndrly-mapbox-marker-logo" src="${escapeHtml(point.imageUrl)}" alt="" />`;
  }
  return `<span>${escapeHtml(point.label ?? "")}</span>`;
}

function circlePolygon(latitude: number, longitude: number, radiusMeters: number): Position[] {
  const points: Position[] = [];
  const earthRadius = 6371008.8;
  const latRad = (latitude * Math.PI) / 180;
  const lngRad = (longitude * Math.PI) / 180;
  const angularDistance = radiusMeters / earthRadius;
  for (let i = 0; i <= 64; i++) {
    const bearing = (i / 64) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const lng2 =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(lat2),
      );
    points.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return points;
}

function setSourceData(map: MapboxMapInstance, id: string, data: FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData(data);
}

export function MapboxMap({
  points = [],
  lines = [],
  circles = [],
  center,
  zoom = 14,
  styleKind = "satellite",
  height = 320,
  className,
  fitToData = true,
  selectedPointId,
  scrollZoom = true,
  onPointDrag,
}: Props) {
  const configuration = useQuery({
    queryKey: ["public-map-configuration"],
    queryFn: loadMapboxAccessToken,
    staleTime: 60_000,
    retry: 1,
  });
  const token = configuration.data || readMapboxAccessToken();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMapInstance | null>(null);
  const markerRefs = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const clickHandlers = useRef<Map<string, () => void>>(new Map());

  const initialCenter = useMemo<[number, number]>(() => {
    if (center) return center;
    const first = points.find((p) => isValidLatLng(p.latitude, p.longitude));
    return first ? [first.longitude, first.latitude] : [-98.35, 39.5];
  }, [center, points]);
  const initialCenterRef = useRef(initialCenter);
  initialCenterRef.current = initialCenter;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: getMapboxStyleUrl(styleKind),
      center: initialCenterRef.current,
      zoom,
      attributionControl: true,
    });
    if (!scrollZoom) map.scrollZoom.disable();
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("vndrly-lines", { type: "geojson", data: EMPTY_COLLECTION });
      map.addLayer({
        id: "vndrly-lines",
        type: "line",
        source: "vndrly-lines",
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#2563eb"],
          "line-width": ["coalesce", ["get", "width"], 4],
          "line-opacity": ["coalesce", ["get", "opacity"], 0.85],
        },
      });
      map.addSource("vndrly-circles", { type: "geojson", data: EMPTY_COLLECTION });
      map.addLayer({
        id: "vndrly-circles-fill",
        type: "fill",
        source: "vndrly-circles",
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#2563eb"],
          "fill-opacity": ["coalesce", ["get", "opacity"], 0.08],
        },
      });
      map.addLayer({
        id: "vndrly-circles-outline",
        type: "line",
        source: "vndrly-circles",
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#2563eb"],
          "line-width": 2,
          "line-opacity": 0.8,
        },
      });
    });
    mapRef.current = map;
    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [scrollZoom, styleKind, token, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const syncLayers = () => {
      setSourceData(map, "vndrly-lines", {
        type: "FeatureCollection",
        features: lines
          .filter((line) => line.coordinates.length >= 2)
          .map((line) => ({
            type: "Feature",
            properties: {
              color: line.color ?? "#2563eb",
              width: line.width ?? 4,
              opacity: line.opacity ?? 0.85,
            },
            geometry: {
              type: "LineString",
              coordinates: line.coordinates.map(([lat, lng]) => [lng, lat]),
            },
          })),
      });
      setSourceData(map, "vndrly-circles", {
        type: "FeatureCollection",
        features: circles
          .filter((c) => c.radiusMeters > 0 && isValidLatLng(c.latitude, c.longitude))
          .map((circle) => ({
            type: "Feature",
            properties: { color: circle.color ?? "#2563eb", opacity: circle.opacity ?? 0.08 },
            geometry: {
              type: "Polygon",
              coordinates: [circlePolygon(circle.latitude, circle.longitude, circle.radiusMeters)],
            },
          })),
      });
    };
    if (map.isStyleLoaded()) syncLayers();
    else map.once("load", syncLayers);
  }, [circles, lines, styleKind, token, initialCenter, scrollZoom, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const liveIds = new Set(points.map((p) => p.id));
    for (const [id, marker] of markerRefs.current) {
      if (!liveIds.has(id)) {
        marker.remove();
        markerRefs.current.delete(id);
      }
    }
    clickHandlers.current.clear();
    for (const point of points) {
      if (!isValidLatLng(point.latitude, point.longitude)) continue;
      clickHandlers.current.set(point.id, point.onClick ?? (() => {}));
      let marker = markerRefs.current.get(point.id);
      if (!marker) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "vndrly-mapbox-marker";
        el.dataset.markerId = point.id;
        el.addEventListener("click", () => clickHandlers.current.get(point.id)?.());
        marker = new mapboxgl.Marker({ element: el, draggable: !!onPointDrag })
          .setLngLat([point.longitude, point.latitude])
          .addTo(map);
        if (onPointDrag) {
          marker.on("dragend", () => {
            const lngLat = marker?.getLngLat();
            if (lngLat) onPointDrag(point.id, lngLat.lat, lngLat.lng);
          });
        }
        markerRefs.current.set(point.id, marker);
      } else {
        marker.setLngLat([point.longitude, point.latitude]);
      }
      const el = marker.getElement();
      el.style.setProperty("--pin-color", point.color ?? "#2563eb");
      el.classList.toggle("is-selected", point.id === selectedPointId);
      el.dataset.flashing = point.flashing ? "1" : "0";
      el.innerHTML = mapboxMarkerContent(point);
      if (point.flashing) {
        const ring = document.createElement("span");
        ring.className = "vndrly-mapbox-marker-flash";
        el.appendChild(ring);
      }
      el.setAttribute("aria-label", point.title ?? point.label ?? "Map marker");
      if (point.popupHtml) {
        marker.setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(point.popupHtml));
      }
    }
  }, [onPointDrag, points, selectedPointId, token, initialCenter, scrollZoom, styleKind, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitToData) return;
    const bounds = new mapboxgl.LngLatBounds();
    let count = 0;
    for (const point of points) {
      if (!isValidLatLng(point.latitude, point.longitude)) continue;
      bounds.extend([point.longitude, point.latitude]);
      count += 1;
    }
    for (const line of lines) {
      for (const [lat, lng] of line.coordinates) {
        if (!isValidLatLng(lat, lng)) continue;
        bounds.extend([lng, lat]);
        count += 1;
      }
    }
    if (count === 0) return;
    if (count === 1) map.easeTo({ center: bounds.getCenter(), zoom });
    else map.fitBounds(bounds as LngLatBoundsLike, { padding: 36, maxZoom: 17 });
  }, [fitToData, lines, points, zoom, token, initialCenter, scrollZoom, styleKind]);

  const containerStyle: React.CSSProperties = {
    height: typeof height === "number" ? `${height}px` : height,
  };

  if (!token) {
    return (
      <div className={`flex items-center justify-center bg-muted text-sm text-muted-foreground ${className ?? ""}`} style={containerStyle}>
        {configuration.isPending ? "Loading map..." : configuration.isError ? "Map configuration unavailable." : "Mapbox is not configured."}
      </div>
    );
  }

  return (
    <div className={`vndrly-mapbox relative overflow-hidden ${className ?? ""}`.trim()} style={containerStyle}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
