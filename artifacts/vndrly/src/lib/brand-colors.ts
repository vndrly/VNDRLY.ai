export const DEFAULT_BRAND_PRIMARY = "#e6ac00";

export type BrandColors = {
  primary: string;
  accent: string;
};

export type PartnerLike =
  | {
      brandPrimaryColor?: string | null;
      brandAccentColor?: string | null;
    }
  | null
  | undefined;

export function getBrandColors(partner: PartnerLike | unknown): BrandColors {
  const p = (partner ?? null) as { brandPrimaryColor?: string | null; brandAccentColor?: string | null } | null;
  const primary = p?.brandPrimaryColor || DEFAULT_BRAND_PRIMARY;
  const accent = p?.brandAccentColor || primary;
  return { primary, accent };
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
