export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{3}|[a-f\d]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

export function contrastRatio(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function getContrastWarning(color: string): string | null {
  const rgb = hexToRgb(color);
  if (!rgb) return null;
  const ratio = contrastRatio(rgb, { r: 255, g: 255, b: 255 });
  if (ratio < 3) return `This color is hard to read on a white background (contrast ${ratio.toFixed(2)}:1, recommended at least 3:1). It may be invisible on printed posters.`;
  if (ratio < 4.5) return `This color has low contrast on white (${ratio.toFixed(2)}:1). Small text may be hard to read.`;
  return null;
}

export function getColorPairWarning(a: string, b: string): string | null {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const ratio = contrastRatio(ra, rb);
  if (ratio < 1.5) return `Primary and accent colors look very similar (contrast ${ratio.toFixed(2)}:1). Consider picking more distinct colors.`;
  return null;
}

export type ContrastWarningKind =
  | { kind: "veryLowContrast"; ratio: string }
  | { kind: "lowContrast"; ratio: string };

export function getContrastWarningKind(color: string): ContrastWarningKind | null {
  const rgb = hexToRgb(color);
  if (!rgb) return null;
  const ratio = contrastRatio(rgb, { r: 255, g: 255, b: 255 });
  if (ratio < 3) return { kind: "veryLowContrast", ratio: ratio.toFixed(2) };
  if (ratio < 4.5) return { kind: "lowContrast", ratio: ratio.toFixed(2) };
  return null;
}

export type ColorPairWarningKind = { kind: "similar"; ratio: string };

export function getColorPairWarningKind(a: string, b: string): ColorPairWarningKind | null {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const ratio = contrastRatio(ra, rb);
  if (ratio < 1.5) return { kind: "similar", ratio: ratio.toFixed(2) };
  return null;
}

// Sidebar background reference color. Source of truth is the `--sidebar`
// CSS variable in `index.css`, currently `hsl(220 10% 25%)` which converts
// to roughly RGB(57, 62, 70). When that token changes, update this constant
// so the contrast warnings stay in sync. We hardcode the RGB because the
// helpers run in pure logic without DOM/computed-style access (e.g. in unit
// tests), and the sidebar token is intentionally fixed across the brand
// override (only `--brand-primary`/`--brand-accent` swap with the partner).
export const SIDEBAR_BG_RGB = { r: 57, g: 62, b: 70 } as const;

export type SidebarContrastWarningKind =
  | { kind: "veryLowContrastOnSidebar"; ratio: string }
  | { kind: "lowContrastOnSidebar"; ratio: string };

// Warns when a brand color won't read well against the dark sidebar/header
// chrome — e.g. the active nav button fill, the brand-colored vertical
// separator, or any brand-tinted icon that sits on the sidebar background.
// Uses the WCAG 3:1 threshold for non-text UI components, plus a 4.5:1 soft
// threshold to flag merely "low" contrast that may still hurt small icons.
export function getSidebarContrastWarningKind(color: string): SidebarContrastWarningKind | null {
  const rgb = hexToRgb(color);
  if (!rgb) return null;
  const ratio = contrastRatio(rgb, SIDEBAR_BG_RGB);
  if (ratio < 3) return { kind: "veryLowContrastOnSidebar", ratio: ratio.toFixed(2) };
  if (ratio < 4.5) return { kind: "lowContrastOnSidebar", ratio: ratio.toFixed(2) };
  return null;
}
