import {

  APP_MODAL_DARK,

  APP_MODAL_HEADER_HEIGHT_PX,

  APP_MODAL_LIGHT,

  appModalTheme,

  type AppModalTheme,

} from "@/components/app-modal-tokens";



/** @deprecated Use {@link APP_MODAL_HEADER_HEIGHT_PX}. */

export const NOTIFICATIONS_MODAL_HEADER_HEIGHT_PX = APP_MODAL_HEADER_HEIGHT_PX;



export type NotificationsModalTheme = AppModalTheme & {

  shellClassName: string;

  tabsListClassName: string;

  tabsContentClassName: string;

  rateLimitedBannerClassName: string;

  rowHoverClassName: string;

  rowSelectedClassName: string;

  unreadDotClassName: string;

  unreadTypeBadgeClassName: string;

  readTypeBadgeClassName: string;

  flatActionBaseClassName: string;

  flatActionBrandClassName: string;

  flatActionGreyClassName: string;

  flatActionDangerClassName: string;

  flatActionGreyHoverRedClassName: string;

  flatActionGreyHoverBlueClassName: string;

  tabTriggerExtraClassName: string;

  tabTriggerActiveClassName: string;

  tabTriggerInactiveClassName: string;

  tabUnreadBadgeClassName: string;

};



/** Frozen light-mode layout: 70px accent header, inline logo toolbar, white list body. */

export const NOTIFICATIONS_MODAL_LIGHT: NotificationsModalTheme = {

  ...APP_MODAL_LIGHT,

  shellClassName:

    "w-[min(calc(100vw-1.5rem),48rem)] max-h-[min(100vh-2rem,40rem)] overflow-x-hidden p-0",

  titleClassName: "truncate text-sm sm:text-base",

  tabsListClassName:

    "h-auto w-full shrink-0 flex-wrap justify-start gap-1 rounded-none border-b bg-background px-2 py-2 sm:px-3",

  tabsContentClassName: "m-0 min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background",

  rateLimitedBannerClassName:

    "flex items-center gap-1.5 border-b bg-[color:color-mix(in_srgb,var(--brand-primary)_12%,white)] px-4 py-1.5 text-[11px] text-[color:color-mix(in_srgb,var(--brand-primary)_70%,black)]",

  rowHoverClassName: "cursor-pointer border-b px-4 py-3 hover:bg-muted/40",

  rowSelectedClassName: "bg-muted/40",

  unreadDotClassName: "bg-[color:var(--brand-primary)]",

  unreadTypeBadgeClassName:

    "bg-[color:var(--brand-primary)] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]",

  readTypeBadgeClassName:

    "bg-gray-400 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]",

  flatActionBaseClassName:

    "inline-flex h-[23px] shrink-0 items-center rounded-full px-2 text-[10px] font-normal sm:px-3 sm:text-xs",

  flatActionBrandClassName:

    "bg-[color:var(--brand-primary)] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:opacity-90",

  flatActionGreyClassName:

    "bg-gray-400 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:opacity-90",

  flatActionDangerClassName:

    "bg-red-600 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:opacity-90",

  flatActionGreyHoverRedClassName:

    "bg-gray-400 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:bg-red-600 hover:opacity-100",

  flatActionGreyHoverBlueClassName:

    "bg-gray-400 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:bg-blue-600 hover:opacity-100",

  tabTriggerExtraClassName:

    "group shrink-0 rounded-full border px-2 text-[11px] font-normal shadow-none sm:px-2.5 sm:text-xs",

  tabTriggerActiveClassName:

    "data-[state=active]:!border-[color:var(--brand-primary)] data-[state=active]:!bg-[color:var(--brand-primary)] data-[state=active]:!text-white data-[state=active]:drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.55)]",

  tabTriggerInactiveClassName:

    "data-[state=inactive]:!border-[color:var(--brand-primary)]/35 data-[state=inactive]:!bg-[color:color-mix(in_srgb,var(--brand-primary)_18%,white)] data-[state=inactive]:!text-[color:var(--brand-primary)]",

  tabUnreadBadgeClassName:

    "bg-[color:var(--brand-primary)] text-white group-data-[state=active]:bg-white/30",

};



/** Frozen dark-mode layout: dark blur header, #3a3d42 chrome, #d1d5db message list. */

export const NOTIFICATIONS_MODAL_DARK: NotificationsModalTheme = {

  ...APP_MODAL_DARK,

  shellClassName:

    "w-[min(calc(100vw-1.5rem),48rem)] max-h-[min(100vh-2rem,40rem)] overflow-x-hidden p-0",

  titleClassName: "truncate text-sm sm:text-base text-gray-100",

  tabsListClassName:

    "h-auto w-full shrink-0 flex-wrap justify-start gap-1 rounded-none border-b border-white/10 bg-[#3a3d42] px-2 py-2 sm:px-3",

  tabsContentClassName:

    "m-0 min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#d1d5db] text-gray-900",

  rateLimitedBannerClassName:

    "flex items-center gap-1.5 border-b border-white/10 bg-[color:color-mix(in_srgb,var(--brand-primary)_18%,#3a3d42)] px-4 py-1.5 text-[11px] text-gray-200",

  rowHoverClassName:

    "cursor-pointer border-b border-gray-400/60 px-4 py-3 hover:bg-[#c4c8ce]",

  rowSelectedClassName: "bg-[#c4c8ce]",

  unreadDotClassName: "bg-[color:var(--brand-primary)]",

  unreadTypeBadgeClassName:

    "bg-[color:var(--brand-primary)] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]",

  readTypeBadgeClassName:

    "bg-gray-500 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]",

  flatActionBaseClassName:

    "inline-flex h-[23px] shrink-0 items-center rounded-full px-2 text-[10px] font-normal sm:px-3 sm:text-xs",

  flatActionBrandClassName:

    "bg-[color:var(--brand-primary)] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:opacity-90",

  flatActionGreyClassName:

    "bg-gray-500 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:opacity-90",

  flatActionDangerClassName:

    "bg-red-600 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:opacity-90",

  flatActionGreyHoverRedClassName:

    "bg-gray-500 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:bg-red-600 hover:opacity-100",

  flatActionGreyHoverBlueClassName:

    "bg-gray-500 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] hover:bg-blue-600 hover:opacity-100",

  tabTriggerExtraClassName:

    "group shrink-0 rounded-full border px-2 text-[11px] font-normal shadow-none sm:px-2.5 sm:text-xs",

  tabTriggerActiveClassName:

    "data-[state=active]:!border-[color:var(--brand-primary)] data-[state=active]:!bg-[color:var(--brand-primary)] data-[state=active]:!text-white data-[state=active]:drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.55)]",

  tabTriggerInactiveClassName:

    "data-[state=inactive]:!border-[color:var(--brand-primary)]/40 data-[state=inactive]:!bg-[color:color-mix(in_srgb,var(--brand-primary)_22%,#3a3d42)] data-[state=inactive]:!text-[color:color-mix(in_srgb,var(--brand-primary)_65%,white)]",

  tabUnreadBadgeClassName:

    "bg-[color:var(--brand-primary)] text-white group-data-[state=active]:bg-white/30",

};



export function notificationsModalTheme(resolved: "light" | "dark"): NotificationsModalTheme {

  if (resolved === "dark") return NOTIFICATIONS_MODAL_DARK;

  return NOTIFICATIONS_MODAL_LIGHT;

}



export { appModalTheme };


