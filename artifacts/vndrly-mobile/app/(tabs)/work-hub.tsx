import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import WorkdayControls from "@/components/WorkdayControls";
import HomeDashboardTasks from "@/components/work-hub/HomeDashboardTasks";
import HomeCertificates from "@/components/work-hub/HomeCertificates";
import HomeWorkforce from "@/components/work-hub/HomeWorkforce";
import HomeTodayCard from "@/components/work-hub/HomeTodayCard";
import HomeCommunicationsCard from "@/components/work-hub/HomeCommunicationsCard";
import WorkHubHomeSearch from "@/components/work-hub/WorkHubHomeSearch";
import { useAccounts, useInboxCounts } from "@/components/work-hub/connector-client";
import { useGateCopy } from "@/components/gate/GateChrome";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { loadDailySources, myWorkItems, pendingSafety } from "@/lib/daily-workspace";
import type { NotificationRow } from "@/lib/notifications-ui";
import type { WorkHubCall } from "@/lib/notification-destination";

type Home = {
  tasks?: { id: string; title: string; status: string; dueAt?: string }[];
  shifts?: { shift: { id: string; title?: string; startsAt: string; endsAt: string; milestoneStatus?: string }; assignment?: { status?: string } }[];
  meetings?: { occurrence: { id: string; startsAt: string; endsAt: string; status?: string }; meeting?: { title?: string } }[];
  announcements?: { announcement: { urgency?: string; acknowledgementRequired?: boolean }; recipient?: { acknowledgedAt?: string } }[];
  capabilities?: { canViewExports?: boolean; allowedExportDatasets?: string[] };
};
type Channel = { id?: string; name?: string; contextKind: string; contextId?: string; unreadCount?: number };
type Poll = { id?: string; title?: string; kind: string };
const open = (path: string) => router.push(path as never);

/** Port of the web WorkHubHome, using its source endpoints and card structure. */
export default function WorkHubHome() {
  const c = useGateCopy();
  const { user, activeMembershipId } = useAuth();
  const { primary } = useColors();
  const [search, setSearch] = useState("");
  const [contentWidth, setContentWidth] = useState(0);
  const identity = [user?.id, activeMembershipId, user?.vendorId, user?.partnerId];
  const home = useQuery({ queryKey: ["work-hub", "home", ...identity], queryFn: () => apiFetch<Home>("/api/work-hub/home"), enabled: !!user, refetchInterval: 15000 });
  const channels = useQuery({ queryKey: ["work-hub", "channels", ...identity], queryFn: () => apiFetch<Channel[]>("/api/work-hub/channels"), enabled: !!user, refetchInterval: 15000 });
  const polls = useQuery({ queryKey: ["work-hub", "form-campaigns", ...identity], queryFn: () => apiFetch<{ campaigns: Poll[] }>("/api/work-hub/form-campaigns"), enabled: !!user, refetchInterval: 15000 });
  const calls = useQuery({ queryKey: ["work-hub", "calls", ...identity], queryFn: () => apiFetch<WorkHubCall[]>("/api/work-hub/calls"), enabled: !!user, refetchInterval: 15000 });
  const voicemail = useQuery({ queryKey: ["work-hub", "voicemail", ...identity], queryFn: () => apiFetch<{ id: string; senderName?: string; createdAt?: string }[]>("/api/work-hub/voicemail"), enabled: !!user, refetchInterval: 15000 });
  const commsMeetings = useQuery({ queryKey: ["work-hub", "comms-meetings", ...identity], queryFn: () => apiFetch<{ meetings: { item: { occurrence: { id: string; startsAt?: string }; meeting?: { title?: string } } }[] }>("/api/work-hub/calendar?kind=meetings&start=1970-01-01T00:00:00.000Z&end=2100-01-01T00:00:00.000Z"), enabled: !!user, refetchInterval: 60000 });
  const accounts = useAccounts();
  const emailAccounts = accounts.data?.accounts.filter(account => account.status === "connected" && ["gmail", "outlook"].includes(account.provider)) ?? [];
  const inbox = useInboxCounts(emailAccounts);
  const notices = useQuery({ queryKey: ["work-hub", "home-notices", ...identity], queryFn: () => apiFetch<NotificationRow[] | { items: NotificationRow[] }>("/api/notifications?limit=100"), enabled: !!user, refetchInterval: 30000 });
  const operations = useQuery({ queryKey: ["work-hub", "operations", ...identity], queryFn: () => apiFetch<{ categories: string[] }>("/api/company-operations"), enabled: !!user?.vendorId });
  const membershipAdmin = !!user?.availableMemberships?.some(membership => membership.id === activeMembershipId && membership.role === "admin");
  const canViewGateLog = user?.role === "admin" || user?.role === "partner" || user?.role === "vendor" && (membershipAdmin || user.vendorRole == null || ["office", "both"].includes(user.vendorRole));
  const gate = user?.managedSubcontractor ? user.managedSubcontractor.siteGrants.length > 0 : !!operations.data?.categories.includes("gate") && (["gatekeeper", "gate_supervisor"].includes(user?.vendorRole ?? "") || membershipAdmin || user?.role === "admin" || canViewGateLog);
  const sites = useQuery({ queryKey: ["work-hub", "gate-sites", ...identity], queryFn: () => apiFetch<{ sites: { id: number; name: string }[] }>("/api/gate-change-over/sites"), enabled: gate, retry: false, refetchInterval: 30000 });
  const daily = useQuery({
    queryKey: ["work-hub", "daily", ...identity, operations.data?.categories.join(",")],
    queryFn: () => loadDailySources(apiFetch, { field: operations.data?.categories.includes("field") ?? false, fleet: operations.data?.categories.includes("fleet") ?? false, userId: user!.id, vendorId: user?.vendorId, partnerId: user?.partnerId }),
    enabled: !!user && (!user.vendorId || !!operations.data),
    refetchInterval: 30000,
  });
  const s = daily.data;
  const now = Date.now();
  const activeTasks = home.data?.tasks?.filter(task => !["completed", "cancelled", "archived"].includes(task.status));
  const calendar = home.data ? [
    ...(home.data.shifts ?? []).filter(row => !["cancelled", "completed"].includes(row.shift.milestoneStatus ?? "") && !["cancelled", "declined"].includes(row.assignment?.status ?? "")).map(row => ({ at: row.shift.startsAt, end: row.shift.endsAt })),
    ...(home.data.meetings ?? []).filter(row => row.occurrence.status !== "cancelled").map(row => ({ at: row.occurrence.startsAt, end: row.occurrence.endsAt })),
    ...(activeTasks ?? []).filter(row => row.dueAt).map(row => ({ at: row.dueAt!, end: row.dueAt! })),
  ].filter(row => Date.parse(row.end ?? row.at) >= now) : undefined;
  const safety = s?.safety ? pendingSafety(s.safety) : [];
  const noticeRows = notices.data ? Array.isArray(notices.data) ? notices.data : notices.data.items : undefined;
  const attentionNotices = noticeRows?.filter(notice => notice.type !== "safety_event_closed" && (!notice.isRead || ["cert_expired", "cert_expiring", "safety_stop_work", "safety_event_hipo"].includes(notice.type)) && !safety.some(event => notice.link === `/safety/${event.id}`) && !(activeTasks ?? []).some(task => notice.link === `/work-hub/tasks/${task.id}` || notice.link === `/work-hub/tasks?task=${task.id}`));
  const announcements = home.data?.announcements?.filter(row => row.announcement.urgency === "urgent" || row.announcement.acknowledgementRequired && !row.recipient?.acknowledgedAt) ?? [];
  const attention = activeTasks && s?.safety && attentionNotices ? activeTasks.length + safety.length + attentionNotices.length + announcements.length : undefined;
  const work = s ? myWorkItems(s) : [];
  const workCount = s?.tasks && s.tickets && s.runs && (!gate || sites.isSuccess) ? work.length + (gate ? sites.data?.sites.length ?? 0 : 0) : undefined;
  const count = (number: number | undefined, word = c("items", "elementos")) => number === undefined ? c("Unavailable", "No disponible") : `${number} ${word}`;
  const item = (key: string, title: string, path: string, detail?: string) => ({ key, title, detail, onPress: () => open(path) });
  const calendarItems = [
    ...(home.data?.shifts ?? []).filter(row => Date.parse(row.shift.endsAt) >= now && !["cancelled", "completed"].includes(row.shift.milestoneStatus ?? "")).map(row => item(`shift:${row.shift.id}`, row.shift.title ?? c("Shift", "Turno"), "/work-hub/calendar", new Date(row.shift.startsAt).toLocaleString())),
    ...(home.data?.meetings ?? []).filter(row => Date.parse(row.occurrence.endsAt) >= now && row.occurrence.status !== "cancelled").map(row => item(`meeting:${row.occurrence.id}`, row.meeting?.title ?? c("Meeting", "Reunión"), "/work-hub/chat?view=meetings", new Date(row.occurrence.startsAt).toLocaleString())),
    ...(activeTasks ?? []).filter(row => row.dueAt).map(row => item(`due:${row.id}`, row.title, `/work-hub/record?kind=task&id=${encodeURIComponent(row.id)}`, new Date(row.dueAt!).toLocaleString())),
  ];
  const workItems = [...(gate ? sites.data?.sites.map(site => item(`site:${site.id}`, site.name, `/gate/change-over?siteId=${site.id}`)) ?? [] : []), ...work.map(row => item(`${row.kind}:${row.id}`, row.title, row.kind === "task" || row.kind === "shift" ? `/work-hub/record?kind=${row.kind}&id=${encodeURIComponent(row.id)}` : "/work-hub/my-work", row.status.replaceAll("_", " ")))];
  const safetyItems = safety.map(row => item(`safety:${row.id}`, row.title, `/safety-event/${row.id}`));
  const attentionItems = [...(activeTasks ?? []).map(row => item(`attention-task:${row.id}`, row.title, `/work-hub/record?kind=task&id=${encodeURIComponent(row.id)}`)), ...safetyItems, ...(attentionNotices ?? []).map(row => item(`notice:${row.id}`, row.title, row.link ?? "/notifications", row.body ?? undefined)), ...announcements.map((_, index) => item(`announcement:${index}`, c("Urgent announcement", "Anuncio urgente"), "/notifications"))];
  const callItems = [
    ...(voicemail.data ?? []).map(row => ({ key: `voicemail:${row.id}`, title: row.senderName ?? c("Unknown contact", "Contacto desconocido"), at: row.createdAt, detail: [c("Voicemail", "Buzón de voz"), row.createdAt ? new Date(row.createdAt).toLocaleString() : ""].filter(Boolean).join(" · ") })),
    ...(calls.data ?? []).map(row => ({ key: `call:${row.id}`, title: (row.incoming ? row.callerName : row.recipientName) || c("Unknown contact", "Contacto desconocido"), at: row.createdAt, detail: [row.incoming ? (["missed", "declined", "busy", "unavailable"].includes(row.status) ? c("Missed", "Perdida") : c("Incoming", "Entrante")) : c("Outgoing", "Saliente"), row.createdAt ? new Date(row.createdAt).toLocaleString() : ""].filter(Boolean).join(" · ") })),
  ].sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? ""));
  const managed = Boolean((user as typeof user & { managedSubcontractor?: unknown })?.managedSubcontractor);
  const cardWidth = contentWidth >= 736 ? (contentWidth - 56) / 2 : Math.max(0, contentWidth - 12);
  const homeRowWidth = contentWidth >= 736 ? cardWidth * 2 + 12 : cardWidth;
  const searchWidth = contentWidth >= 480 ? 320 : Math.max(0, homeRowWidth - 180);
  return <ScreenSafeArea><ScrollView keyboardShouldPersistTaps="handled" onLayout={event => setContentWidth(Math.max(0, event.nativeEvent.layout.width - 32))} contentContainerStyle={{ backgroundColor: "#3a3d42", padding: 16, paddingBottom: 32, gap: 18 }}>
    <View style={{ width: homeRowWidth }}><WorkHubPageTitle title="Work Hub" right={<WorkHubHomeSearch width={searchWidth} color={primary} label={c("Search Work Hub", "Buscar en Work Hub")} submitLabel={c("Submit search", "Enviar búsqueda")} value={search} onChangeText={setSearch} onSubmit={() => { if (search.trim().length >= 2) open(`/work-hub/search?q=${encodeURIComponent(search.trim())}`); }} />} /></View>
    <View style={{ width: homeRowWidth }}><WorkdayControls webCard /></View>
    {home.isError ? <Text accessibilityRole="alert" style={{ color: "#ececec" }}>{c("Work Hub summaries are unavailable. Open a row to check its records.", "Los resúmenes no están disponibles. Abra una fila para consultar sus registros.")}</Text> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
    <View style={{ width: cardWidth }}><HomeTodayCard title={c("Today", "Hoy")} subtitle={c("Your schedule, work, and priorities", "Su horario, trabajo y prioridades")} rows={[
      { key: "calendar", label: c("Calendar", "Calendario"), value: count(calendar?.length, c("upcoming", "próximos")), items: calendarItems, empty: c("No upcoming calendar items.", "No hay próximos eventos."), onViewAll: () => open("/work-hub/calendar") },
      { key: "work", label: managed ? c("My Hours", "Mis horas") : c("My Work", "Mi trabajo"), value: managed ? c("Open", "Abrir") : count(workCount), items: workItems, empty: c("No active work items.", "No hay trabajo activo."), onViewAll: () => open(managed ? "/work-hub/calendar" : "/work-hub/my-work") },
      { key: "attention", label: c("Needs Attention", "Requiere atención"), value: count(attention), items: attentionItems, empty: c("Nothing needs attention.", "Nada requiere atención."), onViewAll: () => open("/notifications") },
      { key: "safety", label: c("Safety", "Seguridad"), value: count(s?.safety ? safety.length : undefined), items: safetyItems, empty: c("No active safety items.", "No hay elementos de seguridad activos."), onViewAll: () => open("/safety") },
      { key: "tasks", label: c("Tasks & Crews", "Tareas y cuadrillas"), value: count(activeTasks?.length), items: (activeTasks ?? []).map(row => item(`task:${row.id}`, row.title, `/work-hub/record?kind=task&id=${encodeURIComponent(row.id)}`)), empty: c("No active tasks.", "No hay tareas activas."), onViewAll: () => open("/work-hub/managed-crews") },
    ]} /></View>
    <View style={{ width: cardWidth }}><HomeCommunicationsCard title={c("Communications", "Comunicaciones")} subtitle={c("Stay connected with multi-role communications", "Chats, llamadas y reuniones")} rows={[
      { key: "polls", label: c("Polls", "Encuestas"), value: String(polls.data?.campaigns.filter(row => row.kind === "poll").length ?? 0), items: polls.data?.campaigns.filter(row => row.kind === "poll").map((row, index) => item(`poll:${row.id ?? index}`, row.title ?? c("Poll", "Encuesta"), "/work-hub/chat?view=polls")), onViewAll: () => open("/work-hub/chat?view=polls") },
      { key: "channels", label: c("Channels", "Canales"), value: String(channels.data?.filter(row => row.contextKind !== "chat" || String(row.contextId ?? "").startsWith("group:")).length ?? 0), items: channels.data?.filter(row => row.contextKind !== "chat" || String(row.contextId ?? "").startsWith("group:")).map((row, index) => item(`channel:${row.id ?? index}`, row.name ?? c("Channel", "Canal"), "/work-hub/chat?view=channels", `${row.unreadCount ?? 0} unread`)), onViewAll: () => open("/work-hub/chat?view=channels") },
      { key: "chats", label: c("Chats", "Chats"), value: String(channels.data?.filter(row => row.contextKind === "chat" && !String(row.contextId ?? "").startsWith("group:")).length ?? 0), items: channels.data?.filter(row => row.contextKind === "chat" && !String(row.contextId ?? "").startsWith("group:")).map((row, index) => item(`chat:${row.id ?? index}`, row.name ?? c("Chat", "Chat"), "/work-hub/chat?view=chat", `${row.unreadCount ?? 0} unread`)), onViewAll: () => open("/work-hub/chat?view=chat") },
      { key: "calls", label: c("Calls", "Llamadas"), value: String(callItems.length), items: callItems.map(row => item(row.key, row.title, "/work-hub/chat?view=calls", row.detail)), onViewAll: () => open("/work-hub/chat?view=calls") },
      { key: "meetings", label: c("Meetings", "Reuniones"), value: String(commsMeetings.data?.meetings.length ?? 0), items: commsMeetings.data?.meetings.map(row => item(`meeting:${row.item.occurrence.id}`, row.item.meeting?.title ?? c("Meeting", "Reunión"), "/work-hub/chat?view=meetings", row.item.occurrence.startsAt ? new Date(row.item.occurrence.startsAt).toLocaleString() : undefined)), onViewAll: () => open("/work-hub/chat?view=meetings") },
      { key: "notifications", label: c("Notifications", "Notificaciones"), value: String(noticeRows?.length ?? 0), items: noticeRows?.map(row => item(`notification:${row.id}`, row.title, row.link ?? "/work-hub/chat?view=notifications", row.body ?? undefined)), onViewAll: () => open("/work-hub/chat?view=notifications") },
      { key: "emails", label: c("Emails", "Correos"), value: String(inbox.total ?? "…") },
      ...emailAccounts.map(account => ({ key: `email:${account.id}` as const, label: account.label, value: String(inbox.counts[account.id] ?? "…"), provider: account.provider, onPress: () => open(`/work-hub/chat?view=connected&accountId=${encodeURIComponent(account.id)}`) })),
    ]} /></View>
    {gate ? <View style={{ width: cardWidth }}><HomeWorkforce key={identity.join(":")} /></View> : null}
    <View style={{ width: cardWidth }}><HomeDashboardTasks webCard /></View>
    <View style={{ width: contentWidth >= 736 ? cardWidth * 2 + 12 : cardWidth }}><HomeCertificates /></View>
    </View>
  </ScrollView></ScreenSafeArea>;
}
