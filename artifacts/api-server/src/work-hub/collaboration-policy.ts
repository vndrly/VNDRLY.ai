export function canManageCrew(input: { ownerMatch: boolean; companyAdmin: boolean; crewRole: string | null }): boolean {
  return (input.ownerMatch && input.companyAdmin) || input.crewRole === "owner";
}

export function canReadCollaborationChannel(kind: string, explicitMember: boolean, crewMember: boolean): boolean {
  return explicitMember || (kind === "crew" && crewMember);
}
