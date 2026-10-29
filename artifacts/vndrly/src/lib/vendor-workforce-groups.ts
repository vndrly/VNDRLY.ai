export const WORKFORCE_GROUPS = [
  { category: "field", title: "Field Crew", role: "field", duty: "Field Worker" },
  { category: "fleet", title: "Drivers", role: "field", duty: "Driver" },
  { category: "gate", title: "Gatekeepers", role: "gatekeeper", duty: null },
] as const;

/** Membership management is separate from operational employee rosters. */
export function isAdministrativeMembership(member: { role: string }): boolean {
  return ["admin", "member", "ap"].includes(member.role);
}

export function workforceCategories(person: { vendorRole?: string | null; roles?: string[] | null }, operationalRoles: string[] = []): string[] {
  const roles = new Set([person.vendorRole, ...(person.roles ?? []), ...operationalRoles]);
  const fleet = ["Driver", "driver", "Dispatch", "Dispatcher", "dispatch", "dispatcher"].some(role => roles.has(role));
  const groups: string[] = [];
  // Explicit duties win over a broad legacy field role (a driver is not
  // automatically also field crew unless that duty was assigned).
  if (roles.has("Field Worker") || ( !fleet && ["field", "field_employee", "foreman", "both"].some(role => roles.has(role)))) groups.push("field");
  if (fleet) groups.push("fleet");
  if (roles.has("gatekeeper") || roles.has("gate_supervisor")) groups.push("gate");
  return groups;
}

export function workforceDisplayRoles(category: string, person: { vendorRole?: string | null; roles?: string[] | null }, operationalRoles: string[] = []): string[] {
  const roles = new Set([person.vendorRole, ...(person.roles ?? []), ...operationalRoles]);
  if (category === "gate") return [roles.has("gate_supervisor") ? "gate_supervisor" : "gate"];
  if (category === "field") return [roles.has("foreman") ? "foreman" : "field_employee"];
  const result: string[] = [];
  if (["Dispatch", "Dispatcher", "dispatch", "dispatcher"].some(role => roles.has(role))) result.push("dispatch");
  if (roles.has("Driver") || roles.has("driver")) result.push("driver");
  return result;
}
