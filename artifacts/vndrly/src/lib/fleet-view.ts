import type { FleetOverview } from "@workspace/api-zod";
export function fleetHomePath(
  overview: FleetOverview | undefined,
  search: string,
) {
  if (
    !overview?.enabled ||
    new URLSearchParams(search).get("workspace") === "standard"
  )
    return null;
  if (
    overview.preference?.defaultWorkspace === "fleet_desk" &&
    overview.capabilities.canDispatch
  )
    return "/fleet";
  if (
    overview.preference?.defaultWorkspace === "fleet_my_day" &&
    overview.capabilities.canDrive
  )
    return "/fleet/my-day";
  return null;
}
export function fleetVisibleRuns(
  overview: FleetOverview,
  userId: number,
  mine: boolean,
  fleetId: string,
  siteId: string,
  search: string,
) {
  return overview.runs.filter(
    (run) =>
      run.companyId === overview.companyId &&
      (!mine || run.driverUserId === userId) &&
      (!fleetId || run.fleetId === fleetId) &&
      (!siteId || run.siteIds.includes(Number(siteId))) &&
      run.title.toLowerCase().includes(search.toLowerCase()),
  );
}
export function fleetPositions(overview: FleetOverview, runIds: Set<string>) {
  return overview.observations.filter(
    (point) =>
      runIds.has(point.runId) &&
      point.source === "driver_phone" &&
      point.freshness !== "unavailable" &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.latitude) <= 90 &&
      Math.abs(point.longitude) <= 180,
  );
}
