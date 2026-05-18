export type GeocodeResult = {
  latitude: number;
  longitude: number;
  displayName: string;
};

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

let lastCallAt = 0;
const MIN_GAP_MS = 1100;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastCallAt + MIN_GAP_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export async function forwardGeocode(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;
  await rateLimit();
  const url = `${NOMINATIM_BASE}/search?format=json&limit=1&addressdetails=0&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const top = data[0];
    const lat = Number(top.lat);
    const lng = Number(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { latitude: lat, longitude: lng, displayName: top.display_name };
  } catch {
    return null;
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  await rateLimit();
  const url = `${NOMINATIM_BASE}/reverse?format=json&lat=${lat}&lon=${lng}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: string; lon?: string; display_name?: string };
    if (!data || !data.display_name) return null;
    return {
      latitude: Number(data.lat ?? lat),
      longitude: Number(data.lon ?? lng),
      displayName: data.display_name,
    };
  } catch {
    return null;
  }
}
