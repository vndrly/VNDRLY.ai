import type { EmployeeOperationalRole } from "@/components/employee-access-editor";

export const STAFF_TYPES = ["Office Staff", "Field Employee", "Driver", "Gatekeeper"] as const;
export type StaffType = typeof STAFF_TYPES[number];
const TYPE_TAG: Record<StaffType, string> = { "Office Staff": "Office Staff", "Field Employee": "Field Worker", Driver: "Driver", Gatekeeper: "Gatekeeper" };

export type StaffRoleDefinition = { label: string; group: string; type: StaffType; area: string; access: EmployeeOperationalRole[] };
// Shared position definitions across companies. Titles do not grant company-admin membership.
export const STAFF_ROLE_DEFINITIONS: StaffRoleDefinition[] = [
  ...Object.entries({
    "General": ["Team Member", "Office Staff"],
    "Leadership & Management": ["Owner", "President", "Vice President", "Chief Executive Officer", "Chief Operating Officer", "General Manager", "Operations Manager", "Office Manager", "Branch Manager"],
    "Office & Administration": ["Administrative Assistant", "Executive Assistant", "Receptionist", "Customer Service", "Records Coordinator", "Contract Administrator"],
    "Accounting & Purchasing": ["Payroll", "Accounts Payable", "Accounts Receivable", "Accountant", "Bookkeeper", "Controller", "Billing", "Invoicing", "Purchasing", "Procurement"],
    "People, Safety & Training": ["Human Resources", "Recruiter", "Training Coordinator", "Safety Coordinator", "Compliance Coordinator"],
    "Planning & Support": ["Scheduler", "Project Coordinator", "Inventory Coordinator", "Warehouse Coordinator", "IT Support", "Quality Assurance"],
  }).flatMap(([group, labels]) => labels.map(label => ({ label, group, type: "Office Staff" as const, area: "office", access: ["office" as const] }))),
  { label: "Gate Supervisor", group: "Gate Ops", type: "Gatekeeper", area: "gate", access: ["gatekeeper", "gate_supervisor"] },
  { label: "Gatekeeper", group: "Gate Ops", type: "Gatekeeper", area: "gate", access: ["gatekeeper"] },
  { label: "Field Worker", group: "Field Ops", type: "Field Employee", area: "field", access: ["field_employee"] },
  { label: "Foreman", group: "Field Ops", type: "Field Employee", area: "field", access: ["field_employee", "foreman"] },
  { label: "Driver", group: "Fleet Ops", type: "Driver", area: "fleet", access: ["field_employee"] },
  { label: "Dispatch", group: "Fleet Ops", type: "Office Staff", area: "fleet", access: ["office"] },
];
export const STAFF_DUTIES = STAFF_ROLE_DEFINITIONS.map(role => role.label).filter(label => ![...Object.values(TYPE_TAG), "Team Member"].includes(label));
export function staffRoleOptions(operations: readonly string[]) {
  return STAFF_ROLE_DEFINITIONS.filter(role => role.area === "office" || operations.includes(role.area));
}
export function staffRoleDefinition(label: string) {
  return STAFF_ROLE_DEFINITIONS.find(role => role.label === label);
}
export function staffPrimaryRole(person: { jobTitle?: string | null; vendorRole?: string | null; roles?: string[] | null }, operationalRoles: EmployeeOperationalRole[]) {
  if (/^gate\s+attendant$/i.test(person.jobTitle?.trim() ?? "")) return "Gatekeeper";
  if (person.jobTitle?.trim()) return person.jobTitle.trim();
  if (operationalRoles.includes("gate_supervisor")) return "Gate Supervisor";
  if (operationalRoles.includes("foreman")) return "Foreman";
  const duty = STAFF_DUTIES.find(role => person.roles?.includes(role));
  return duty ?? TYPE_TAG[staffTypeFor(person)];
}
export function accessForStaffRoles(labels: string[], previousLabels: string[], current: EmployeeOperationalRole[], definitions = STAFF_ROLE_DEFINITIONS) {
  const next = new Set(current);
  for (const label of previousLabels) for (const role of definitions.find(role => role.label === label)?.access ?? []) next.delete(role);
  for (const label of labels) for (const role of definitions.find(role => role.label === label)?.access ?? []) next.add(role);
  return [...next];
}

export function staffTypeFor(person: { vendorRole?: string | null; roles?: string[] | null }): StaffType {
  for (const type of STAFF_TYPES) if (person.roles?.includes(TYPE_TAG[type])) return type;
  if (person.roles?.some(role => ["Dispatch", "Dispatcher"].includes(role))) return "Driver";
  if (["gatekeeper", "gate_supervisor"].includes(person.vendorRole ?? "")) return "Gatekeeper";
  if (["field", "field_employee", "foreman"].includes(person.vendorRole ?? "")) return "Field Employee";
  return "Office Staff";
}

export function staffRolesFor(type: StaffType, duties: string[], original: string[], roleLabels: string[] = STAFF_DUTIES): string[] {
  const typeTags = new Set(Object.values(TYPE_TAG));
  // Retain unrelated saved flags such as Visitor Notifications.
  const legacyAccessTags = new Set(["office", "field", "field_employee", "foreman", "gatekeeper", "gate_supervisor", "driver", "dispatch"]);
  const unrelated = original.filter(role => !typeTags.has(role) && !legacyAccessTags.has(role) && !roleLabels.includes(role));
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
