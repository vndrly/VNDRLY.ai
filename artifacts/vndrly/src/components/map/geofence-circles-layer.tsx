import { Circle } from "react-leaflet";

export type GeofenceSite = {
  id: number;
  name?: string | null;
  latitude: number;
  longitude: number;
  siteRadiusMeters?: number | null;
};

type Props = {
  sites: GeofenceSite[];
  /** When set, only draw this site's ring (highlight mode). */
  highlightSiteId?: number | null;
  defaultRadiusMeters?: number;
};

export function GeofenceCirclesLayer({
  sites,
  highlightSiteId = null,
  defaultRadiusMeters = 402.336,
}: Props) {
  return (
    <>
      {sites.map((site) => {
        const radius =
          site.siteRadiusMeters != null && site.siteRadiusMeters > 0
            ? site.siteRadiusMeters
            : defaultRadiusMeters;
        const highlighted =
          highlightSiteId == null || highlightSiteId === site.id;
        return (
          <Circle
            key={`geofence-${site.id}`}
            center={[site.latitude, site.longitude]}
            radius={radius}
            pathOptions={{
              color: highlighted ? "#2563eb" : "#94a3b8",
              weight: highlighted ? 2 : 1,
              opacity: highlighted ? 0.65 : 0.35,
              fillColor: highlighted ? "#2563eb" : "#94a3b8",
              fillOpacity: highlighted ? 0.08 : 0.04,
            }}
          />
        );
      })}
    </>
  );
}
