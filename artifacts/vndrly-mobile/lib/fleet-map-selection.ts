import type { FleetOverview, FleetResources } from "@workspace/api-zod";
export function fleetMapSelection(
  overview: FleetOverview,
  resources: FleetResources,
  siteId: number | null,
  ticketId: number | null,
) {
  const fleetIds = new Set(
    overview.fleets
      .filter((fleet) => siteId === null || fleet.siteIds.includes(siteId))
      .map((fleet) => fleet.id),
  );
  const runs = overview.runs.filter(
    (run) =>
      (siteId === null ||
        (run.commercial
          ? run.commercial.originSiteId === siteId
          : run.siteIds.includes(siteId))) &&
      (ticketId === null || run.linkedTicketId === ticketId),
  );
  const assignedAssets = new Set(
    overview.fleets
      .filter((f) => fleetIds.has(f.id))
      .flatMap((f) => f.equipmentAssetIds),
  );
  const runAssets = new Set(
      runs.flatMap((run) => [
        run.vehicleAssetId,
        ...(run.trailerAssetId ? [run.trailerAssetId] : []),
      ]),
    ),
    runDrivers = new Set(runs.map((run) => run.driverUserId));
  const equipment = resources.equipment.filter(
    (asset) =>
      (siteId === null && ticketId === null) ||
      runAssets.has(asset.id) ||
      (ticketId === null && assignedAssets.has(asset.id)),
  );
  const drivers = resources.drivers.filter(
    (driver) =>
      (siteId === null && ticketId === null) ||
      runDrivers.has(driver.userId) ||
      (ticketId === null && driver.fleetIds.some((id) => fleetIds.has(id))),
  );
  const runIds = new Set(runs.map((run) => run.id));
  const observations = overview.observations
    .filter(
      (point) => runIds.has(point.runId) && point.freshness !== "unavailable",
    )
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  return { runs, equipment, drivers, observations };
}
