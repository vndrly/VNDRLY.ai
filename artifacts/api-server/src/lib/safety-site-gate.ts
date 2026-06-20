import { eq } from "drizzle-orm";
import { db, siteLocationsTable } from "@workspace/db";

export async function loadSiteActiveState(
  siteLocationId: number,
): Promise<{ isActive: boolean; status: string; name: string } | null> {
  const [site] = await db
    .select({
      isActive: siteLocationsTable.isActive,
      status: siteLocationsTable.status,
      name: siteLocationsTable.name,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, siteLocationId))
    .limit(1);
  return site ?? null;
}

export async function assertSiteActiveForWork(siteLocationId: number): Promise<string | null> {
  const site = await loadSiteActiveState(siteLocationId);
  if (!site) return "Site location not found.";
  if (!site.isActive || site.status === "inactive") {
    return `Site "${site.name}" is inactive due to a safety stop-work event. Contact Partner HSE to reactivate before starting new work.`;
  }
  return null;
}
