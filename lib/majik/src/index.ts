/** Majik — desktop wake-presence widget for the VNDRLY workgroup. */

export const MAJIK_MAX_MEMBERS = 8;
export const MAJIK_STALE_HOURS = 4;
export const MAJIK_STALE_MS = MAJIK_STALE_HOURS * 60 * 60 * 1000;
/** Singleton team circle seeded at id=1. */
export const MAJIK_DEFAULT_CIRCLE_ID = 1;

export type MajikPresenceState = "up" | "stale" | "down";

export interface MajikMemberPresence {
  userId: number;
  displayName: string;
  isUp: boolean;
  effectiveUp: boolean;
  state: MajikPresenceState;
  updatedAt: string | null;
}

export interface MajikCircleSnapshot {
  circleId: number;
  name: string;
  maxMembers: number;
  memberCount: number;
  upCount: number;
  staleHours: number;
  members: MajikMemberPresence[];
}

export type MajikPresenceEvent =
  | {
      type: "majik.presence_updated";
      circleId: number;
      userId: number;
      isUp: boolean;
      effectiveUp: boolean;
      state: MajikPresenceState;
      updatedAt: string;
    }
  | {
      type: "majik.hello";
      currentSeq: number;
      lastSeenSeq: number | null;
      gap: boolean;
    };

export function computeMajikPresenceState(
  isUp: boolean,
  updatedAt: Date | null,
  nowMs: number = Date.now(),
): { effectiveUp: boolean; state: MajikPresenceState } {
  if (!isUp || !updatedAt) {
    return { effectiveUp: false, state: "down" };
  }
  const ageMs = nowMs - updatedAt.getTime();
  if (ageMs <= MAJIK_STALE_MS) {
    return { effectiveUp: true, state: "up" };
  }
  return { effectiveUp: false, state: "stale" };
}

/** Window height for the Tauri widget (px), excluding OS chrome. */
export function majikWidgetHeightPx(memberCount: number): number {
  const rows = Math.max(1, Math.min(MAJIK_MAX_MEMBERS, memberCount));
  const header = 44;
  const footer = 72;
  const row = 36;
  const padding = 24;
  return header + rows * row + footer + padding;
}

export function formatMajikRelativeTime(
  updatedAt: Date | null,
  nowMs: number = Date.now(),
): string {
  if (!updatedAt) return "";
  const deltaSec = Math.max(0, Math.floor((nowMs - updatedAt.getTime()) / 1000));
  if (deltaSec < 60) return "just now";
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
