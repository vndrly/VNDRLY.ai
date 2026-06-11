import { useMemo } from "react";
import L from "leaflet";
import { Link } from "wouter";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { BrandZoomControlInMap } from "@/components/brand-zoom-control";
import { GeofenceCirclesLayer, type GeofenceSite } from "@/components/map/geofence-circles-layer";
import { resolveGeofenceRadiusMeters } from "@workspace/map-utils";

type SiteRow = {
  id: number;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  siteCode?: string | null;
  siteRadiusMeters?: number | null;
  status?: string | null;
};

function sitePinIcon() {
  const html = `<div style="position:relative;width:28px;height:36px;transform:translate(-14px,-32px);">
    <div style="position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:12px;font-family:sans-serif;">S</div>
  </div>`;
  return L.divIcon({
    html,
    className: "vndrly-site-overview-pin",
    iconSize: [28, 36],
    iconAnchor: [14, 32],
    popupAnchor: [0, -30],
  });
}

export function SiteLocationsMapTab({ sites }: { sites: SiteRow[] }) {
  const { t } = useTranslation();

  const mapped = useMemo(() => {
    return (sites ?? [])
      .filter(
        (s) =>
          s.latitude != null &&
          s.longitude != null &&
          Number.isFinite(Number(s.latitude)) &&
          Number.isFinite(Number(s.longitude)),
      )
      .map(
        (s): GeofenceSite => ({
          id: s.id,
          name: s.name,
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
          siteRadiusMeters: s.siteRadiusMeters ?? null,
        }),
      );
  }, [sites]);

  const center = useMemo<[number, number]>(() => {
    if (mapped.length === 0) return [39.5, -98.35];
    const lat = mapped.reduce((sum, s) => sum + s.latitude, 0) / mapped.length;
    const lng = mapped.reduce((sum, s) => sum + s.longitude, 0) / mapped.length;
    return [lat, lng];
  }, [mapped]);

  if (mapped.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {t("siteLocations.mapTabEmpty", "No site locations with coordinates yet.")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2" style={{ borderColor: "var(--brand-primary)" }}>
      <CardContent className="p-0">
        <div style={{ height: 560 }}>
          <MapContainer
            center={center}
            zoom={mapped.length === 1 ? 14 : 8}
            zoomControl={false}
            style={{ height: "100%", width: "100%" }}
          >
            <BrandZoomControlInMap />
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
            <GeofenceCirclesLayer sites={mapped} />
            {mapped.map((site) => (
              <Marker
                key={site.id}
                position={[site.latitude, site.longitude]}
                icon={sitePinIcon()}
              >
                <Popup>
                  <div className="text-sm space-y-1 min-w-[180px]">
                    <div className="font-semibold">{site.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("siteLocations.geofenceRadius", "Geofence")}:{" "}
                      {resolveGeofenceRadiusMeters(site.siteRadiusMeters)} m
                    </div>
                    <Link href={`/site-locations/${site.id}`} className="text-xs underline">
                      {t("siteLocations.viewDetails", "View details")}
                    </Link>
                    <Link href={`/site-map?siteId=${site.id}`} className="text-xs underline block">
                      {t("siteLocations.openSiteMap", "Open site map")}
                    </Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}
