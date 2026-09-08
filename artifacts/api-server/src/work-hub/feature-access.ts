import { eq } from "drizzle-orm";
import { db, platformSettingsTable } from "@workspace/db";

export async function isWorkHubEnabled(): Promise<boolean> {
  if (process.env.WORK_HUB_ENABLED === "1") return true;
  const [settings] = await db.select({ enabled: platformSettingsTable.workHubEnabled })
    .from(platformSettingsTable).where(eq(platformSettingsTable.id, 1)).limit(1);
  return settings?.enabled ?? false;
}
