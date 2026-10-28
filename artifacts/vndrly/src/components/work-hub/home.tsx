import LanguageToggle from "@/components/language-toggle";
import WorkdayControls from "@/components/workday-controls";
import WorkforcePanel from "./workforce-panel";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell, CalendarDays, Car, CheckCircle2, CheckSquare2, ChevronRight, Clock3, Download, Folder, MapPin, MessageCircle, MessageSquare, Phone, Search, Shield, Sun, Users, ClipboardList, Smartphone } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { workHubRequest } from "@/lib/work-hub-client";
import { changeOverRequest } from "@/lib/change-over-api";
import { visitsApi } from "@/lib/visits-api";
import { useDailyWork } from "./daily-workspace";
import { WorkHubPageHeading } from "./chrome";
import { AccountWorkspace, canUseGateWorkspace } from "./account-workspace";
import { WorkspacePanel as HomeCard, WorkspaceRow as HomeRow } from "./workspace-panel";
import DashboardTasks from "./dashboard-tasks";
import "./home.css";

type Row = Record<string, any>;
async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Work Hub source unavailable");
  return response.json();
}
/** Uses the same authenticated sources as the existing modules; no company-wide data is inferred. */
export function WorkHubHome() {
  const { user } = useAuth(), brand = useBrand(), { i18n } = useTranslation();
  const es = i18n.language.startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const qc = useQueryClient();
  const identity = [user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId];
  const [panel, setPanel] = useState<"work" | "safety" | null>(null);
  const home = useQuery<Row>({ queryKey: ["work-hub", "home", ...identity], queryFn: () => workHubRequest("/home"), enabled: !!user, refetchInterval: 15000 });
  const channels = useQuery<Row[]>({ queryKey: ["work-hub", "/channels", ...identity], queryFn: () => workHubRequest("/channels"), enabled: !!user, refetchInterval: 15000 });
  const operations = useQuery({ queryKey: ["work-hub-home-operations", ...identity], queryFn: () => read<{ categories: string[] }>("/api/company-operations"), enabled: !!user?.vendorId });
  const gate = canUseGateWorkspace(user, operations.data?.categories ?? []);
  const sites = useQuery({ queryKey: ["work-hub-home-gates", ...identity], queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites"), enabled: gate, retry: false, refetchInterval: 30000 });
  const visits = useQuery({ queryKey: ["work-hub-home-visits", ...identity], queryFn: () => visitsApi.list({ activeOnly: true, limit: 100 }), enabled: gate, retry: false, refetchInterval: 15000 });
  const notices = useQuery({ queryKey: ["work-hub-home-notices", ...identity], queryFn: () => read<Row[] | { items: Row[]; nextCursor?: string }>("/api/notifications?limit=100"), enabled: !!user, refetchInterval: 30000 });
  const { work, safety, pending } = useDailyWork();
  useEffect(() => { setPanel(null); }, [user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId]);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/work-hub/events", { withCredentials: true });
    source.onmessage = () => { void qc.invalidateQueries({ queryKey: ["work-hub"] }); void qc.invalidateQueries({ queryKey: ["daily-my-work"] }); };
    return () => source.close();
  }, [qc, ...identity]);

  const now = Date.now(), tasks: Row[] | undefined = home.data?.tasks;
  const activeTasks = tasks?.filter(row => !["completed", "cancelled", "archived"].includes(row.status));
  const calendar = home.data ? [
    ...(home.data.shifts ?? []).filter(({ shift, assignment }: Row) => !["cancelled", "completed"].includes(shift.milestoneStatus) && !["cancelled", "declined"].includes(assignment?.status)).map(({ shift }: Row) => ({ id: `shift-${shift.id}`, title: shift.title ?? c("Scheduled shift", "Turno programado"), at: shift.startsAt, end: shift.endsAt, href: "/work-hub/calendar" })),
    ...(home.data.meetings ?? []).filter(({ occurrence }: Row) => occurrence.status !== "cancelled").map(({ meeting, occurrence }: Row) => ({ id: `meeting-${occurrence.id}`, title: meeting?.title ?? c("Meeting", "Reunión"), at: occurrence.startsAt, end: occurrence.endsAt, href: `/work-hub/meetings?meeting=${encodeURIComponent(occurrence.id)}` })),
    ...(activeTasks ?? []).filter(task => task.dueAt).map(task => ({ id: `task-${task.id}`, title: task.title, at: task.dueAt, end: task.dueAt, href: `/work-hub/tasks?task=${encodeURIComponent(task.id)}` })),
  ].filter(item => Date.parse(item.end ?? item.at) >= now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : undefined;
  const noticeRows = notices.data ? Array.isArray(notices.data) ? notices.data : notices.data.items : undefined;
  const attentionNotices = noticeRows?.filter(n => n.type !== "safety_event_closed" && (!n.isRead || ["cert_expired", "cert_expiring", "safety_stop_work", "safety_event_hipo"].includes(n.type)) && !pending.some(event => n.link === `/safety/${event.id}`) && !(activeTasks ?? []).some(task => n.link === `/work-hub/tasks/${task.id}` || n.link === `/work-hub/tasks?task=${task.id}`));
  const openAnnouncements = home.data?.announcements?.filter(({ announcement, recipient }: Row) => announcement.urgency === "urgent" || announcement.acknowledgementRequired && !recipient?.acknowledgedAt) ?? [];
  const attentionCount = activeTasks && safety.isSuccess && attentionNotices ? activeTasks.length + pending.length + attentionNotices.length + openAnnouncements.length : undefined;
  const workCount = work.data && !work.data.unavailable.length && (!gate || sites.isSuccess) ? work.data.items.length + (gate ? sites.data?.sites.length ?? 0 : 0) : undefined;
  const unavailable = c("Unavailable", "No disponible"), count = (value?: number, suffix = c("items", "elementos")) => value === undefined ? unavailable : `${value} ${suffix}`;
  const toggle = (next: typeof panel) => setPanel(panel === next ? null : next);
  const unread = channels.data?.reduce((total, row) => total + Number(row.unreadCount ?? 0), 0);
  const utilities = [
    { label: c("Search", "Buscar"), icon: Search, href: "/work-hub/search" },
    { label: c("Files & Inventory", "Archivos e inventario"), icon: Folder, href: "/work-hub/files" },
    ...(home.data?.capabilities?.canViewExports && home.data.capabilities.allowedExportDatasets?.length ? [{ label: c("Exports", "Exportaciones"), icon: Download, href: "/work-hub/implementation-exports" }] : []),
    { label: c("Site Presence", "Presencia en el sitio"), icon: MapPin, href: "/work-hub/site-presence" },
  ];

  return <section className="work-hub-home" aria-label="Work Hub workspace" data-testid="work-hub-activity">
    <WorkHubPageHeading module="activity" title="Work Hub" backFallbackHref="/" compact actions={<LanguageToggle />} />
    <WorkdayControls />
    {home.isPending && <p role="status">{c("Loading Work Hub…", "Cargando Work Hub…")}</p>}
    {home.isError && <p role="alert">{c("Work Hub summaries are unavailable. Open a row to check its records.", "Los resúmenes no están disponibles. Abra una fila para consultar sus registros.")}</p>}
    <div className="hub-home-columns">
      <HomeCard title={c("Today", "Hoy")} subtitle={c("Your schedule, work, and priorities", "Su horario, trabajo y prioridades")} icon={Sun}>
        <HomeRow icon={CalendarDays} label={c("Calendar", "Calendario")} value={count(calendar?.length, c("upcoming", "próximos"))} href="/work-hub/calendar" />
        <HomeRow icon={Clock3} label={user?.managedSubcontractor ? c("My Hours", "Mis horas") : c("My Work", "Mi trabajo")} value={user?.managedSubcontractor ? c("Open", "Abrir") : count(workCount)} href={user?.managedSubcontractor ? "/work-hub/calendar" : undefined} onClick={() => toggle("work")} expanded={user?.managedSubcontractor ? undefined : panel === "work"} />
        <HomeRow icon={Bell} label={c("Needs Attention", "Requiere atención")} value={count(attentionCount)} href="/notifications" />
        <HomeRow icon={Shield} label={c("Safety", "Seguridad")} value={count(safety.isSuccess ? pending.length : undefined)} onClick={() => toggle("safety")} expanded={panel === "safety"} />
        <HomeRow icon={CheckSquare2} label={c("Tasks & Forms", "Tareas y formularios")} value={count(activeTasks?.length)} href="/work-hub/tasks" />
      </HomeCard>
      <HomeCard title={c("Communications", "Comunicaciones")} subtitle={c("Chats, calls, and meetings", "Chats, llamadas y reuniones")} icon={MessageCircle}>
        <HomeRow icon={MessageSquare} label={c("Chats", "Chats")} value={count(unread, c("unread", "sin leer"))} href="/work-hub/chat" />
        <HomeRow icon={Phone} label={c("Calls", "Llamadas")} value={c("Recent", "Recientes")} href="/work-hub/calls" />
        <HomeRow icon={CalendarDays} label={c("Meetings", "Reuniones")} value={count(home.data?.meetings?.filter(({ occurrence }: Row) => occurrence.status !== "cancelled" && Date.parse(occurrence.endsAt ?? occurrence.startsAt) >= now).length, c("upcoming", "próximas"))} href="/work-hub/meetings" />
      </HomeCard>
      {gate && <WorkforcePanel />}
      <DashboardTasks />
    </div>
    <section aria-label={c("More tools", "Más herramientas")}><h2 className="hub-tools-title">{c("More tools", "Más herramientas")}</h2><div className="hub-home-tools">{utilities.map(({ label, icon: Icon, href }) => <Link className="hub-tool" href={href} key={href}><Icon aria-hidden="true" />{label}</Link>)}</div></section>
    {panel === "work" && <section className="hub-home-card hub-detail" aria-label={c("My Work", "Mi trabajo")}><h2>{c("My Work", "Mi trabajo")}</h2>
      {work.isPending && <p role="status">{c("Loading your work…", "Cargando su trabajo…")}</p>}
      {(work.isError || work.data?.unavailable.length || gate && sites.isError) ? <p role="status">{c("Some work sources are unavailable. This list may be incomplete.", "Algunas fuentes no están disponibles. La lista puede estar incompleta.")}</p> : null}
      {gate && sites.data?.sites.map(site => <Link className="hub-record" href={`/gate/change-over?siteId=${site.id}`} key={`site:${site.id}`}><MapPin aria-hidden="true" />{site.name}<ChevronRight aria-hidden="true" /></Link>)}
      {work.data?.items.map(item => <Link className="hub-record" key={item.id} href={item.href}><Clock3 aria-hidden="true" /><span>{item.title}<small>{item.status.replaceAll("_", " ")}</small></span><ChevronRight aria-hidden="true" /></Link>)}
      {workCount === 0 && <p>{c("No active work in returned records.", "No hay trabajo activo en los registros recibidos.")}</p>}
    </section>}
    {panel === "safety" && <section className="hub-home-card hub-detail" aria-label="Safety needs attention"><h2>{c("Safety", "Seguridad")}</h2>{safety.isSuccess ? pending.length ? pending.map(row => <Link className="hub-record" href={`/safety/${row.id}`} key={row.id}><Shield aria-hidden="true" />{row.title}<ChevronRight aria-hidden="true" /></Link>) : <p>{c("No active safety events in returned records.", "No hay eventos de seguridad activos en los registros recibidos.")}</p> : <p role="status">{unavailable}</p>}<Link href="/safety" className="hub-text-link">{c("Open all safety records", "Abrir todos los registros de seguridad")}</Link></section>}
    <section className="hub-web-extras" aria-label="More from Work Hub"><h2>{c("More from Work Hub", "Más de Work Hub")}</h2>
    <AccountWorkspace categories={operations.data?.categories} />
    {gate && <HomeCard title={c("Gate desk", "Puesto de acceso")} subtitle={c("Your gates, visitors, and shift handoffs", "Sus accesos, visitantes y relevos de turno")} icon={Shield}>
      <div className="hub-gate-rows">
        <HomeRow icon={MapPin} label={c("Assigned sites", "Sitios asignados")} value={count(sites.isSuccess ? sites.data.sites.length : undefined)} onClick={() => toggle("work")} expanded={panel === "work"} />
        <HomeRow icon={Car} label={c("Visitors & vehicles", "Visitantes y vehículos")} value={visits.isSuccess ? `${visits.data.length}${visits.data.length === 100 ? "+" : ""} ${c("open records", "registros abiertos")}` : unavailable} href={user?.role === "field_employee" || user?.vendorRole === "gatekeeper" ? "/gate" : "/gate-log"} />
        <HomeRow icon={ClipboardList} label={c("Shift handoff", "Relevo de turno")} value={c("Open", "Abrir")} href="/gate/change-over" />
      </div>
    </HomeCard>}
    <div className="hub-home-tools"><Link className="hub-tool" href="/work-hub/channels"><Users aria-hidden="true" />{brand.name} {c("Groups", "Grupos")}</Link><Link className="hub-tool" href="/work-hub/native-work"><Smartphone aria-hidden="true" />{c("Work phone & on-call", "Teléfono y guardia")}</Link></div>
    </section>
  </section>;
}
