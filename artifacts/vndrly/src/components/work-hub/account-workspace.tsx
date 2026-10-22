import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { BriefcaseBusiness, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { fleetClient } from "@/lib/fleet-client";
import { isForemanPersona } from "@/lib/portal-base";
import { isWorkHubAdmin, isWorkHubScheduler, type WorkHubUser } from "@/lib/work-hub-client";
import { canViewGateLog } from "@/lib/gate-ops-nav";
import type { ManagedSubcontractor } from "@/lib/managed-subcontractor-access";

type Viewer = WorkHubUser & { managedSubcontractor?: ManagedSubcontractor };
export function canUseGateWorkspace(user: Viewer | null | undefined, categories: readonly string[]) {
  if (!user) return false;
  if (user.managedSubcontractor) return user.managedSubcontractor.siteGrants.length > 0;
  return categories.includes("gate") &&
    (["gatekeeper", "gate_supervisor"].includes(user.vendorRole ?? "") || isWorkHubAdmin(user) || canViewGateLog(user));
}

/** Navigation reflects current grants; each destination still enforces its own server permissions. */
export function AccountWorkspace({ categories = [] }: { categories?: readonly string[] }) {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const identity = `${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}`;
  const fleetAllowed = Boolean(user?.vendorId && !user.managedSubcontractor && categories.includes("fleet"));
  const fleet = useQuery({
    queryKey: ["fleet", identity],
    queryFn: fleetClient.overview,
    enabled: fleetAllowed,
    retry: false,
    staleTime: 30000,
  });
  if (!user) return null;
  const admin = isWorkHubAdmin(user);
  const gateWorker = Boolean(user.managedSubcontractor) || ["gatekeeper", "gate_supervisor"].includes(user.vendorRole ?? "");
  const fieldWorker = user.role === "field_employee" && !gateWorker;
  const office = user.role === "vendor" && !gateWorker && [null, "office", "both"].includes(user.vendorRole);
  type Action = { label: string; href: string };
  const cards: { title: string; subtitle: string; actions: Action[] }[] = [];
  if (user.role === "admin") cards.push({
    title: c("Platform workspace", "Espacio de la plataforma"),
    subtitle: c("Platform administration and oversight", "Administración y supervisión de la plataforma"),
    actions: [
      { label: c("Platform settings", "Ajustes de la plataforma"), href: "/admin/vndrly" },
      { label: c("Vendors", "Proveedores"), href: "/vendors" },
      { label: c("Partners", "Socios"), href: "/partners" },
      { label: c("Communications health", "Estado de las comunicaciones"), href: "/admin/communications-health" },
    ],
  });
  if (user.role === "partner") cards.push({
    title: c("Partner workspace", "Espacio del socio"),
    subtitle: c("Your sites and authorized work records", "Sus sitios y registros de trabajo autorizados"),
    actions: [
      { label: c("Site locations", "Ubicaciones de sitios"), href: "/site-locations" },
      { label: c("Site map", "Mapa de sitios"), href: "/site-map" },
      { label: c("Tracking & reviews", "Seguimiento y revisiones"), href: "/tickets" },
    ],
  });
  if (user.managedSubcontractor) cards.push({
    title: c("My hours", "Mis horas"),
    subtitle: c("Your assigned sites and recorded hours", "Sus sitios asignados y horas registradas"),
    actions: [{ label: c("My hours & calendar", "Mis horas y calendario"), href: "/work-hub/calendar" }],
  });
  if (categories.includes("field") && !gateWorker && (fieldWorker || office || admin)) {
    const foreman = isForemanPersona(user);
    cards.push({
      title: c(foreman ? "Crew workspace" : "Field workspace", foreman ? "Espacio de la cuadrilla" : "Espacio de campo"),
      subtitle: fieldWorker ? c("Your field assignments and schedule", "Sus asignaciones y horario de campo") : c("Your company's field operations", "Las operaciones de campo de su empresa"),
      actions: fieldWorker ? [
        { label: c("Assigned work", "Trabajo asignado"), href: foreman ? "/foreman" : "/field" },
        { label: c("Schedule", "Horario"), href: foreman ? "/foreman/schedule" : "/field/schedule" },
        { label: c("Compliance", "Cumplimiento"), href: foreman ? "/foreman/compliance" : "/field/compliance" },
      ] : [
        { label: c("Tracking", "Seguimiento"), href: "/tickets" },
        { label: c("Site locations", "Ubicaciones de sitios"), href: "/site-locations" },
        { label: c("Crew map", "Mapa de la cuadrilla"), href: "/crew-map" },
      ],
    });
  }
  const access = fleet.isSuccess && fleet.data.enabled ? fleet.data.capabilities : undefined;
  if (fleetAllowed && access) {
    const actions: Action[] = [];
    if (access.canDrive) actions.push({ label: c("My Fleet Day", "Mi día de flota"), href: "/fleet/my-day" });
    if (access.canDispatch || access.canManage) actions.push({ label: c("Dispatch desk", "Panel de despacho"), href: "/fleet" });
    if (access.canManageResources) actions.push({ label: c("Equipment", "Equipo"), href: "/fleet/equipment" });
    if (access.canDispatch || access.canManage) actions.push({ label: c("Run reviews", "Revisiones de recorridos"), href: "/fleet/review" });
    if (actions.length) cards.push({ title: c("Fleet workspace", "Espacio de flota"), subtitle: c("Your authorized Fleet work", "Su trabajo de flota autorizado"), actions });
  }
  if (user.vendorId && !user.managedSubcontractor && (admin || office || isWorkHubScheduler(user))) {
    const actions: Action[] = [];
    if (admin || office) actions.push({ label: c("Company profile", "Perfil de la empresa"), href: `/vendors/${user.vendorId}` });
    if (admin) actions.push({ label: c("Employees", "Empleados"), href: "/field-employees" });
    if (isWorkHubScheduler(user)) actions.push({ label: c("Scheduling & coverage", "Programación y cobertura"), href: "/work-hub/coverage" });
    if (actions.length) cards.push({ title: c("Company workspace", "Espacio de la empresa"), subtitle: c("Tools for your company role", "Herramientas para su función en la empresa"), actions });
  }
  return <>{cards.map(card => <section key={card.title} className="hub-home-card" aria-label={card.title}>
    <header className="hub-card-heading"><span className="hub-card-icon"><BriefcaseBusiness aria-hidden="true" /></span><div><h2>{card.title}</h2><p>{card.subtitle}</p></div></header>
    <div className="hub-account-rows">{card.actions.map(action => <Link className="hub-home-row" href={action.href} key={action.href}><span className="hub-row-label">{action.label}</span><ChevronRight aria-hidden="true" className="hub-chevron" /></Link>)}</div>
  </section>)}</>;
}
