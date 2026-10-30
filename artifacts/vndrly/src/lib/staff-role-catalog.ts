import { STAFF_ROLE_DEFINITIONS, type StaffRoleDefinition } from "./staff-profile";
export type CompanyStaffRole = { id: string; label: string; group: string; aliases?: string[] };
export type CompanyStaffRoleCatalog = { version: number; entries: CompanyStaffRole[]; canEdit: boolean };
export function catalogStaffRoles(catalog?: CompanyStaffRoleCatalog): CompanyStaffRole[] {
  const defaults = STAFF_ROLE_DEFINITIONS.filter(role => role.area === "office").map(({ label, group }) => ({ id: `common:${label}`, label, group }));
  return catalog?.version ? catalog.entries : defaults;
}
export function companyRoleOptions(operations: readonly string[], catalog?: CompanyStaffRoleCatalog): StaffRoleDefinition[] {
  return [
    ...catalogStaffRoles(catalog).map(role => ({ ...role, type: "Office Staff" as const, area: "office", access: ["office" as const] })),
    ...STAFF_ROLE_DEFINITIONS.filter(role => role.area !== "office" && operations.includes(role.area)),
  ];
}
export function currentRoleLabel(label: string, catalog?: CompanyStaffRoleCatalog): string {
  return catalogStaffRoles(catalog).find(role => role.label === label || role.aliases?.includes(label))?.label ?? label;
}
export async function loadStaffRoleCatalog(vendorId: number): Promise<CompanyStaffRoleCatalog> {
  const response = await fetch(`/api/vendors/${vendorId}/staff-roles`, { credentials: "include" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Unable to load staffing roles");
  return data;
}
export const staffRoleCatalogKey = (vendorId: number) => ["staff-role-catalog", vendorId] as const;
