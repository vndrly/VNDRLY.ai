import type { StoredUser } from "./auth";
import { canShowWorkforce } from "./workforce-offer-client";
import { crewMapTabVisible, isForemanEmployeeUser } from "./mobile-viewer";
export type NativeWorkspace = { title: string; subtitle: string; actions: { label: string; href: string }[] };
type Membership = { orgType?: string; orgId?: number; role?: string };
type FleetAccess = { companyId: number; enabled: boolean; capabilities: { canDrive?: boolean; canDispatch?: boolean; canManage?: boolean; canManageResources?: boolean; canReview?: boolean } };
export function nativeAccountWorkspaces(user: StoredUser, categories: readonly string[], membership?: Membership | null, fleet?: FleetAccess, c: (en: string, es: string) => string = en => en): NativeWorkspace[] {
  const cards: NativeWorkspace[] = [];
  if (membership?.orgType === "vendor" && membership.orgId != null && membership.orgId !== user.vendorId) return cards;
  const admin = user.role === "admin" || membership?.role === "admin";
  const gateWorker = !!user.managedSubcontractor || ["gatekeeper", "gate_supervisor"].includes(user.vendorRole ?? "");
  const fieldWorker = user.role === "field_employee" && !gateWorker;
  const office = user.role === "vendor" && !gateWorker && [null, "office", "both"].includes(user.vendorRole ?? null);
  if (user.role === "partner" || membership?.orgType === "partner") return [{ title: c("Partner workspace", "Espacio del socio"), subtitle: c("Your authorized work records", "Sus registros de trabajo autorizados"), actions: [{ label: c("Tracking & reviews", "Seguimiento y revisiones"), href: "/(tabs)" }, { label: c("Site map", "Mapa de sitios"), href: "/(tabs)/crew-map" }] }];
  if (user.managedSubcontractor) cards.push({ title: c("My hours", "Mis horas"), subtitle: c("Your assigned sites and recorded hours", "Sus sitios asignados y horas registradas"), actions: [{ label: c("My hours & calendar", "Mis horas y calendario"), href: "/work-hub/calendar" }] });
  if (categories.includes("field") && !gateWorker && (fieldWorker || office || admin)) {
    const foreman = isForemanEmployeeUser(user);
    cards.push({ title: foreman ? c("Crew workspace", "Espacio de la cuadrilla") : c("Field workspace", "Espacio de campo"), subtitle: fieldWorker ? c("Your field assignments and schedule", "Sus asignaciones y horario de campo") : c("Your company's field operations", "Las operaciones de campo de su empresa"), actions: fieldWorker ? [{ label: c("Assigned work", "Trabajo asignado"), href: "/(tabs)" }, { label: c("Schedule", "Horario"), href: "/work-hub/calendar" }, { label: c("Compliance", "Cumplimiento"), href: "/compliance" }] : [{ label: c("Tracking", "Seguimiento"), href: "/(tabs)" }, ...(crewMapTabVisible(user) ? [{ label: c("Crew map", "Mapa de la cuadrilla"), href: "/(tabs)/crew-map" }] : [])] });
  }
  if (user.vendorId && membership?.orgType !== "partner" && !user.managedSubcontractor && categories.includes("fleet") && fleet?.enabled && fleet.companyId === user.vendorId) {
    const capabilities = fleet.capabilities, actions: NativeWorkspace["actions"] = [];
    if (capabilities.canDrive) actions.push({ label: c("My Fleet Day", "Mi día de flota"), href: "/(tabs)/fleet?module=driver" });
    if (capabilities.canDispatch || capabilities.canManage) actions.push({ label: c("Dispatch desk", "Panel de despacho"), href: "/(tabs)/fleet?module=dispatch" });
    if (capabilities.canManageResources) actions.push({ label: c("Equipment", "Equipo"), href: "/(tabs)/fleet?module=assets" });
    if (capabilities.canDispatch || capabilities.canManage || capabilities.canReview) actions.push({ label: c("Run reviews", "Revisiones de recorridos"), href: "/(tabs)/fleet?module=office" });
    if (actions.length) cards.push({ title: c("Fleet workspace", "Espacio de flota"), subtitle: c("Your authorized Fleet work", "Su trabajo de flota autorizado"), actions });
  }
  if (canShowWorkforce(user, categories, membership)) cards.push({ title: c("Gate workspace", "Espacio de acceso"), subtitle: c("Your gates and shift handoffs", "Sus accesos y relevos de turno"), actions: [{ label: c("Gate desk", "Puesto de acceso"), href: "/(tabs)/gate" }, { label: c("Change Over", "Relevo de turno"), href: "/(tabs)/change-over" }, { label: c("Shift Notes", "Notas de turno"), href: "/(tabs)/shift-notes" }] });
  if (user.vendorId && !user.managedSubcontractor && (admin || office || user.vendorRole === "gate_supervisor")) {
    const actions: NativeWorkspace["actions"] = [];
    if (admin) actions.push({ label: c("Employees", "Empleados"), href: "/employees" });
    if (admin || user.vendorRole === "gate_supervisor") actions.push({ label: c("Scheduling & coverage", "Programación y cobertura"), href: "/work-hub/calendar" });
    if (admin) actions.push({ label: c("Company operations", "Operaciones de la empresa"), href: "/company-operations" });
    if (actions.length) cards.push({ title: c("Company workspace", "Espacio de la empresa"), subtitle: c("Tools for your company role", "Herramientas para su función en la empresa"), actions });
  }
  return cards;
}
