import type { CSSProperties } from "react";

import dialogAccent from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";
import "./branded-modal.css";

/** Shared modal chrome — approved light + dark snapshots (2026-06). */
export const APP_MODAL_HEADER_HEIGHT_PX = 70;

const ACCENT_MASK =
  "linear-gradient(to bottom, black 0%, black 66%, transparent 100%)" as const;

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
    backgroundSize: "auto 100%",
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
  shellChromeClassName: "app-branded-modal bg-[#242426] text-[#ececec]",
  shellStyle: { borderColor: "var(--brand-primary)" },
  accentHeaderClassName: "hidden",
  accentHeaderStyle: { display: "none" },
  bodyWrapperClassName: "bg-transparent text-[#ececec]",
  bodySurfaceClassName: "bg-[#242426] text-[#ececec]",
  sectionBorderClassName: "border-b border-white/10",
  titleClassName: "text-[#ececec]",
  descriptionClassName: "text-[#b3b3b3]",
  toolbarClassName:
    "relative z-10 shrink-0 border-b border-white/20 bg-transparent px-3 py-2.5 pr-11 sm:px-4 sm:py-3 sm:pr-12",
  logoClassName:
    "h-8 w-8 shrink-0 rounded-lg object-contain drop-shadow-[0_1px_3px_rgba(0,0,0,0.2)] sm:h-9 sm:w-9",
};

/**
 * Modal chrome is intentionally independent from the surrounding page theme.
 * Keep the compatibility function while returning the single approved contract.
 */
export const APP_MODAL_ALWAYS_DARK: AppModalTheme = APP_MODAL_DARK;

export function appModalTheme(_resolved?: "light" | "dark"): AppModalTheme {
  return APP_MODAL_ALWAYS_DARK;
}
