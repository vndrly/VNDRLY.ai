import { db, fieldPushTokensTable, vendorPeopleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type ExpoPushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

async function sendExpoPushBatch(tokens: string[], msg: ExpoPushMessage) {
  if (tokens.length === 0) return;
  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: msg.title,
    body: msg.body,
    data: msg.data ?? {},
  }));
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, body: await res.text().catch(() => "") },
        "Expo push send failed",
      );
    }
  } catch (err) {
    logger.warn({ err }, "Expo push send threw");
  }
}

export async function sendPushToUser(userId: number, msg: ExpoPushMessage) {
  const rows = await db
    .select({ token: fieldPushTokensTable.expoToken })
    .from(fieldPushTokensTable)
    .where(eq(fieldPushTokensTable.userId, userId));
  await sendExpoPushBatch(rows.map((r) => r.token), msg);
}

export async function sendPushToFieldEmployee(
  fieldEmployeeId: number,
  msg: ExpoPushMessage,
) {
  const [fe] = await db
    .select({ userId: vendorPeopleTable.userId })
    .from(vendorPeopleTable)
    .where(eq(vendorPeopleTable.id, fieldEmployeeId));
  if (!fe?.userId) return;
  await sendPushToUser(fe.userId, msg);
}
