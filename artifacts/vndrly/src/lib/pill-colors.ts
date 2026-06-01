/** Semantic status/action pill colors (canonical PNG palette). */
export const PILL_COLORS = {
  brand: "var(--brand-primary)",
  blue: "#3260CD",
  green: "#15803D",
  red: "#DC2626",
  amber: "#F59E0B",
} as const;

export type PillColorKey = keyof typeof PILL_COLORS;
