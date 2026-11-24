import { useAccounts, useInboxCounts } from "./connector-client";
import { usePollCampaigns } from "./polls";
import { ProviderLogo } from "./provider-logo";
import { WorkspaceDisclosure } from "./workspace-panel";
import { VndrlyUWordmark } from "./vndrly-u-wordmark";
import { CertificationProgress, TrainingCompletionTotal } from "./repository-certifications";
import { Mail, Hash, ClipboardList, GraduationCap } from "lucide-react";
import WorkdayControls from "@/components/workday-controls";
import WorkforcePanel from "./workforce-panel";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell, CalendarDays, CheckSquare2, Clock3, MessageCircle, MessageSquare, Phone, Search, Shield, Sun } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { changeOverRequest } from "@/lib/change-over-api";
import { useDailyWork } from "./daily-workspace";
import { WorkHubMiniCardButton, WorkHubPageHeading } from "./chrome";
import { canUseGateWorkspace } from "./account-workspace";
import { WorkspacePanel as HomeCard } from "./workspace-panel";
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
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = i18n.language.startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const identity = [user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId];
  const home = useQuery<Row>({ queryKey: ["work-hub", "home", ...identity], queryFn: () => workHubRequest("/home"), enabled: !!user, refetchInterval: 15000 });
  const channels = useQuery<Row[]>({ queryKey: ["work-hub", "/channels", ...identity], queryFn: () => workHubRequest("/channels"), enabled: !!user, refetchInterval: 15000 });
  const operations = useQuery({ queryKey: ["work-hub-home-operations", ...identity], queryFn: () => read<{ categories: string[] }>("/api/company-operations"), enabled: !!user?.vendorId });
  const gate = canUseGateWorkspace(user, operations.data?.categories ?? []);
  const sites = useQuery({ queryKey: ["work-hub-home-gates", ...identity], queryFn: () => changeOverRequest<{ sites: { id: number; name: string }[] }>("/sites"), enabled: gate, retry: false, refetchInterval: 30000 });
  const notices = useQuery({ queryKey: ["work-hub-home-notices", ...identity], queryFn: () => read<Row[] | { items: Row[]; nextCursor?: string }>("/api/notifications?limit=100"), enabled: !!user, refetchInterval: 30000 });
  const { work, safety, pending } = useDailyWork();
  const accounts = useAccounts();
  const emailAccounts = accounts.data?.accounts.filter(account => account.status === "connected" && ["gmail", "outlook"].includes(account.provider)) ?? [];
  const inbox = useInboxCounts(emailAccounts);
  const calls = useQuery<Row[]>({ queryKey: ["work-hub", "calls", ...identity], queryFn: () => workHubRequest("/calls"), enabled: !!user, refetchInterval: 30000 });
  const voicemail = useQuery<Row[]>({ queryKey: ["work-hub", "voicemail", ...identity], queryFn: () => workHubRequest("/voicemail"), enabled: !!user, refetchInterval: 30000 });
  const polls = usePollCampaigns();

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
    ...(home.data.meetings ?? []).filter(({ occurrence }: Row) => occurrence.status !== "cancelled").map(({ meeting, occurrence }: Row) => ({ id: `meeting-${occurrence.id}`, title: meeting?.title ?? c("Meeting", "Reunión"), at: occurrence.startsAt, end: occurrence.endsAt, href: `/work-hub/chat?view=meetings&meeting=${encodeURIComponent(occurrence.id)}` })),
    ...(activeTasks ?? []).filter(task => task.dueAt).map(task => ({ id: `task-${task.id}`, title: task.title, at: task.dueAt, end: task.dueAt, href: `/work-hub/tasks?task=${encodeURIComponent(task.id)}` })),
  ].filter(item => Date.parse(item.end ?? item.at) >= now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : undefined;
  const noticeRows = notices.data ? Array.isArray(notices.data) ? notices.data : notices.data.items : undefined;
  const attentionNotices = noticeRows?.filter(n => n.type !== "safety_event_closed" && (!n.isRead || ["cert_expired", "cert_expiring", "safety_stop_work", "safety_event_hipo"].includes(n.type)) && !pending.some(event => n.link === `/safety/${event.id}`) && !(activeTasks ?? []).some(task => n.link === `/work-hub/tasks/${task.id}` || n.link === `/work-hub/tasks?task=${task.id}`));
  const openAnnouncements = home.data?.announcements?.filter(({ announcement, recipient }: Row) => announcement.urgency === "urgent" || announcement.acknowledgementRequired && !recipient?.acknowledgedAt) ?? [];
  const attentionCount = activeTasks && safety.isSuccess && attentionNotices ? activeTasks.length + pending.length + attentionNotices.length + openAnnouncements.length : undefined;
  const workCount = work.data && !work.data.unavailable.length && (!gate || sites.isSuccess) ? work.data.items.length + (gate ? sites.data?.sites.length ?? 0 : 0) : undefined;
  const unavailable = c("Unavailable", "No disponible"), count = (value?: number, suffix = c("items", "elementos")) => value === undefined ? unavailable : `${value} ${suffix}`;

  return <section className="work-hub-home" aria-label="Work Hub workspace" data-testid="work-hub-activity">
    <WorkHubPageHeading module="activity" title="Work Hub" backFallbackHref="/" compact actions={
      <form className="hub-home-search" role="search" onSubmit={event=>{event.preventDefault();const q=searchQuery.trim();if(q.length>=2)navigate(`/work-hub/search?q=${encodeURIComponent(q)}`);}}>
        <input type="search" aria-label={c("Search Work Hub", "Buscar en Work Hub")} placeholder={c("Search Work Hub", "Buscar en Work Hub")} value={searchQuery} onChange={event=>setSearchQuery(event.target.value)} minLength={2} required />
        <WorkHubMiniCardButton type="submit" aria-label={c("Submit search", "Enviar búsqueda")}><Search aria-hidden="true" /></WorkHubMiniCardButton>
      </form>
    } />
    <WorkdayControls />
    {home.isError && <p role="alert">{c("Work Hub summaries are unavailable. Open a row to check its records.", "Los resúmenes no están disponibles. Abra una fila para consultar sus registros.")}</p>}
    <div className="hub-home-columns" key={JSON.stringify(identity)}>

      <HomeCard title={c("Today", "Hoy")} subtitle={c("Your schedule, work, and priorities", "Su horario, trabajo y prioridades")} icon={Sun}>
        <WorkspaceDisclosure icon={CalendarDays} label={c("Calendar", "Calendario")} value={count(calendar?.length)}>
          {calendar?.map(item => <Link className="hub-record" key={item.id} href={item.href}>{item.title}</Link>)}
          {calendar?.length === 0 && <p>{c("No upcoming calendar items.", "No hay próximos eventos.")}</p>}
        </WorkspaceDisclosure>
        <WorkspaceDisclosure icon={Clock3} label={c("My Work", "Mi trabajo")} value={count(workCount)}>
          {(work.isError || work.data?.unavailable.length || gate && sites.isError) ? <p role="status">{c("Some work sources are unavailable. This list may be incomplete.", "Algunas fuentes no están disponibles. La lista puede estar incompleta.")}</p> : null}
          {work.data?.items.map(item => <Link className="hub-record" key={item.id} href={item.href}>{item.title}</Link>)}
          {gate && sites.data?.sites.map(site => <Link className="hub-record" key={site.id} href={`/gate/change-over?siteId=${site.id}`}>{site.name}</Link>)}
          {workCount === 0 && <p>{c("No active work items.", "No hay trabajo activo.")}</p>}
        </WorkspaceDisclosure>
        <WorkspaceDisclosure icon={Bell} label={c("Needs Attention", "Requiere atención")} value={count(attentionCount)}>
          {activeTasks?.map(task => <Link className="hub-record" key={task.id} href={`/work-hub/tasks?task=${task.id}`}>{task.title}</Link>)}
          {attentionNotices?.map(notice => <Link className="hub-record" key={notice.id} href={notice.link || "/work-hub/chat?view=notifications"}>{notice.title}</Link>)}
          {pending.map(row => <Link className="hub-record" key={row.id} href={`/safety/${row.id}`}>{row.title}</Link>)}
          {openAnnouncements.map(({ announcement }: Row) => <p className="hub-record" key={announcement.id}>{announcement.title}</p>)}
          {attentionCount === 0 && <p>{c("Nothing needs attention.", "Nada requiere atención.")}</p>}
        </WorkspaceDisclosure>
        <WorkspaceDisclosure icon={Shield} label={c("Safety", "Seguridad")} value={count(safety.isSuccess ? pending.length : undefined)}>
          {pending.map(row => <Link className="hub-record" key={row.id} href={`/safety/${row.id}`}>{row.title}</Link>)}
          {safety.isSuccess && !pending.length && <p>{c("No active safety items.", "No hay elementos de seguridad activos.")}</p>}
        </WorkspaceDisclosure>
        <WorkspaceDisclosure icon={CheckSquare2} label={c("Tasks & Crews", "Tareas y cuadrillas")} value={count(activeTasks?.length)}>
          {activeTasks?.map(task => <Link className="hub-record" key={task.id} href={`/work-hub/tasks?task=${task.id}`}>{task.title}</Link>)}
          {activeTasks?.length === 0 && <p>{c("No active tasks.", "No hay tareas activas.")}</p>}
        </WorkspaceDisclosure>
      </HomeCard>
      <HomeCard title={c("Communications", "Comunicaciones")} subtitle={c("Stay connected with multi-role communications", "Manténgase conectado con comunicaciones entre roles")} icon={MessageCircle}>
        {[
          { key: "polls", label: c("Polls", "Encuestas"), icon: ClipboardList, rows: polls.polls ?? (!user?.vendorId && !user?.partnerId ? [] : undefined) },
          { key: "channels", label: c("Channels", "Canales"), icon: Hash, rows: channels.data?.filter(row => row.contextKind !== "chat" || String(row.contextId ?? "").startsWith("group:")) },
          { key: "chat", label: c("Chats", "Chats"), icon: MessageSquare, rows: channels.data?.filter(row => row.contextKind === "chat" && !String(row.contextId ?? "").startsWith("group:")) },
          { key: "calls", label: c("Calls", "Llamadas"), icon: Phone, rows: calls.data ? [...calls.data, ...(voicemail.data ?? [])].map(row => ({ ...row, title: row.recipientName || row.callerName || row.senderName || row.participants?.map((person: Row) => person.displayName).filter(Boolean).join(", ") || c("Call", "Llamada") })) : undefined },
          { key: "meetings", label: c("Meetings", "Reuniones"), icon: CalendarDays, rows: home.data?.meetings?.map(({ meeting, occurrence }: Row) => ({ id: occurrence.id, title: meeting?.title })) as Row[] | undefined },
          { key: "notifications", label: c("Notifications", "Notificaciones"), icon: Bell, rows: noticeRows },
        ].map(({ key, label, icon, rows }) => <WorkspaceDisclosure key={key} icon={icon} label={label} value={rows ? String(rows.length) : "…"}>
          {rows?.map((row: Row, index) => <Link className="hub-record" key={row.id ?? index} href={`/work-hub/chat?view=${key}${["chat", "channels"].includes(key) ? `&channel=${encodeURIComponent(row.id)}` : ""}`}>{row.title || row.name || label}</Link>)}
          {rows?.length === 0 && <p>{c("No items.", "No hay elementos.")}</p>}
          <Link className="hub-text-link" href={`/work-hub/chat?view=${key}`}>{c("View all", "Ver todos")} {label}</Link>
        </WorkspaceDisclosure>)}
        <WorkspaceDisclosure icon={Mail} label={c("Emails", "Correos")} value={String(inbox.total ?? "…")}>
          {emailAccounts.map(account => <Link className="hub-home-row" key={account.id} href={`/work-hub/chat?view=connected&accountId=${encodeURIComponent(account.id)}`}><ProviderLogo provider={account.provider} /><span className="hub-row-label">{account.label}</span><span className="hub-row-value">{inbox.counts[account.id] ?? "…"}</span></Link>)}
        </WorkspaceDisclosure>
      </HomeCard>
      {gate && <WorkforcePanel summaryOnly />}
      <DashboardTasks />
      <HomeCard className="hub-certificates" title="VNDRLY/U Certificates" titleContent={<VndrlyUWordmark />} subtitle="Your certificates and assigned courses" icon={GraduationCap} actions={<TrainingCompletionTotal />}>
        <div className="hub-training-content">
          <CertificationProgress embedded />
        </div>
      </HomeCard>
    </div>

  </section>;
}
