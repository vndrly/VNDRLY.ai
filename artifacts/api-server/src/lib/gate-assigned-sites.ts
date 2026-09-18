export type AssignedGateSiteInput = {
  id: number;
  name: string;
  address: string;
  siteCode: string;
  latitude: number;
  longitude: number;
  siteRadiusMeters?: number | null;
  partnerId: number;
  partnerName: string;
  hidden?: boolean | null;
  isActive?: boolean | null;
};

export type AssignedGateSite = {
  id: number;
  name: string;
  address: string;
  siteCode: string;
  latitude: number;
  longitude: number;
  siteRadiusMeters: number;
  assignmentId: number;
  partnerId: number;
  partnerName: string;
};

export function assembleAssignedGateSites(
  assignments: { id: number; siteLocationId: number }[],
  sites: AssignedGateSiteInput[],
): AssignedGateSite[] {
  const latestAssignment = new Map<number, number>();
  for (const row of assignments) {
    const previous = latestAssignment.get(row.siteLocationId) ?? 0;
    if (row.id > previous) latestAssignment.set(row.siteLocationId, row.id);
  }
  return sites
    .filter(
      (site) =>
        latestAssignment.has(site.id) &&
        site.hidden !== true &&
        site.isActive !== false,
    )
    .map((site) => ({
      id: site.id,
      name: site.name,
      address: site.address,
      siteCode: site.siteCode,
      latitude: site.latitude,
      longitude: site.longitude,
      siteRadiusMeters: site.siteRadiusMeters ?? 805,
      assignmentId: latestAssignment.get(site.id)!,
      partnerId: site.partnerId,
      partnerName: site.partnerName,
    }))
    .sort((a, b) => b.assignmentId - a.assignmentId);
}

export function pickDefaultAssignedSite<T extends { assignmentId: number }>(
  sites: T[],
): T | null {
  return sites[0] ?? null;
}
