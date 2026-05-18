import {
  ticketStatusMeta,
  type TicketStatusBadgeColor,
} from "@/lib/ticket-status-meta";

export type TicketLifecycleColor = TicketStatusBadgeColor;

const BUTTON_ASSET_ROOT = "/assets/buttons";

export const TICKET_STATUS_PILL_ASPECT = 900 / 229;

export const ticketLifecyclePillGloss = `${BUTTON_ASSET_ROOT}/900x229_overlay_v2.png`;

export const ticketLifecyclePills: Record<
  TicketLifecycleColor,
  { src: string; light?: boolean; hex: string }
> = {
  grey: {
    src: `${BUTTON_ASSET_ROOT}/900x229_Light_Grey_Pill.png`,
    light: true,
    hex: "#9CA3AF",
  },
  tan: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0030_900x229_tan_Pill.png`,
    light: true,
    hex: "#B89463",
  },
  amber: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0024_900x229_Amber_Pill.png`,
    hex: "#F59E0B",
  },
  orange: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0037_900x229_orange_Pill_v2.png`,
    hex: "#EA580C",
  },
  red: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0031_900x229_red_Pill_v2.png`,
    hex: "#DC2626",
  },
  darkRed: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0044_900x229_dark_red_Pill_v2.png`,
    hex: "#991B1B",
  },
  hotPink: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0048_900x229_hot-pink_Pill.png`,
    hex: "#DB2777",
  },
  pink: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0035_900x229_pink_Pill_v2.png`,
    hex: "#EC4899",
  },
  purple: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0033_900x229_purple_Pill_v2.png`,
    hex: "#7C3AED",
  },
  indigo: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0045_900x229_indego_Pill_v2.png`,
    hex: "#4F46E5",
  },
  navy: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0040_900x229_navy_Pill_v2.png`,
    hex: "#1D4ED8",
  },
  blue: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0017_900x229_blue_Pill.png`,
    hex: "#3260CD",
  },
  babyBlue: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0019_900x229_baby_blue_Pill.png`,
    hex: "#38BDF8",
  },
  teal: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0025_900x229_teal_Pill_v3.png`,
    hex: "#0D9488",
  },
  green: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png`,
    hex: "#15803D",
  },
  darkGreen: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0008_900x229_dark_green_Pill_v3.png`,
    hex: "#166534",
  },
  lime: {
    src: `${BUTTON_ASSET_ROOT}/NewPillPallet_0001s_0042_900x229_lime_green_Pill_v3.png`,
    hex: "#65A30D",
  },
};

export function statusToTicketLifecycleColor(status: string): TicketLifecycleColor {
  return ticketStatusMeta[status]?.badgeColor ?? "grey";
}

export function ticketLifecyclePillForStatus(status: string) {
  return ticketLifecyclePills[statusToTicketLifecycleColor(status)];
}
