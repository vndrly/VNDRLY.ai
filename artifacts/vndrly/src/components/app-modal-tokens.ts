import type { CSSProperties } from "react";

import dialogAccent from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";
import dialogAccentDark from "@assets/VNDRLY_Header_Blur_Dark_1778850026167.png";

/** Shared modal chrome — approved light + dark snapshots (2026-06). */
export const APP_MODAL_HEADER_HEIGHT_PX = 70;

const ACCENT_MASK =
  "linear-gradient(to bottom, black 0%, transparent 100%)" as const;

export type AppModalTheme = {
  shellChromeClassName: string;
  shellStyle: CSSProperties;
  accentHeaderClassName: string;
  accentHeaderStyle: CSSProperties;
  bodyWrapperClassName: string;
  bodySurfaceClassName: string;
  sectionBorderClassName: string;
  titleClassName: string;
  descriptionClassName: string;
  toolbarClassName: string;
  logoClassName: string;
};

/** Standard modal chrome — light mode. */
export const APP_MODAL_LIGHT: AppModalTheme = {
  shellChromeClassName: "bg-background",
  shellStyle: { borderColor: "var(--brand-primary)" },
  accentHeaderClassName:
    "relative z-20 shrink-0 pointer-events-none bg-cover bg-top bg-no-repeat opacity-40",
  accentHeaderStyle: {
    height: APP_MODAL_HEADER_HEIGHT_PX,
    backgroundImage: `url(${dialogAccent})`,
    WebkitMaskImage: ACCENT_MASK,
    maskImage: ACCENT_MASK,
  },
  bodyWrapperClassName: "bg-background",
  bodySurfaceClassName: "bg-background",
  sectionBorderClassName: "border-b",
  titleClassName: "",
  descriptionClassName: "",
  toolbarClassName:
    "relative z-10 shrink-0 border-b bg-transparent px-3 py-2.5 pr-11 sm:px-4 sm:py-3 sm:pr-12",
  logoClassName:
    "h-8 w-8 shrink-0 rounded-lg object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,0.2)] sm:h-9 sm:w-9",
};

/** Standard modal chrome — dark mode. */
export const APP_MODAL_DARK: AppModalTheme = {
  shellChromeClassName: "bg-[#3a3d42] text-gray-100",
  shellStyle: { borderColor: "var(--brand-primary)" },
  accentHeaderClassName:
    "relative z-20 shrink-0 pointer-events-none bg-cover bg-top bg-no-repeat",
  accentHeaderStyle: {
    height: APP_MODAL_HEADER_HEIGHT_PX,
    backgroundImage: `url(${dialogAccentDark})`,
    WebkitMaskImage: ACCENT_MASK,
    maskImage: ACCENT_MASK,
  },
  bodyWrapperClassName: "bg-[#d1d5db] text-gray-900",
  bodySurfaceClassName: "bg-[#d1d5db] text-gray-900",
  sectionBorderClassName: "border-b border-white/10",
  titleClassName: "text-gray-900",
  descriptionClassName: "text-gray-600",
  toolbarClassName:
    "relative z-10 shrink-0 border-b border-white/20 bg-transparent px-3 py-2.5 pr-11 sm:px-4 sm:py-3 sm:pr-12",
  logoClassName:
    "h-8 w-8 shrink-0 rounded-lg object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,0.2)] sm:h-9 sm:w-9",
};

export function appModalTheme(resolved: "light" | "dark"): AppModalTheme {
  if (resolved === "dark") return APP_MODAL_DARK;
  return APP_MODAL_LIGHT;
}
