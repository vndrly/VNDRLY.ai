import { Linking, Platform } from "react-native";

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

export async function openInMaps(
  latitude: number,
  longitude: number,
  label?: string,
): Promise<void> {
  const lat = latitude.toString();
  const lng = longitude.toString();
  const encodedLabel = label ? encodeURIComponent(label) : "";
  const urls: string[] = [];
  if (Platform.OS === "ios") {
    const q = encodedLabel ? `&q=${encodedLabel}` : "";
    urls.push(`http://maps.apple.com/?ll=${lat},${lng}${q}`);
  } else if (Platform.OS === "android") {
    const q = encodedLabel ? `(${encodedLabel})` : "";
    urls.push(`geo:${lat},${lng}?q=${lat},${lng}${q}`);
  }
  urls.push(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
  for (const url of urls) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // try next
    }
  }
  try {
    await Linking.openURL(urls[urls.length - 1]);
  } catch {
    // give up silently
  }
}
