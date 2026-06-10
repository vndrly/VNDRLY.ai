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



/**

 * Pill + toggle label depth (text AND icons).

 * Uses CSS filter drop-shadow on the label flex wrapper so Lucide icons

 * pick up the same depth as the label text.

 *

 * Blend between Crisp (#4) and Deep (#5) — softer than nav squares.

 */

export const PILL_LABEL_ON_COLOR_CLASS =

  "text-white font-normal drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.55)]";



export const PILL_LABEL_ON_LIGHT_CLASS =

  "text-gray-700 font-normal drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.22)]";



/** Read-only chips on light-grey PNG — same depth as other idle pills. */

export const PILL_LABEL_ON_GREY_CLASS = PILL_LABEL_ON_LIGHT_CLASS;

/** Grey idle pill → colored on hover (label + icon). */
export const PILL_LABEL_HOVER_REVEAL_CLASS =
  "group-hover:text-white group-hover:drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.55)] group-active:text-white group-active:drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.55)]";

/**

 * Sidebar nav square buttons — original Deep treatment (unchanged).

 * drop-shadow on the label row shades both text and icons.

 */

export const NAV_SQUARE_LABEL_ON_COLOR_CLASS =

  "text-white font-normal drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]";



export const NAV_SQUARE_LABEL_IDLE_SOLID_CLASS =

  "text-gray-700 font-normal drop-shadow-[0_1px_2px_rgba(0,0,0,0.125)]";

/** Inactive square nav on dark sidebar (#3a3d42) — same as layout.tsx nav items. */
export const NAV_SQUARE_LABEL_IDLE_DARK_CLASS = "text-gray-300 font-normal";

export const NAV_SQUARE_LABEL_IDLE_LIGHT_CLASS = "text-gray-400 font-normal";

export const NAV_SQUARE_LABEL_HOVER_ON_COLOR_CLASS =

  "group-hover:text-white group-hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]";



export const NAV_SQUARE_LABEL_HOVER_SOLID_IDLE_CLASS =

  "group-hover:drop-shadow-[0_1px_2px_rgba(0,0,0,0.275)]";



/** @param light — true when the pill PNG is grey / idle / light-toned. */

export function pillLabelToneClass(light?: boolean): string {

  return light ? PILL_LABEL_ON_LIGHT_CLASS : PILL_LABEL_ON_COLOR_CLASS;

}



/** Split EN/ES, Dark/Light, Map/Satellite toggle half labels. */

export function splitToggleLabelClass(active: boolean): string {

  return active ? PILL_LABEL_ON_COLOR_CLASS : PILL_LABEL_ON_LIGHT_CLASS;

}



export const NAV_SQUARE_HEIGHT_PX = 32;

export const NAV_SQUARE_HEIGHT_CLASS = "h-[32px]";

/** Layout + typography for square sidebar nav buttons (matches layout.tsx nav). */
export const NAV_SQUARE_LABEL_CLASS =
  "relative z-10 flex items-center gap-3 px-4 h-full text-sm font-normal transition-colors";

export const PILL_WRAPPER_CLASS =

  "group relative inline-flex items-center select-none align-middle";



/** CSS-only pill chips (rounded-full status/tag surfaces). */

export const PILL_CSS_CHIP_CLASS =

  "inline-flex items-center h-[23px] px-3 rounded-full text-xs font-normal whitespace-nowrap";


