import { db, vendorPeopleTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import type { ExpoPushMessage } from "./expo-push";

/** Legacy `sendPushToFieldEmployee` shim → `notifyUsers` with prefs + inbox. */
export async function notifyFieldEmployeeFromLegacyPush(
  fieldEmployeeId: number,
  msg: ExpoPushMessage,
): Promise<void> {
  const [fe] = await db
    .select({ userId: vendorPeopleTable.userId })
    .from(vendorPeopleTable)
    .where(eq(vendorPeopleTable.id, fieldEmployeeId));
  if (!fe?.userId) return;

  const { notifyUsers } = await import("../routes/notifications");
  const type = typeof msg.data?.type === "string" ? msg.data.type : "system";
  const ticketId = msg.data?.ticketId;
  const link =
    typeof msg.data?.link === "string"
      ? msg.data.link
      : typeof ticketId === "number"
        ? `/tickets/${ticketId}`
        : null;

  await notifyUsers([fe.userId], {
    type,
    title: msg.title,
    body: msg.body,
    link,
    pushData: msg.data,
  });
}
