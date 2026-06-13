// Bounded write tools for askV — small, explicit mutations the user could
// perform themselves in the UI. Each tool re-checks session scope server-side
// and refuses token/signup modes upstream in routes/assistant.ts#runTool.

import { and, eq } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";

function err(message: string): string {
  return JSON.stringify({ error: message });
}

export const WRITE_TOOL_NAMES = ["mark_notifications_read"] as const;
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

interface MarkNotificationsReadInput {
  notificationId?: number;
  /** When true (default), mark every unread notification for this user. */
  markAll?: boolean;
}

async function markNotificationsRead(
  input: MarkNotificationsReadInput,
  session: SessionPayload,
): Promise<string> {
  if (!session.userId) {
    return err("Must be signed in to update notifications.");
  }
  const userId = session.userId;

  if (typeof input.notificationId === "number" && Number.isFinite(input.notificationId)) {
    const id = Math.floor(input.notificationId);
    const updated = await db
      .update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
      .returning({ id: notificationsTable.id });
    if (updated.length === 0) {
      return err(`Notification ${id} was not found on your account.`);
    }
    return JSON.stringify({ ok: true, marked: 1, notificationId: id });
  }

  const markAll = input.markAll !== false;
  if (!markAll) {
    return err("Provide notificationId or set markAll to true.");
  }

  const updated = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)))
    .returning({ id: notificationsTable.id });
  return JSON.stringify({ ok: true, marked: updated.length, markAll: true });
}

export async function runWriteTool(
  name: WriteToolName,
  input: unknown,
  session: SessionPayload,
): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "mark_notifications_read":
      return markNotificationsRead(args as MarkNotificationsReadInput, session);
  }
}
