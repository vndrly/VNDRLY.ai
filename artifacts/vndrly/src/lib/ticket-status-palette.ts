import {

  ticketStatusMeta,

  type TicketStatusBadgeColor,

} from "@/lib/ticket-status-meta";

import {

  pillLightGrey,

  pillTan,

  pillAmber,

  pillOrange,

  pillRed,

  pillDarkRed,

  pillHotPink,

  pillPink,

  pillPurple,

  pillIndigo,

  pillNavy,

  pillBlue,

  pillBabyBlue,

  pillTeal,

  pillGreen,

  pillDarkGreen,

  pillLime,

  pillGlossOverlay,

  pillLifecycleApproval1,

  pillLifecycleApproval2,

  pillLifecycleApproval3,

  pillLifecycleSubmitted,

  pillLifecyclePendingReview,

  pillLifecycleInProgress,

  pillLifecycleInitiated,

  pillLifecycleAwaitingAcceptance,

} from "@/lib/pill-palette-assets";



export type TicketLifecycleColor = TicketStatusBadgeColor;



export type TicketLifecyclePillConfig = {

  src: string;

  light?: boolean;

  hex: string;

};



export const TICKET_STATUS_PILL_ASPECT = 900 / 229;



export const ticketLifecyclePillGloss = pillGlossOverlay;



export const ticketLifecyclePills: Record<

  TicketLifecycleColor,

  TicketLifecyclePillConfig

> = {

  grey: {

    src: pillLightGrey,

    light: true,

    hex: "#9CA3AF",

  },

  tan: {

    src: pillTan,

    light: true,

    hex: "#B89463",

  },

  amber: {

    src: pillAmber,

    hex: "#F59E0B",

  },

  orange: {

    src: pillOrange,

    hex: "#EA580C",

  },

  red: {

    src: pillRed,

    hex: "#DC2626",

  },

  darkRed: {

    src: pillDarkRed,

    hex: "#991B1B",

  },

  hotPink: {

    src: pillHotPink,

    hex: "#DB2777",

  },

  pink: {

    src: pillPink,

    hex: "#EC4899",

  },

  purple: {

    src: pillPurple,

    hex: "#7C3AED",

  },

  indigo: {

    src: pillIndigo,

    hex: "#4F46E5",

  },

  navy: {

    src: pillNavy,

    hex: "#1D4ED8",

  },

  blue: {

    src: pillBlue,

    hex: "#3260CD",

  },

  babyBlue: {

    src: pillBabyBlue,

    hex: "#38BDF8",

  },

  teal: {

    src: pillTeal,

    hex: "#0D9488",

  },

  green: {

    src: pillGreen,

    hex: "#15803D",

  },

  darkGreen: {

    src: pillDarkGreen,

    hex: "#166534",

  },

  lime: {

    src: pillLime,

    hex: "#65A30D",

  },

};



/** User-assigned lifecycle artwork — one PNG per ticket status step. */

const ticketStatusLifecycleArt: Partial<Record<string, string>> = {

  awaiting_acceptance: pillLifecycleAwaitingAcceptance,

  initiated: pillLifecycleInitiated,

  in_progress: pillLifecycleInProgress,

  pending_review: pillLifecyclePendingReview,

  submitted: pillLifecycleSubmitted,

  approved: pillLifecycleApproval1,

  awaiting_payment: pillLifecycleApproval2,

  funds_dispersed: pillLifecycleApproval3,

};



export function statusToTicketLifecycleColor(status: string): TicketLifecycleColor {

  return ticketStatusMeta[status]?.badgeColor ?? "grey";

}



export function ticketLifecyclePillForStatus(status: string): TicketLifecyclePillConfig {

  const color = statusToTicketLifecycleColor(status);

  const base = ticketLifecyclePills[color];

  const src = ticketStatusLifecycleArt[status] ?? base.src;

  return src === base.src ? base : { ...base, src };

}


