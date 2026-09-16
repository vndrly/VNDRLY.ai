import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { SessionPayload } from "./session";

/** Long-lived streams must recheck revocation before delivering each event. */
export async function managedWorkerSessionIsCurrent(session: SessionPayload): Promise<boolean> {
  if (!session.managedSubcontractor) return true;
  if (!session.userId || typeof session.sv !== "number" || !session.exp || session.exp <= Date.now() / 1000) return false;
  try {
    const [user] = await db.select({ version: usersTable.sessionVersion }).from(usersTable).where(eq(usersTable.id, session.userId)).limit(1);
    return user?.version === session.sv;
  } catch { return false; }
}
