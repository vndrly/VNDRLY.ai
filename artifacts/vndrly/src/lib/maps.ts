export const MAP_TILE_SIZE = 256;
export const MAP_TILE_ZOOM = 15;

export type TileCoords = {
  url: string;
  offsetX: number;
  offsetY: number;
};

export function getOsmTile(
  latitude: number,
  longitude: number,
  zoom: number = MAP_TILE_ZOOM,
): TileCoords {
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
  return {
    url: `https://tile.openstreetmap.org/${zoom}/${xTile}/${yTile}.png`,
    offsetX,
    offsetY,
  };
}

export function getGoogleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
