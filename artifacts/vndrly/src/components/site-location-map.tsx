import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap } from "react-leaflet";
import { BrandZoomControlInMap } from "@/components/brand-zoom-control";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

export type SiteLocationMapProps = {
  lat: number;
  lng: number;
  radiusMeters?: number | null;
  onMove?: (lat: number, lng: number) => void;
  /** Fixed pixel/CSS height. Ignored when `aspectRatio` is provided. */
  height?: number | string;
  /**
   * CSS aspect-ratio for the map container (e.g. `"4 / 3"`). When set,
   * the map fills 100% of its parent's width and computes its own
   * height from the aspect ratio, so the embed always renders as the
   * requested rectangle.
   */
  aspectRatio?: string;
  draggable?: boolean;
  /**
   * Base tile layer.
   *  - "satellite": Esri World Imagery (default — high-resolution
   *    aerial photography, free with attribution, no API key).
   *  - "street": OpenStreetMap Standard tiles.
   */
  tileLayer?: "satellite" | "street";
  className?: string;
};

export function SiteLocationMap({
  lat,
  lng,
  radiusMeters,
  onMove,
  height = 240,
  aspectRatio,
  draggable = true,
  tileLayer = "satellite",
  className,
}: SiteLocationMapProps) {
  const center = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);
  const markerRef = useRef<L.Marker | null>(null);

  const containerStyle: React.CSSProperties = aspectRatio
    ? { aspectRatio, width: "100%" }
    : { height: typeof height === "number" ? `${height}px` : height };

  return (
    <div
      className={`overflow-hidden rounded-md border ${className ?? ""}`.trim()}
      style={containerStyle}
      data-testid="site-location-map"
    >
      <MapContainer
        center={center}
        zoom={15}
        zoomControl={false}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <BrandZoomControlInMap />
        {tileLayer === "satellite" ? (
          <TileLayer
            attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        )}
        <Recenter lat={lat} lng={lng} />
        <Marker
          position={center}
          icon={markerIcon}
          draggable={draggable && !!onMove}
          ref={(ref) => {
            markerRef.current = ref;
          }}
          eventHandlers={{
            dragend: () => {
              const m = markerRef.current;
              if (!m || !onMove) return;
              const p = m.getLatLng();
              onMove(p.lat, p.lng);
            },
          }}
        />
        {typeof radiusMeters === "number" && radiusMeters > 0 ? (
          <Circle
            center={center}
            radius={radiusMeters}
            pathOptions={{ color: "var(--brand-primary, #DC2626)", weight: 2, fillOpacity: 0.08 }}
          />
        ) : null}
      </MapContainer>
    </div>
  );
}
