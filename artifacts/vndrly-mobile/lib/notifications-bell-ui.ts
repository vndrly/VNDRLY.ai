/**
 * Visual tokens copied from web `notifications-bell.tsx` and
 * `foreman-quick-actions.tsx` — do not diverge without updating web too.
 */

/** Web `text-gray-400` / `text-white` bell colors. */
export const NOTIFICATION_BELL_COLOR_IDLE = "#9ca3af";
export const NOTIFICATION_BELL_COLOR_ACTIVE = "#ffffff";

/** Web `Bell` icon `h-5 w-5`. */
export const NOTIFICATION_BELL_ICON_SIZE = 20;

/** Web `bg-red-600`. */
export const NOTIFICATION_COUNT_BADGE_BG = "#dc2626";

/** Web header bell badge: `h-5 min-w-[24px] px-1.5 text-[10px] font-bold`. */
export const NOTIFICATION_BELL_BADGE = {
  top: -4,
  right: -4,
  height: 20,
  minWidth: 24,
  paddingHorizontal: 6,
  fontSize: 10,
  lineHeight: 10,
  fontFamily: "Inter_700Bold" as const,
};

/** Web foreman tile badge: `min-w-[18px] h-[18px] px-1 text-[10px] font-semibold`. */
export const NOTIFICATION_TILE_BADGE = {
  top: 12,
  right: 12,
  height: 18,
  minWidth: 18,
  paddingHorizontal: 4,
  fontSize: 10,
  lineHeight: 10,
  fontFamily: "Inter_600SemiBold" as const,
};

export function formatNotificationCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
