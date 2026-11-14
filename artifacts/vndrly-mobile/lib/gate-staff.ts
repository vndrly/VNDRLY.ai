export type GatePerson = {
  id: number;
  vendorId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  jobTitle?: string | null;
  vendorRole?: string | null;
  isActive?: boolean;
  pecCertification?: boolean;
  pecExpirationDate?: string | null;
};
export type GateAccess = {
  vendorPeopleId: number;
  isAdmin: boolean;
  operationalRoles: string[];
  siteAccessMode: "all_authorized" | "selected";
  siteLocationIds: number[];
};
export type GatePeopleAccess = {
  eligibleSites: { id: number; name: string; partnerName?: string | null }[];
  people: GateAccess[];
};
export function toggleGateRole(
  roles: string[],
  role: "gatekeeper" | "gate_supervisor",
  enabled: boolean,
) {
  return [
    ...new Set(enabled ? [...roles, role] : roles.filter((r) => r !== role)),
  ];
}
export function mergeGatePeople(
  field: GatePerson[],
  office: GatePerson[],
  access: GatePeopleAccess,
) {
  const ids = new Set(access.people.map((p) => p.vendorPeopleId));
  return [
    ...new Map(
      [...field, ...office].filter((p) => ids.has(p.id)).map((p) => [p.id, p]),
    ).values(),
  ].sort((a, b) =>
    (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName),
  );
}
