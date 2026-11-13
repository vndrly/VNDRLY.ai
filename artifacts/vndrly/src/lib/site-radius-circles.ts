import type { MapboxCircle } from "@/components/mapbox-map";
export type RadiusSite = { id: number; latitude: number | null; longitude: number | null; siteRadiusMeters: number | null; isActive?: boolean | null };
export function siteRadiusCircles(sites: RadiusSite[]): MapboxCircle[] {
  return [...new Map(sites.map(site => [site.id, site])).values()].flatMap(site =>
    site.isActive !== false && typeof site.latitude === "number" && Number.isFinite(site.latitude) && Math.abs(site.latitude) <= 90 &&
    typeof site.longitude === "number" && Number.isFinite(site.longitude) && Math.abs(site.longitude) <= 180 &&
    typeof site.siteRadiusMeters === "number" && Number.isFinite(site.siteRadiusMeters) && site.siteRadiusMeters > 0
      ? [{ id: `site-radius:${site.id}`, latitude: site.latitude, longitude: site.longitude, radiusMeters: site.siteRadiusMeters, color: "#38bdf8", opacity: 0.12 }] : []);
}
