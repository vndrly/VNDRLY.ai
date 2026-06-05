export type NudgeDirection = "up" | "down";

const BLOCKED = new Set([
  "cancelled",
  "denied",
  "completed",
  "funds_dispersed",
]);

export function isNudgeAllowedForStatus(status: string): boolean {
  return !BLOCKED.has(status);
}

export function nudgeDirectionsForRole(role: string | undefined): {
  up: boolean;
  down: boolean;
} {
  switch (role) {
    case "field_employee":
      return { up: true, down: false };
    case "vendor":
      return { up: true, down: true };
    case "partner":
      return { up: false, down: true };
    case "admin":
      return { up: true, down: true };
    default:
      return { up: false, down: false };
  }
}

export type TicketNudgeRow = {
  id: number;
  direction: string;
  targetTier: string;
  message: string | null;
  ticketStatus: string;
  createdAt: string;
  actorUserId: number;
};

export type SendNudgeResult = {
  id: number;
  ticketId: number;
  direction: NudgeDirection;
  targetTier: string;
  notifiedCount: number;
};

export const WORKFLOW_NUDGE_TYPE = "workflow_nudge";

/** Duration of the list-row / card blink when a nudge arrives. */
export const NUDGE_FLASH_MS = 3500;

export function ticketIdFromNotificationLink(
  link: string | null | undefined,
): number | null {
  if (!link) return null;
  const match = link.match(/\/tickets\/(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function ticketIdFromPushData(
  data: Record<string, unknown> | null | undefined,
): number | null {
  if (!data) return null;
  const raw = data.ticketId;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) return id;
  }
  return ticketIdFromNotificationLink(
    typeof data.link === "string" ? data.link : null,
  );
}

export type NudgeNotificationLike = {
  type: string;
  link?: string | null;
  isRead?: boolean;
};

/** Unread workflow-nudge notifications → ticket ids to flash on load. */
export function unreadNudgedTicketIds(rows: NudgeNotificationLike[]): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.type !== WORKFLOW_NUDGE_TYPE) continue;
    if (row.isRead === true) continue;
    const id = ticketIdFromNotificationLink(row.link ?? null);
    if (id) ids.add(id);
  }
  return [...ids];
}
