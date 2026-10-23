import React, { useEffect, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { ChangeOverState, ShiftNotesResponse } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope } from "@/lib/auth";
import { changeOverRequest } from "@/lib/change-over-api";

type Task = { id: string; title: string; status: string; assigneeUserId: number | null };
function Row({ label, value, onPress, expanded }: { label: string; value: string; onPress: () => void; expanded?: boolean }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityState={expanded === undefined ? undefined : { expanded }} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44, borderTopWidth: 1, borderTopColor: colors.border }}>
    <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14, flex: 1 }}>{label}</Text>
    <Text style={{ color: colors.mutedForeground, fontSize: 13, flexShrink: 1 }}>{value} ›</Text>
  </Pressable>;
}
export default function GateDashboardPanels({ current }: { current: ChangeOverState }) {
  const colors = useColors(), { user, activeMembershipId } = useAuth(), { t, i18n } = useTranslation(), { width } = useWindowDimensions();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [expanded, setExpanded] = useState<string | null>(null), [now, setNow] = useState(Date.now());
  const scope = captureAuthScope();
  const identity = JSON.stringify([user?.id, activeMembershipId, scope.generation, current.station.id]);
  useEffect(() => { setExpanded(null); const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, [identity]);
  const home = useQuery({ queryKey: ["gate-dashboard-tasks", user?.id, activeMembershipId, scope.generation, user?.vendorId, user?.partnerId], queryFn: () => apiFetch<{ tasks: Task[] }>("/api/work-hub/home", {}, scope), enabled: Boolean(user), retry: false, refetchInterval: 15000 });
  const previous = useQuery({ queryKey: ["gate-dashboard-previous", user?.id, activeMembershipId, scope.generation, current.station.id], queryFn: () => changeOverRequest<ShiftNotesResponse>(`/${current.station.id}/notes?days=30`), enabled: Boolean(user && current.station.id), retry: false });
  const snapshot = current.snapshot, metrics = snapshot?.metrics, own = current.shift?.operator_id === user?.id;
  const started = Date.parse(current.shift?.started_at ?? ""), minutes = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 60000)) : null;
  const elapsed = minutes === null ? c("Not recorded", "Sin registro") : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const assigned = home.isSuccess ? home.data.tasks?.filter(task => task.assigneeUserId === user?.id) : undefined;
  const groups = { new: assigned?.filter(task => ["new", "open", "assigned", "pending"].includes(task.status)), progress: assigned?.filter(task => ["in_progress", "started", "active"].includes(task.status)), completed: assigned?.filter(task => task.status === "completed") };
  const previousStatus = previous.isError ? c("Unavailable", "No disponible") : previous.isPending ? c("Loading…", "Cargando…") : previous.data?.rows?.[0]?.outgoing_name ?? c("No recorded handoff", "Sin relevo registrado");
  const openHistory = (recordType = "all") => router.push({ pathname: "/(tabs)/gate-history", params: { siteId: String(current.site.id), stationId: current.station.id, range: "current_shift", recordType } } as never);
  const openNotes = () => router.push({ pathname: "/(tabs)/shift-notes", params: { siteId: String(current.site.id), stationId: current.station.id } } as never);
  const toggle = (key: string) => setExpanded(value => value === key ? null : key);
  const muted = { color: colors.mutedForeground, fontSize: 13 }, text = { color: colors.foreground, fontSize: 14 };
  const panel = { borderColor: colors.primary, borderWidth: 1, borderRadius: 12, padding: 12, backgroundColor: "#242426", width: width >= 768 ? "48.5%" as const : "100%" as const };
  const title = { color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 16, marginBottom: 8 };
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
    <View testID="gate-dashboard-watch" style={panel}>
      <Text style={title}>{c("Watch & handover", "Guardia y relevo")}</Text>
      <Row label={c("My watch", "Mi guardia")} value={own ? elapsed : c("Not on watch", "Fuera de guardia")} onPress={() => openHistory()} />
      <Row label={c("On watch", "De guardia")} value={current.shift?.operator_name ?? c("Unassigned", "Sin asignar")} onPress={() => openHistory()} />
      <Row label={c("Previous watch", "Guardia anterior")} value={previousStatus} onPress={() => toggle("previous")} expanded={expanded === "previous"} />
      {expanded === "previous" && <View style={{ gap: 6, paddingVertical: 8 }}>{previous.data?.rows?.[0] ? <><Text style={muted}>{new Date(previous.data.rows[0].acknowledged_at).toLocaleString()}</Text><Text style={text}>{previous.data.rows[0].notes || c("No notes recorded", "Sin notas registradas")}</Text>{previous.data.rows[0].summary.facts.map(fact => <Text key={fact.id} style={text}>{fact.text}</Text>)}</> : <Text style={muted}>{previous.isError ? c("Previous handoff could not be loaded.", "No se pudo cargar el relevo anterior.") : previous.isPending ? c("Loading…", "Cargando…") : c("No recorded handoff in the last 30 days.", "Sin relevo registrado en los últimos 30 días.")}</Text>}</View>}
      <Row label={c("Read shift notes", "Leer notas del turno")} value={String(current.items.filter(item => item.status === "open").length)} onPress={openNotes} />
    </View>
    <View testID="gate-dashboard-tasks" style={panel}>
      <Text style={title}>{c("Tasks", "Tareas")}</Text><Text style={muted}>{c("Your assigned work without a ticket", "Tu trabajo asignado sin ticket")}</Text>
      <Text style={muted}>{c("Counts reflect assigned tasks in the first 50 work records returned.", "Los recuentos reflejan las tareas asignadas en los primeros 50 registros de trabajo devueltos.")}</Text>
      {([["new", c("New", "Nuevas")], ["progress", c("In Progress", "En curso")], ["completed", c("Completed", "Completadas")]] as const).map(([key, label]) => <Row key={key} label={label} value={groups[key] ? String(groups[key].length) : c("Unavailable", "No disponible")} onPress={() => toggle(key)} expanded={expanded === key} />)}
      {(["new", "progress", "completed"] as const).includes(expanded as never) && <View style={{ gap: 8 }}>{groups[expanded as keyof typeof groups]?.map(task => <Pressable key={task.id} accessibilityRole="button" onPress={() => router.push(`/work-hub/record?kind=task&id=${encodeURIComponent(task.id)}` as never)}><Text style={text}>{task.title} ›</Text></Pressable>)}{!assigned ? <Text style={muted}>{c("Task records are unavailable.", "Los registros de tareas no están disponibles.")}</Text> : !groups[expanded as keyof typeof groups]?.length && <Text style={muted}>{c("No assigned tasks in this status.", "No hay tareas asignadas con este estado.")}</Text>}</View>}
      <Row label={c("Hours", "Horas")} value={c("Not recorded", "Sin registro")} onPress={() => router.push("/work-hub/tasks-forms" as never)} />
    </View>
    <View testID="gate-dashboard-activity" style={panel}>
      <Text style={title}>{c("Gate activity", "Actividad de puerta")}</Text>
      {snapshot && <Text style={muted}>{new Date(snapshot.generatedAt).toLocaleString()}</Text>}
      <Row label={`${t("changeOver.checkIns")}: ${metrics?.checkIns ?? c("Unavailable", "No disponible")}`} value="" onPress={() => openHistory("check_ins")} />
      <Row label={`${t("changeOver.checkOuts")}: ${metrics?.checkOuts ?? c("Unavailable", "No disponible")}`} value="" onPress={() => openHistory("check_outs")} />
      <Row label={t("changeOver.pendingAdmission")} value={metrics ? String(metrics.pendingAdmission) : c("Unavailable", "No disponible")} onPress={() => openHistory("pending")} />
      <Row label={c("Items to review", "Elementos para revisar")} value={snapshot ? String(snapshot.exceptions.length) : c("Unavailable", "No disponible")} onPress={() => toggle("exceptions")} expanded={expanded === "exceptions"} />
      {expanded === "exceptions" && <View style={{ gap: 6 }}>{snapshot?.exceptions.map((item, index) => <Text key={`${item.sourceId}:${index}`} style={text}>{item.text}</Text>)}{!snapshot?.exceptions.length && <Text style={muted}>{c("None recorded", "Ninguno registrado")}</Text>}</View>}
    </View>
    <View testID="gate-dashboard-on-site" style={panel}>
      <Text style={title}>{c("On site", "En el sitio")}</Text>
      <Row label={t("changeOver.onSiteVisitorRecords")} value={metrics ? String(metrics.onSiteVisitorRecords) : c("Unavailable", "No disponible")} onPress={() => openHistory("visitors_on_site")} />
      <Row label={t("changeOver.onSiteEmployeeRecords")} value={metrics ? String(metrics.onSiteEmployeeRecords) : c("Unavailable", "No disponible")} onPress={() => openHistory("employees_on_site")} />
      <Row label={t("changeOver.onSiteVehicles")} value={metrics ? String(metrics.onSiteVehicles) : c("Unavailable", "No disponible")} onPress={() => openHistory("vehicles_on_site")} />
      <Row label={c("Still on site", "Aún en el sitio")} value={snapshot ? String(snapshot.outstanding.length) : c("Unavailable", "No disponible")} onPress={() => toggle("outstanding")} expanded={expanded === "outstanding"} />
      {expanded === "outstanding" && <View style={{ gap: 8 }}>{snapshot?.outstanding.map(item => <View key={item.id}><Text style={text}>{[item.name, item.company, item.plate].filter(Boolean).join(" · ")}</Text><Text style={muted}>{new Date(item.checkIn).toLocaleString()}</Text>{item.notes && <Text style={text}>{item.notes}</Text>}</View>)}{!snapshot?.outstanding.length && <Text style={muted}>{c("None recorded", "Ninguno registrado")}</Text>}</View>}
    </View>
  </View>;
}
