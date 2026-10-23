import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope } from "@/lib/auth";
import TogglePillButton from "./TogglePillButton";
import WorkHubConversation from "./WorkHubConversation";

type RecordItem = {
  id: string; title: string; startsAt?: string | null; endsAt?: string | null;
  dueAt?: string | null; timezone?: string | null; status?: string;
  urgent?: boolean; priority?: string; calendarType?: string; projectName?: string;
  milestoneStatus?: string; percentComplete?: number; ownerDisplayName?: string | null;
  instructions?: string | null; dependencyTitle?: string | null; blockers?: string | null;
};
type Home = {
  shifts?: { shift: RecordItem; assignment: { status: string } }[];
  meetings?: { occurrence: RecordItem; meeting: { title: string; timezone?: string } }[];
  tasks?: RecordItem[];
};
type Channel = { id: string; name: string; unreadCount: number; updatedAt: string; continuationCursor?: string };
type Range = "next" | "week" | "month";
type SummaryItem = { id: string; title: string; detail: string; timestamp?: number; route: string };
const DAY = 86400000;
const urgent = (item: RecordItem) => item.urgent || ["urgent", "high"].includes(item.priority ?? "");

// Each request still passes through apiFetch's current-session guard. Pagination
// prevents an apparently exact unread total from silently dropping later pages.
async function channels(signal: AbortSignal) {
  const result: Channel[] = [], seen = new Set<string>();
  const scope = captureAuthScope();
  let cursor = "";
  while (true) {
    const page = await apiFetch<Channel[]>(`/api/work-hub/channels?limit=100${cursor}`, { signal }, scope);
    result.push(...page);
    if (page.length < 100) return result;
    const last = page[page.length - 1];
    const next = last.continuationCursor ? `&cursor=${encodeURIComponent(last.continuationCursor)}` : `&before=${encodeURIComponent(last.updatedAt)}&beforeId=${encodeURIComponent(last.id)}`;
    if (seen.has(next)) throw new Error("Channel pagination did not advance.");
    seen.add(next); cursor = next;
  }
}

export default function CalendarOverview({ initialDate, children }: { initialDate?: Date; children?: React.ReactNode }) {
  const { user, activeMembershipId } = useAuth();
  return <Overview key={`${user?.id}:${activeMembershipId}:${user?.vendorId}:${user?.partnerId}:${captureAuthScope().generation}`} initialDate={initialDate}>{children}</Overview>;
}

function Overview({ initialDate, children }: { initialDate?: Date; children?: React.ReactNode }) {
  const colors = useColors(), router = useRouter(), { user, activeMembershipId } = useAuth();
  const { i18n } = useTranslation();
  const es = (i18n.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  function when(value?: string | null, timezone?: string | null) {
    if (!value || !Number.isFinite(Date.parse(value))) return c("No date", "Sin fecha");
    try { return new Date(value).toLocaleString(es ? "es" : undefined, timezone ? { timeZone: timezone } : undefined) + (timezone ? ` · ${timezone}` : ""); }
    catch { return new Date(value).toLocaleString(es ? "es" : undefined); }
  }
  const status = (value: string) => es ? ({ open: "abierta", pending: "pendiente", upcoming: "próximo", in_progress: "en curso", completed: "completado", blocked: "bloqueado", cancelled: "cancelado", on_track: "según lo previsto", at_risk: "en riesgo", delayed: "retrasado" } as Record<string, string>)[value] ?? value.replaceAll("_", " ") : value.replaceAll("_", " ");
  const [start] = useState(() => initialDate ?? new Date());
  const [open, setOpen] = useState<string | null>(null);
  const [ranges, setRanges] = useState<Record<string, Range>>({});
  const [projectDays, setProjectDays] = useState(90);
  const [preview, setPreview] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Channel | null>(null);
  const now = start.getTime(), scope = [user?.id, activeMembershipId, user?.vendorId, user?.partnerId, captureAuthScope().generation];
  const home = useQuery({ queryKey: ["calendar-overview", "assigned", ...scope], enabled: !!user, queryFn: ({ signal }) => apiFetch<Home>("/api/work-hub/home", { signal }) });
  const conversations = useQuery({ queryKey: ["calendar-overview", "channels", ...scope], enabled: !!user, queryFn: ({ signal }) => channels(signal) });
  const projects = useQuery({ queryKey: ["calendar-overview", "projects", ...scope, start.toISOString()], enabled: !!user, queryFn: ({ signal }) => apiFetch<{ shifts?: { item: RecordItem }[] }>(`/api/work-hub/calendar?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(new Date(now + 90 * DAY).toISOString())}`, { signal }) });
  const assigned = (home.data?.shifts ?? [])
    .filter(({ shift, assignment }) => !["cancelled", "declined"].includes(assignment.status) && shift.calendarType !== "project" && Date.parse(shift.startsAt ?? "") >= now)
    .map(({ shift }) => shift).sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
  const meetings = (home.data?.meetings ?? [])
    .filter(({ occurrence }) => !["cancelled", "ended"].includes(occurrence.status ?? "") && Date.parse(occurrence.startsAt ?? "") >= now)
    .sort((a, b) => Date.parse(a.occurrence.startsAt!) - Date.parse(b.occurrence.startsAt!));
  const tasks = (home.data?.tasks ?? [])
    .filter(item => !["completed", "cancelled", "archived"].includes(item.status ?? ""))
    .sort((a, b) => Number(urgent(b)) - Number(urgent(a)) || (Date.parse(a.dueAt ?? "") || Infinity) - (Date.parse(b.dueAt ?? "") || Infinity));
  const unread = (conversations.data ?? []).filter(item => Number(item.unreadCount) > 0);
  const summaries: { key: string; title: string; value: string; detail: string; route: string; items: SummaryItem[] }[] = [
    { key: "shift", title: c("My next shift", "Mi próximo turno"), value: assigned[0]?.title ?? c("Nothing scheduled", "Sin programación"), detail: assigned[0] ? when(assigned[0].startsAt, assigned[0].timezone) : c("No upcoming assigned shifts", "No hay próximos turnos asignados"), route: "/work-hub/my-work", items: assigned.map(item => ({ id: item.id, title: item.title, detail: `${when(item.startsAt, item.timezone)} – ${when(item.endsAt, item.timezone)}`, timestamp: Date.parse(item.startsAt!), route: `/work-hub/record?kind=shift&id=${encodeURIComponent(item.id)}` })) },
    { key: "meeting", title: c("Next meeting", "Próxima reunión"), value: meetings[0]?.meeting.title ?? c("Nothing scheduled", "Sin programación"), detail: meetings[0] ? when(meetings[0].occurrence.startsAt, meetings[0].meeting.timezone) : c("No upcoming meetings", "No hay próximas reuniones"), route: "/work-hub/meetings", items: meetings.map(({ occurrence, meeting }) => ({ id: occurrence.id, title: meeting.title, detail: when(occurrence.startsAt, occurrence.timezone ?? meeting.timezone), timestamp: Date.parse(occurrence.startsAt!), route: `/work-hub/meeting/${encodeURIComponent(occurrence.id)}` })) },
    { key: "task", title: c("Tasks due soon", "Tareas próximas a vencer"), value: tasks[0]?.title ?? c("No task due", "Sin tareas pendientes"), detail: tasks[0] ? when(tasks[0].dueAt) : c("No open assigned tasks", "No hay tareas asignadas abiertas"), route: "/work-hub/tasks-forms", items: tasks.map(item => ({ id: item.id, title: item.title, detail: `${urgent(item) ? c("Urgent · ", "Urgente · ") : ""}${when(item.dueAt)} · ${status(item.status ?? "open")}`, timestamp: item.dueAt ? Date.parse(item.dueAt) : undefined, route: `/work-hub/record?kind=task&id=${encodeURIComponent(item.id)}` })) },
    { key: "messages", title: c("Unread conversations", "Conversaciones sin leer"), value: String(unread.reduce((sum, item) => sum + Number(item.unreadCount), 0)), detail: c("Company and group conversations", "Conversaciones de la empresa y grupos"), route: "/work-hub/chat", items: unread.map(item => ({ id: item.id, title: item.name ?? c("Conversation", "Conversación"), detail: `${Number(item.unreadCount)} ${c("unread", "sin leer")}`, route: "/work-hub/chat" })) },
  ];
  const text = { color: colors.foreground }, muted = { color: colors.mutedForeground, fontSize: 12 };
  const card = [styles.card, { borderColor: colors.primary, backgroundColor: colors.card }];
  const milestones = (projects.data?.shifts ?? []).map(row => row.item).filter(item => item.calendarType === "project" && Date.parse(item.startsAt ?? "") <= now + projectDays * DAY && Date.parse(item.endsAt ?? item.startsAt ?? "") >= now).sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
  return <View style={{ gap: 14 }}>
    <View style={card}>
      <Text accessibilityRole="header" style={[styles.title, text]}>{c("At a glance", "De un vistazo")}</Text>
      <Text style={muted}>{c("Shifts, meetings, tasks, and conversations", "Turnos, reuniones, tareas y conversaciones")}</Text>
      {summaries.map(summary => {
        const query = summary.key === "messages" ? conversations : home;
        const range = ranges[summary.key] ?? "next";
        const cutoff = range === "week" ? now + 7 * DAY : range === "month" ? now + 30 * DAY : Infinity;
        const visible = summary.items.filter(item => item.timestamp == null || item.timestamp <= cutoff).slice(0, 10);
        return <View key={summary.key} style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${c("Open", "Abrir")} ${summary.title}`} accessibilityState={{ expanded: open === summary.key }} onPress={() => setOpen(open === summary.key ? null : summary.key)} style={[styles.row, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1, gap: 4 }}><Text style={[text, { fontWeight: "700" }]}>{summary.title}</Text><Text numberOfLines={2} style={{ color: colors.primary, fontWeight: "700" }}>{query.isPending ? c("Loading…", "Cargando…") : query.isError ? c("Unavailable", "No disponible") : summary.value}</Text>{!query.isPending && !query.isError && <Text style={muted}>{summary.detail}</Text>}</View>
            <Text style={{ color: colors.primary, fontSize: 24 }}>{open === summary.key ? "⌄" : "›"}</Text>
          </Pressable>
          {open === summary.key && <View style={{ gap: 10 }}>
            {summary.key !== "messages" && <View style={styles.controls}>{(["next", "week", "month"] as const).map(option => <TogglePillButton key={option} compactOnTablet accessibilityState={{ selected: range === option }} onPress={() => setRanges(current => ({ ...current, [summary.key]: option }))}>{option === "next" ? c("Next 10", "Próximos 10") : option === "week" ? c("This week", "Esta semana") : c("This month", "Este mes")}</TogglePillButton>)}</View>}
            {query.isPending ? <Text style={muted}>{c("Loading records…", "Cargando registros…")}</Text> : query.isError ? <Text accessibilityRole="alert" style={muted}>{c("This source could not load. Try again when connected.", "No se pudo cargar esta fuente. Inténtelo de nuevo cuando tenga conexión.")}</Text> : visible.length ? visible.map(item => <View key={item.id} style={[styles.record, { borderColor: colors.primary }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${c("Open", "Abrir")} ${item.title}`} onPress={() => summary.key === "messages" ? setConversation(unread.find(channel => channel.id === item.id) ?? null) : router.push(item.route as never)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={[text, { fontWeight: "700" }]}>{item.title}</Text></Pressable>
              <Text style={muted}>{item.detail}</Text>
            </View>) : <Text style={muted}>{c("No matching records right now.", "No hay registros que coincidan en este momento.")}</Text>}
            <Text style={muted}>{summary.key === "messages" ? c("Unread records from your current company access.", "Registros sin leer de su acceso actual a la empresa.") : c("Up to 10 records from the latest 50 personal work records.", "Hasta 10 registros de los últimos 50 registros de trabajo personal.")}</Text>
            {summary.key === "messages" && conversation && <WorkHubConversation channel={conversation} onClose={() => { setConversation(null); void conversations.refetch(); }} />}
            <TogglePillButton compactOnTablet onPress={() => router.push(summary.route as never)}>{summary.key === "shift" ? c("View all My Work", "Ver todo Mi trabajo") : summary.key === "meeting" ? c("View all meetings", "Ver todas las reuniones") : summary.key === "task" ? c("View all Tasks & Forms", "Ver todas las tareas y formularios") : c("View all conversations", "Ver todas las conversaciones")}</TogglePillButton>
          </View>}
        </View>;
      })}
    </View>
    {children}
    <View style={card}>
      <Text accessibilityRole="header" style={[styles.title, text]}>{c("Project timeline", "Cronograma de proyectos")}</Text>
      <View style={styles.controls}>{[30, 60, 90].map(days => <TogglePillButton key={days} compactOnTablet accessibilityState={{ selected: projectDays === days }} onPress={() => setProjectDays(days)}>{days} {c("days", "días")}</TogglePillButton>)}</View>
      {projects.isPending ? <Text style={muted}>{c("Loading project schedule…", "Cargando cronograma del proyecto…")}</Text> : projects.isError ? <Text accessibilityRole="alert" style={muted}>{c("Project schedule unavailable. Try again when connected.", "El cronograma del proyecto no está disponible. Inténtelo de nuevo cuando tenga conexión.")}</Text> : !milestones.length ? <Text style={muted}>{c("No shared project milestones in this range.", "No hay hitos de proyectos compartidos en este período.")}</Text> : milestones.map(item => <View key={item.id} style={[styles.record, { borderColor: colors.primary }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${c("Preview", "Vista previa de")} ${item.title}`} accessibilityState={{ expanded: preview === item.id }} onPress={() => setPreview(preview === item.id ? null : item.id)} style={{ minHeight: 44, gap: 6 }}>
          <Text style={[text, { fontWeight: "700" }]}>{item.title}</Text>
          <Text style={muted}>{item.projectName} · {status(item.milestoneStatus ?? "upcoming")}</Text>
          <Text style={muted}>{when(item.startsAt, item.timezone)} – {when(item.endsAt, item.timezone)}</Text>
          <Text style={{ color: colors.primary, fontWeight: "700" }}>{item.percentComplete ?? 0}% {c("complete", "completado")}</Text>
        </Pressable>
        {preview === item.id && <View style={{ gap: 8 }}><Text style={text}>{c("Owner", "Responsable")}: {item.ownerDisplayName ?? c("Unassigned", "Sin asignar")}</Text>{item.instructions && <Text style={text}>{item.instructions}</Text>}{item.dependencyTitle && <Text style={text}>{c("Handoff", "Relevo")}: {item.dependencyTitle}</Text>}{item.blockers && <Text style={text}>{item.blockers}</Text>}<TogglePillButton compactOnTablet onPress={() => router.push(`/work-hub/record?kind=shift&id=${encodeURIComponent(item.id)}` as never)}>{c("Open project record", "Abrir registro del proyecto")}</TogglePillButton></View>}
      </View>)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: 16, padding: 14, gap: 10 },
  title: { fontFamily: "Inter_700Bold", fontWeight: "700", fontSize: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  record: { borderWidth: 2, borderRadius: 12, padding: 12, gap: 6 },
});
