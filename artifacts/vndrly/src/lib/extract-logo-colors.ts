/** Client-side brand-color guess from a logo image (canvas sampling). */

export interface ExtractedLogoColors {
  primary: string;
  accent: string;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.replace(/^#/, "").trim();
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d > 180 ? 360 - d : d;
}

function isNeutral(r: number, g: number, b: number, a: number): boolean {
  if (a < 40) return true;
  const [, s, l] = rgbToHsl(r, g, b);
  if (l > 0.94 || l < 0.08) return true;
  if (s < 0.12) return true;
  return false;
}

type ColorBucket = {
  r: number;
  g: number;
  b: number;
  count: number;
  hsl: [number, number, number];
};

function bucketKey(r: number, g: number, b: number): string {
  const step = 24;
  const qr = Math.round(r / step) * step;
  const qg = Math.round(g / step) * step;
  const qb = Math.round(b / step) * step;
  return `${qr},${qg},${qb}`;
}

/**
 * Sample an uploaded logo and return a primary + accent hex guess.
 * Falls back to VNDRLY gold / grey when the image is mostly neutral.
 */
export async function extractLogoColorsFromFile(
  file: File,
): Promise<ExtractedLogoColors> {
  const url = URL.createObjectURL(file);
  try {
    return await extractLogoColorsFromUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractLogoColorsFromUrl(
  url: string,
): Promise<ExtractedLogoColors> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  const maxSide = 128;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height, 1));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { primary: "#e6ac00", accent: "#616161" };
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const buckets = new Map<string, ColorBucket>();
  const stride = 2;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (isNeutral(r, g, b, a)) continue;
      const key = bucketKey(r, g, b);
      const cur = buckets.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        buckets.set(key, {
          r,
          g,
          b,
          count: 1,
          hsl: rgbToHsl(r, g, b),
        });
      }
    }
  }

  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (ranked.length === 0) {
    return { primary: "#e6ac00", accent: "#616161" };
  }

  const primary = ranked[0];
  let accent = ranked.find(
    (c) => hueDistance(c.hsl[0], primary.hsl[0]) > 25 && c.count >= ranked[0].count * 0.15,
  );
  if (!accent) {
    accent =
      ranked.find((c) => c !== primary && Math.abs(c.hsl[2] - primary.hsl[2]) > 0.12) ??
      primary;
  }

  return {
    primary: rgbToHex(primary.r, primary.g, primary.b),
    accent: rgbToHex(accent.r, accent.g, accent.b),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read image for color extraction"));
    img.src = url;
  });
}

/** Normalize user-typed hex to #RRGGBB when valid. */
export function normalizeHexColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return hexToRgb(withHash) ? withHash.toLowerCase() : null;
}
