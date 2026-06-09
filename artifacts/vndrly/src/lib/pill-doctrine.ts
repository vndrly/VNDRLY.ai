/**
 * Site-wide pill doctrine — matches Crew Tracker status pills.
 * Every PNG pill (button, status, role, etc.) uses these values.
 */
export const PILL_HEIGHT_PX = 23;

export const PILL_HEIGHT_CLASS = "h-[23px]";

export const PILL_MIN_HEIGHT_CLASS = "min-h-[23px]";

/** Default status pill min width (Crew Tracker row badges). */
export const PILL_STATUS_MIN_WIDTH_CLASS = "min-w-[98px]";

/** Label typography shared by every pill surface. */
export const PILL_LABEL_CLASS =
  "relative z-10 flex items-center justify-center w-full h-full font-normal px-3 text-xs whitespace-nowrap";

export const PILL_LABEL_INNER_CLASS = "px-3 text-xs font-normal whitespace-nowrap";

export const PILL_TEXT_SHADOW = "0 2px 4px rgba(0,0,0,0.9)";

export const PILL_WRAPPER_CLASS =
  "group relative inline-flex items-center select-none align-middle";

/** CSS-only pill chips (rounded-full status/tag surfaces). */
export const PILL_CSS_CHIP_CLASS =
  "inline-flex items-center h-[23px] px-3 rounded-full text-xs font-normal whitespace-nowrap";
