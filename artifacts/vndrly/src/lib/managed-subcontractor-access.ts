export type ManagedSubcontractor = {
  siteGrants: { siteId: number; role: "gatekeeper" | "gate_supervisor" }[];
};

export function normalizeManagedSubcontractor(
  value: unknown,
): ManagedSubcontractor | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("siteGrants" in value) ||
    !Array.isArray(value.siteGrants)
  )
    return undefined;
  return {
    siteGrants: value.siteGrants.filter(
      (grant): grant is ManagedSubcontractor["siteGrants"][number] =>
        Boolean(
          grant &&
          typeof grant === "object" &&
          Number.isInteger(grant.siteId) &&
          grant.siteId > 0 &&
          (grant.role === "gatekeeper" || grant.role === "gate_supervisor"),
        ),
    ),
  };
}

export function isManagedSubcontractor(
  user:
    | { role: string; managedSubcontractor?: ManagedSubcontractor }
    | null
    | undefined,
): boolean {
  return (
    user?.role === "field_employee" && user.managedSubcontractor !== undefined
  );
}
