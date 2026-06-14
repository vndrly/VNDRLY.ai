import type { TextStyle } from "react-native";

/** Site-wide pill doctrine — iOS mobile pills render at 30px tall. */
export const PILL_HEIGHT_PX = 30;

export const PILL_TEXT = {
  fontFamily: "Inter_400Regular",
  fontSize: 12,
} as const;

/** Shared layout for CSS status/tag chips (non-PNG pills). */
export const PILL_CHIP_LAYOUT = {
  height: PILL_HEIGHT_PX,
  minHeight: PILL_HEIGHT_PX,
  paddingHorizontal: 12,
  paddingVertical: 0,
  borderRadius: 999,
  justifyContent: "center" as const,
  alignItems: "center" as const,
};

/**
 * Text depth tokens — mirrors web `pill-doctrine.ts` / `--drop-shadow-hover`.
 * RN `textShadow*` approximates CSS `text-shadow` / Tailwind `drop-shadow`.
 */
export const TEXT_SHADOW = {
  /** White / on-color pill labels — web `PILL_LABEL_ON_COLOR_CLASS`. */
  onColor: {
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 3,
  },
  /** Deep white on saturated PNG — web `NAV_SQUARE_LABEL_ON_COLOR_CLASS`. */
  deep: {
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  /** Gray body / idle pill on light chrome — web `PILL_LABEL_ON_LIGHT_CLASS`. */
  onLight: {
    textShadowColor: "rgba(0,0,0,0.22)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1.5,
  },
  /** Page titles & content links — web `--drop-shadow-hover`. */
  content: {
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
} as const satisfies Record<string, Pick<TextStyle, "textShadowColor" | "textShadowOffset" | "textShadowRadius">>;

/** Screen headings (tab roots, map titles, InPageHeader). */
export const SCREEN_TITLE_TEXT: TextStyle = TEXT_SHADOW.content;

/** Secondary lines under headings. */
export const SCREEN_SUBTITLE_TEXT: TextStyle = TEXT_SHADOW.onLight;
