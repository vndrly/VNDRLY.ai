import { syncSiteAfeToAssignments } from "./resolve-site-assignment-afe";

export async function backfillSiteAssignmentAfes(args?: {
  siteLocationId?: number;
  dryRun?: boolean;
  log?: (message: string) => void;
}): Promise<{ scanned: number; updated: number; skipped: number }> {
  const dryRun = args?.dryRun ?? false;
  const log = args?.log ?? (() => {});

  if (dryRun) {
    log(
      "  dry run — would copy each site_locations.afe onto its work assignments",
    );
    return { scanned: 0, updated: 0, skipped: 0 };
  }

  const updated = await syncSiteAfeToAssignments({
    siteLocationId: args?.siteLocationId,
  });
  if (updated > 0) {
    log(`  ✓ synced site AFE onto ${updated} assignment row(s)`);
  }
  return { scanned: updated, updated, skipped: 0 };
}
