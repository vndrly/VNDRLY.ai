import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection, Position } from "geojson";
import mapboxgl, { type GeoJSONSource, type LngLatBoundsLike, type Map as MapboxMapInstance } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./mapbox-map.css";
import { Plus, Minus } from "lucide-react";
import { getMapboxStyleUrl, loadMapboxAccessToken, readMapboxAccessToken, type MapboxMapStyle } from "@/lib/maps";
import { applyDarkStreetContrast } from "@/lib/dark-street-contrast";

export type MapboxPoint = {
  id: string;
  latitude: number;
  longitude: number;
  color?: string;
  label?: string;
  fullLabel?: string;
  fullLabelMinZoom?: number;
  imageUrl?: string | null;
  title?: string;
  popupHtml?: string;
  popupOnHover?: boolean;
  popupClassName?: string;
  onClick?: () => void;
  onHover?: () => void;
  onLeave?: () => void;
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
  enhancedStreetContrast?: boolean;
  height?: number | string;
  className?: string;
  fitToData?: boolean;
  fitPoints?: MapboxPoint[];
  selectedPointId?: string | null;
  panToSelectedPoint?: boolean;
  scrollZoom?: boolean;
  onPointDrag?: (id: string, latitude: number, longitude: number) => void;
  onMapClick?: (latitude: number, longitude: number) => void;
  bottomControls?: ReactNode;
  topControls?: ReactNode;
  customZoomControls?: boolean;
  navigationPosition?: "top-right" | "bottom-right";
  anchoredPopup?: { pointId: string; content: ReactNode; onClose: () => void; className?: string; maxWidth?: string };
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
  enhancedStreetContrast = false,
  height = 320,
  className,
  fitToData = true,
  fitPoints,
  selectedPointId,
  panToSelectedPoint = false,
  scrollZoom = true,
  onPointDrag,
  onMapClick,
  bottomControls,
  topControls,
  customZoomControls = true,
  navigationPosition = "top-right",
  anchoredPopup,
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
  const hoverPoints = useRef<Map<string, MapboxPoint>>(new Map());
  const hoverPopup = useRef<mapboxgl.Popup | null>(null);
  const labelPoints = useRef<MapboxPoint[]>([]);
  labelPoints.current = points;
  const updateMarkerLabels = useRef(() => {});
  updateMarkerLabels.current = () => {
    const map = mapRef.current;
    if (!map || !labelPoints.current.some(point=>point.fullLabel)) return;
    const container = map.getContainer();
    const occupied: Array<{x:number;y:number;width:number;height:number}> = [];
    for(const point of labelPoints.current) {
      const rect=markerRefs.current.get(point.id)?.getElement().getBoundingClientRect();
      if(rect?.width&&rect.height){const pixel=map.project([point.longitude,point.latitude]);occupied.push({x:pixel.x-rect.width/2,y:pixel.y-rect.height/2,width:rect.width,height:rect.height});}
    }
    for (const point of labelPoints.current) {
      const element = markerRefs.current.get(point.id)?.getElement();
      if (!element) continue;
      const visible = Boolean(point.fullLabel) && map.getZoom() >= (point.fullLabelMinZoom ?? 10);
      const marker = element.getBoundingClientRect();
      const pixel=map.project([point.longitude,point.latitude]);
      const origin={x:pixel.x-marker.width/2,y:pixel.y-marker.height/2};
      const inView=origin.x+marker.width>=0&&origin.x<=container.clientWidth&&origin.y+marker.height>=0&&origin.y<=container.clientHeight;
      element.classList.toggle("has-visible-label", visible&&inView);
      const caption = element.querySelector<HTMLElement>(".vndrly-mapbox-marker-caption");
      if (!visible || !inView || !caption) continue;
      caption.style.maxWidth = `${Math.max(100,Math.min(280,container.clientWidth-16))}px`;
      const width=caption.offsetWidth, height=caption.offsetHeight;
      if (!width || !height) continue;
      const topLimit=bottomControls?50:8;
      const clampX=(x:number)=>Math.max(8,Math.min(container.clientWidth-width-8,x));
      const clampY=(y:number)=>Math.max(topLimit,Math.min(container.clientHeight-height-8,y));
      let best={x:clampX(origin.x+marker.width+7),y:clampY(origin.y)},bestScore=Infinity;
      for(let step=0;step<12;step++)for(const side of [1,-1]) {
        const x=clampX(side===1?origin.x+marker.width+7:origin.x-width-7);
        for(const direction of step===0?[0]:[-1,1]) {
          const y=clampY(origin.y+direction*step*(height+5));
          const overlap=occupied.reduce((total,other)=>total+Math.max(0,Math.min(x+width+4,other.x+other.width+4)-Math.max(x-4,other.x-4))*Math.max(0,Math.min(y+height+3,other.y+other.height+3)-Math.max(y-3,other.y-3)),0);
          const score=overlap*1000+Math.abs(y-origin.y)+Math.abs(x-(origin.x+marker.width+7))*.1;
          if(score<bestScore){best={x,y};bestScore=score;}
        }
      }
      caption.style.left=`${best.x-origin.x}px`;caption.style.top=`${best.y-origin.y}px`;
      const leader=element.querySelector<SVGLineElement>(".vndrly-mapbox-marker-label-leader line");
      if(leader){leader.setAttribute("x1",String(marker.width/2));leader.setAttribute("y1",String(marker.height/2));leader.setAttribute("x2",String(Math.max(best.x,Math.min(best.x+width,pixel.x))-origin.x));leader.setAttribute("y2",String(Math.max(best.y,Math.min(best.y+height,pixel.y))-origin.y));}
      occupied.push({...best,width,height});
    }
  };
  const [popupNode] = useState(() => document.createElement("div"));
  const popupClose = useRef(anchoredPopup?.onClose);
  popupClose.current = anchoredPopup?.onClose;
  const mapClick = useRef(onMapClick);
  mapClick.current = onMapClick;
  const hasBottomControls = Boolean(bottomControls);
  const popupPoint = points.find(point => point.id === anchoredPopup?.pointId);
  const popupLongitude = popupPoint?.longitude, popupLatitude = popupPoint?.latitude;

  const initialCenter = useMemo<[number, number]>(() => {
    if (center) return center;
    const first = points.find((p) => isValidLatLng(p.latitude, p.longitude));
    return first ? [first.longitude, first.latitude] : [-98.35, 39.5];
  }, [center, points]);
  const initialCenterRef = useRef(initialCenter);
  initialCenterRef.current = initialCenter;
  const initialZoomRef = useRef(zoom);
  initialZoomRef.current = zoom;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: getMapboxStyleUrl(styleKind),
      center: initialCenterRef.current,
      zoom: initialZoomRef.current,
      attributionControl: true,
    });
    if (!scrollZoom) map.scrollZoom.disable();
    map.on("click", event => {
      if ((event.originalEvent.target as Element | null)?.closest(".vndrly-mapbox-marker,.mapboxgl-popup")) return;
      mapClick.current?.(event.lngLat.lat, event.lngLat.lng);
    });
    if (!customZoomControls) map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), navigationPosition);
    map.on("load", () => {
      if (styleKind === "dark" || (styleKind === "street" && enhancedStreetContrast)) applyDarkStreetContrast(map, styleKind === "dark");
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
    const updateLabels = () => updateMarkerLabels.current();
    map.on("zoom", updateLabels);
    map.on("moveend", updateLabels);
    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current.clear();
      hoverPopup.current?.remove();
      hoverPopup.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [scrollZoom, styleKind, token, navigationPosition, customZoomControls, enhancedStreetContrast]);

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
    hoverPopup.current?.remove();
    hoverPopup.current = null;
    hoverPoints.current = new Map(points.filter(point => point.onHover || point.onLeave || (point.popupOnHover && point.popupHtml)).map(point => [point.id, point]));
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
        const showDetails = (event: Event) => {
          const current = hoverPoints.current.get(point.id);
          if (event.type === "focus" || map.getContainer().clientWidth >= 560) current?.onHover?.();
          if (!current?.popupHtml) return;
          hoverPopup.current?.remove();
          hoverPopup.current = new mapboxgl.Popup({ offset: 18, closeButton: false, className: current.popupClassName })
            .setLngLat([current.longitude, current.latitude]).setHTML(current.popupHtml).addTo(map);
        };
        const hideDetails = () => { hoverPoints.current.get(point.id)?.onLeave?.(); hoverPopup.current?.remove(); hoverPopup.current = null; };
        el.addEventListener("mouseenter", showDetails);
        el.addEventListener("mouseleave", hideDetails);
        el.addEventListener("focus", showDetails);
        el.addEventListener("blur", hideDetails);
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
      if (point.fullLabel) {
        const leader=document.createElementNS("http://www.w3.org/2000/svg","svg");
        leader.classList.add("vndrly-mapbox-marker-label-leader");leader.setAttribute("aria-hidden","true");
        leader.appendChild(document.createElementNS("http://www.w3.org/2000/svg","line"));
        el.appendChild(leader);
        const caption = document.createElement("div");
        caption.className = "vndrly-mapbox-marker-caption";
        caption.textContent = point.fullLabel;
        caption.setAttribute("aria-hidden", "true");
        el.appendChild(caption);
      }
      if (point.flashing) {
        const ring = document.createElement("span");
        ring.className = "vndrly-mapbox-marker-flash";
        el.appendChild(ring);
      }
      el.setAttribute("aria-label", point.title ?? point.label ?? "Map marker");
      if (point.popupHtml) {
        marker.setPopup(new mapboxgl.Popup({ offset: 18, className: point.popupClassName }).setHTML(point.popupHtml));
      }
    }
    updateMarkerLabels.current();
  }, [onPointDrag, points, selectedPointId, token, initialCenter, scrollZoom, styleKind, zoom]);

  useEffect(() => {
    if (!panToSelectedPoint || !selectedPointId) return;
    const point = points.find(item => item.id === selectedPointId);
    if (point && isValidLatLng(point.latitude, point.longitude)) {
      const map = mapRef.current, frame = map?.getContainer();
      const offset = anchoredPopup?.pointId === selectedPointId && frame && frame.clientWidth < 560
          ? { offset: [0, frame.clientHeight / 2 - 22] as [number, number] } : {};
      map?.easeTo({ center: [point.longitude, point.latitude], zoom, ...offset });
    }
  }, [panToSelectedPoint, selectedPointId, points, zoom, token, anchoredPopup?.pointId]);

  useEffect(() => {
    if (!panToSelectedPoint || !selectedPointId) mapRef.current?.easeTo({ zoom });
  }, [zoom, panToSelectedPoint, selectedPointId, token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitToData) return;
    const bounds = new mapboxgl.LngLatBounds();
    let count = 0;
    for (const point of fitPoints ?? points) {
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
    else map.fitBounds(bounds as LngLatBoundsLike, { padding: {top:36,left:36,right:36,bottom:hasBottomControls?86:36}, maxZoom: 17 });
  }, [fitToData, fitPoints, lines, points, zoom, token, initialCenter, scrollZoom, styleKind, hasBottomControls]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !anchoredPopup?.pointId || !isValidLatLng(popupLatitude, popupLongitude)) return;
    const close = () => popupClose.current?.();
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !popupNode.contains(target) && !target.closest(".vndrly-mapbox-marker")) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const frame = map.getContainer(), position = map.project([popupLongitude!, popupLatitude]);
    const narrow = frame.clientWidth < 560;
    const side = position.x < frame.clientWidth / 2 ? "left" : "right";
    const vertical = position.y < 150 ? "top" : position.y > frame.clientHeight - 150 ? "bottom" : "";
    const anchor = narrow ? "bottom" : (vertical ? `${vertical}-${side}` : side) as "top-left" | "top-right" | "bottom-left" | "bottom-right" | "left" | "right";
    if (narrow) map.easeTo({ center: [popupLongitude!, popupLatitude], offset: [0, frame.clientHeight / 2 - 22] });
    const popup = new mapboxgl.Popup({ anchor, offset: 22, maxWidth: anchoredPopup.maxWidth ?? "280px", className: anchoredPopup.className, closeOnClick: false, focusAfterOpen: false })
      .setLngLat([popupLongitude!, popupLatitude]).setDOMContent(popupNode).addTo(map);
    popup.on("close", close);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => popup.setLngLat([popupLongitude!, popupLatitude]));
    resize?.observe(popupNode);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { resize?.disconnect(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); popup.off("close", close); popup.remove(); };
  }, [anchoredPopup?.pointId, anchoredPopup?.className, anchoredPopup?.maxWidth, popupLatitude, popupLongitude, popupNode, token, styleKind, scrollZoom]);

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
      {topControls && <div className="vndrly-map-top-controls">{topControls}</div>}
      {customZoomControls && <div className="vndrly-map-zoom" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={()=>mapRef.current?.zoomIn()}><Plus aria-hidden="true" /></button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={()=>mapRef.current?.zoomOut()}><Minus aria-hidden="true" /></button>
      </div>}
      {bottomControls && <div className="vndrly-map-bottom-controls">{bottomControls}</div>}
      {anchoredPopup && createPortal(anchoredPopup.content, popupNode)}
    </div>
  );
}
