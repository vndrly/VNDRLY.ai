import type { EmployeeOperationalRole } from "@/components/employee-access-editor";

export const STAFF_TYPES = ["Office Staff", "Field Employee", "Driver", "Gatekeeper"] as const;
export type StaffType = typeof STAFF_TYPES[number];
export const STAFF_DUTIES = ["Foreman", "Dispatch", "Gate Supervisor", "Scheduler", "Payroll", "Purchasing", "Invoicing"] as const;
const TYPE_TAG: Record<StaffType, string> = { "Office Staff": "Office Staff", "Field Employee": "Field Worker", Driver: "Driver", Gatekeeper: "Gatekeeper" };

export function staffTypeFor(person: { vendorRole?: string | null; roles?: string[] | null }): StaffType {
  for (const type of STAFF_TYPES) if (person.roles?.includes(TYPE_TAG[type])) return type;
  if (person.roles?.some(role => ["Dispatch", "Dispatcher"].includes(role))) return "Driver";
  if (["gatekeeper", "gate_supervisor"].includes(person.vendorRole ?? "")) return "Gatekeeper";
  if (["field", "field_employee", "foreman"].includes(person.vendorRole ?? "")) return "Field Employee";
  return "Office Staff";
}

export function staffRolesFor(type: StaffType, duties: string[], original: string[]): string[] {
  const typeTags = new Set(Object.values(TYPE_TAG));
  // Retain unrelated saved flags such as Visitor Notifications.
  const legacyAccessTags = new Set(["office", "field", "field_employee", "foreman", "gatekeeper", "gate_supervisor", "driver", "dispatch"]);
  const unrelated = original.filter(role => !typeTags.has(role) && !legacyAccessTags.has(role) && !STAFF_DUTIES.includes(role as typeof STAFF_DUTIES[number]));
  return [...new Set([TYPE_TAG[type], ...unrelated, ...duties])];
}

export function defaultStaffAccess(type: StaffType): EmployeeOperationalRole[] {
  return type === "Office Staff" ? ["office"] : type === "Gatekeeper" ? ["gatekeeper"] : ["field_employee"];
}

export function legacyStaffAccess(role?: string | null): EmployeeOperationalRole[] {
  if (role === "both") return ["office", "field_employee"];
  if (["office", "foreman", "gatekeeper", "gate_supervisor"].includes(role ?? "")) return [role as EmployeeOperationalRole];
  if (role === "field" || role === "field_employee") return ["field_employee"];
  return [];
}

export function staffAccessFor(type: StaffType, duties: string[], current: EmployeeOperationalRole[], previousType: StaffType): EmployeeOperationalRole[] {
  const next = new Set(current);
  // Only an explicit staff-type change replaces the base access; extra
  // operational grants remain intact until the user edits Permissions.
  if (type !== previousType) {
    for (const role of defaultStaffAccess(previousType)) next.delete(role);
    for (const role of defaultStaffAccess(type)) next.add(role);
  }
  if (duties.includes("Foreman")) next.add("foreman");
  if (duties.includes("Gate Supervisor")) next.add("gate_supervisor");
  return [...next];
}
