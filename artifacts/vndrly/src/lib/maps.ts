export const MAP_TILE_SIZE = 256;
export const MAP_TILE_ZOOM = 15;
export type MapboxMapStyle = "satellite" | "street";

export type TileCoords = {
  url: string;
  offsetX: number;
  offsetY: number;
};

const MAPBOX_STYLES: Record<MapboxMapStyle, string> = {
  satellite: "satellite-streets-v12",
  street: "streets-v12",
};

export const MAPBOX_ATTRIBUTION =
  '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let runtimeMapboxToken = "";

export async function loadMapboxAccessToken(): Promise<string> {
  const configured = readMapboxAccessToken();
  if (configured) return configured;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const response = await fetch(`${base}/api/public-config`, { credentials: "include" });
  if (!response.ok) throw new Error("Map configuration unavailable");
  const config: { mapboxAccessToken?: unknown } = await response.json();
  if (typeof config.mapboxAccessToken === "string" && config.mapboxAccessToken.startsWith("pk.")) {
    runtimeMapboxToken = config.mapboxAccessToken;
  }
  return runtimeMapboxToken;
}

export function readMapboxAccessToken(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return [
    env.VITE_MAPBOX_ACCESS_TOKEN,
    env.VITE_MAPBOX_API_KEY,
    runtimeMapboxToken,
  ].map((value) => value?.trim()).find((value) => value?.startsWith("pk.")) ?? "";
}

export function getMapboxStyleUrl(style: MapboxMapStyle = "satellite"): string {
  return `mapbox://styles/mapbox/${MAPBOX_STYLES[style]}`;
}

function tilePosition(latitude: number, longitude: number, zoom: number) {
  const MAX_LAT = 85.05112878;
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, latitude));
  const normalizedLng = ((((longitude + 180) % 360) + 360) % 360) - 180;
  const latRad = (clampedLat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const xFloat = ((normalizedLng + 180) / 360) * n;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const xTile = Math.floor(xFloat);
  const yTile = Math.floor(yFloat);
  const offsetX = (xFloat - xTile) * MAP_TILE_SIZE;
  const offsetY = (yFloat - yTile) * MAP_TILE_SIZE;
  return { xTile, yTile, offsetX, offsetY };
}

export function getMapboxStyleTileUrl(style: MapboxMapStyle = "satellite"): string {
  const token = readMapboxAccessToken();
  return `https://api.mapbox.com/styles/v1/mapbox/${MAPBOX_STYLES[style]}/tiles/256/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`;
}

export function getMapboxStaticTile(
  latitude: number,
  longitude: number,
  zoom: number = MAP_TILE_ZOOM,
  style: MapboxMapStyle = "satellite",
): TileCoords {
  const { xTile, yTile, offsetX, offsetY } = tilePosition(latitude, longitude, zoom);
  return {
    url: getMapboxStyleTileUrl(style)
      .replace("{z}", String(zoom))
      .replace("{x}", String(xTile))
      .replace("{y}", String(yTile)),
    offsetX,
    offsetY,
  };
}

export function getOsmTile(
  latitude: number,
  longitude: number,
  zoom: number = MAP_TILE_ZOOM,
): TileCoords {
  if (readMapboxAccessToken()) return getMapboxStaticTile(latitude, longitude, zoom);
  const { xTile, yTile, offsetX, offsetY } = tilePosition(latitude, longitude, zoom);
  return {
    url: `https://tile.openstreetmap.org/${zoom}/${xTile}/${yTile}.png`,
    offsetX,
    offsetY,
  };
}

export function getGoogleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
