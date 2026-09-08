import { eq } from "drizzle-orm";
import { db, workHubFilesTable } from "@workspace/db";
import type { SessionPayload } from "../lib/session";
import { resolveChannelAccess } from "./queries";

export async function canReadWorkHubFile(session: SessionPayload | null, objectPath: string): Promise<boolean> {
  if (!session?.userId) return false;
  const [file] = await db.select({ channelId: workHubFilesTable.channelId, state: workHubFilesTable.state })
    .from(workHubFilesTable).where(eq(workHubFilesTable.storageKey, objectPath)).limit(1);
  if (!file?.channelId || file.state !== "finalized") return false;
  try { await resolveChannelAccess(session as SessionPayload & { userId: number }, file.channelId, "file.download"); return true; }
  catch { return false; }
}
