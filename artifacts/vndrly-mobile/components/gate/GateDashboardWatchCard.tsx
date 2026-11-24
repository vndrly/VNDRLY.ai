import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import type { ChangeOverState, GateWatchTimeline, ShiftNotesResponse } from "@workspace/gate-booth";
import { ModalPressable as Pressable } from "@/components/ModalDraft";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useGateStaffingAlerts } from "@/hooks/use-gate-staffing-alerts";
import { changeOverRequest } from "@/lib/change-over-api";

type Watch = { userId: number; name: string; stationId: string; siteName: string; gateName: string; startedAt: string; watchId?: string | null; canManage?: boolean };
type ScheduledWatch = { id: string; assignmentId: string; version: number; startsAt: string; endsAt: string; timezone: string; siteName: string; gateName: string; response: "pending" | "confirmed" | "conflict" };
type Section = "radar" | "schedule" | "roster" | "previous" | "next" | "notes";

export default function GateDashboardWatchCard({ stationId, current, phase = "ready", onWebAction, onExpandedChange }: {
  stationId: string;
  current: ChangeOverState | null;
  phase?: "ready" | "pending" | "error";
  onWebAction: (action: "assume" | "release" | "turnover") => void;
  onExpandedChange?: (section: Section, open: boolean) => void;
}) {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  const { primary } = useColors();
  const cache = useQueryClient();
  const es = (i18n.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selectedWatch, setSelectedWatch] = useState<Watch | null>(null);
  const [assumeWatch, setAssumeWatch] = useState<Watch | null>(null);
  const [standNotice, setStandNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const staffing = useGateStaffingAlerts();
  const watches = useQuery({ queryKey: ["gate-native-watches", user?.id, user?.activeMembershipId], queryFn: () => changeOverRequest<{ watches: Watch[] }>("/watches"), retry: false, refetchInterval: 5000 });
  const schedule = useQuery({ queryKey: ["gate-native-scheduled-watches", user?.id, user?.activeMembershipId], queryFn: () => changeOverRequest<{ watches: ScheduledWatch[] }>("/my-scheduled-watches"), retry: false, refetchInterval: 30000 });
  const timeline = useQuery({ queryKey: ["gate-native-watch-timeline", user?.id, user?.activeMembershipId], queryFn: () => changeOverRequest<GateWatchTimeline>("/watch-timeline"), retry: false, refetchInterval: 30000 });
  const notes = useQuery({ queryKey: ["gate-native-recent-shift-notes", user?.id, stationId], queryFn: () => changeOverRequest<ShiftNotesResponse>(`/${stationId}/notes?limit=10`), enabled: !!open.notes && !!stationId, retry: false });
  const standers = useQuery({ queryKey: ["gate-native-watch-standers", selectedWatch?.stationId], queryFn: () => changeOverRequest<{ operators: { membershipId: number; name: string; companyName: string }[] }>(`/${selectedWatch!.stationId}/watch/standers`), enabled: !!selectedWatch, retry: false });
  const ownWatch = !!current?.shift && current.shift.operator_id === user?.id;
  const label = { color: "#ececec", fontSize: 14, fontWeight: "600" as const };
  const muted = { color: "#b3b3b3", fontSize: 12 };
  const action = (text: string, press: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={text} disabled={disabled} onPress={press} style={{ paddingHorizontal: 5, paddingVertical: 5, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: primary, fontSize: 12, fontWeight: "600" }}>{text}</Text></Pressable>;
  const row = (section: Section, icon: React.ComponentProps<typeof Feather>["name"], title: string, value: string | number | undefined, content: React.ReactNode) => <View key={section}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: !!open[section] }} onPress={() => { const next = !open[section]; setOpen(value => ({ ...value, [section]: next })); onExpandedChange?.(section, next); }} style={{ borderTopColor: "#3a3a3a", borderTopWidth: 1, minHeight: 37, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Feather name={icon} size={18} color={primary} /><Text style={[label, { flex: 1 }]}>{title}</Text><Text style={muted}>{value}</Text><Feather name="chevron-right" size={17} color="#a3a3a3" style={open[section] ? { transform: [{ rotate: "90deg" }] } : undefined} />{section === "roster" && ownWatch && <Pressable accessibilityRole="button" accessibilityLabel={c("Release watch", "Liberar guardia")} onPress={event => { event.stopPropagation(); onWebAction("release"); }} style={{ paddingVertical: 5, paddingHorizontal: 3 }}><Text style={{ color: primary, fontSize: 12 }}>{c("Release watch", "Liberar guardia")}</Text></Pressable>}
    </Pressable>{open[section] && <View style={{ paddingLeft: 29, paddingBottom: 10, gap: 7 }}>{content}</View>}
  </View>;
  const refresh = async () => { await Promise.all([watches.refetch(), schedule.refetch(), timeline.refetch(), cache.invalidateQueries({ queryKey: ["gate-active-watches"] })]); };
  const manage = async (watch: Watch, operation: "assume" | "assign", membershipId?: number) => {
    if (!watch.watchId || busy) return;
    setBusy(true); setStandNotice("");
    try {
      await changeOverRequest(`/${watch.stationId}/watch/admin`, { operationId: Crypto.randomUUID(), expectedShiftId: watch.watchId, action: operation, ...(membershipId ? { targetMembershipId: membershipId } : {}) });
      setSelectedWatch(null); setAssumeWatch(null); await refresh();
    } catch (error) { setStandNotice(error instanceof Error ? error.message : c("The watch change could not be confirmed.", "No se pudo confirmar el cambio de guardia.")); }
    finally { setBusy(false); }
  };
  const respond = async (watch: ScheduledWatch, response: "confirm" | "conflict") => {
    if (busy || response === "conflict" && !reason.trim()) return;
    setBusy(true); setStandNotice("");
    try {
      await changeOverRequest(`/my-scheduled-watches/${watch.id}/response`, { operationId: Crypto.randomUUID(), assignmentId: watch.assignmentId, expectedVersion: watch.version, response, ...(response === "conflict" ? { reason: reason.trim() } : {}) });
      setConflict(null); setReason(""); await schedule.refetch();
    } catch (error) { setStandNotice(error instanceof Error ? error.message : c("Response not confirmed.", "Respuesta sin confirmar.")); }
    finally { setBusy(false); }
  };
  const date = (value: string, timezone?: string) => new Date(value).toLocaleString(es ? "es" : "en-US", { dateStyle: "medium", timeStyle: "short", ...(timezone ? { timeZone: timezone } : {}) });
  const next = schedule.data?.watches.find(w => Date.parse(w.startsAt) >= Date.now());
  const alertRows = staffing.alerts.filter(alert => alert.status !== "resolved");
  const watchRows = watches.data?.watches ?? [];
  const watchStatus = current?.shift ? `${current.coverageUnconfirmed ? c("Coverage unconfirmed · relief overdue", "Cobertura sin confirmar · relevo atrasado") : current.preparation?.summary.signature ? c("Turnover signed · release the watch when you leave", "Relevo firmado · libera la guardia al salir") : c("Watch in progress", "Guardia en curso")} · ${current.shift.operator_name}` : "";
  return <View accessibilityLabel={c("Watch & handover", "Vigilancia y relevo")} style={{ backgroundColor: "#242426", borderColor: primary, borderWidth: 2, borderRadius: 14, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 3 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, paddingBottom: 9 }}><Feather name="clock" size={20} color={primary} /><View><Text accessibilityRole="header" style={{ color: "#ececec", fontWeight: "700", fontSize: 17 }}>{c("Watch & handover", "Vigilancia y relevo")}</Text><Text style={muted}>{c("Custody, your watch time, and the last handover", "Custodia, tiempo de vigilancia y último relevo")}</Text></View></View>
    {phase !== "ready" && <Text accessibilityRole={phase === "error" ? "alert" : undefined} style={[muted, { paddingBottom: 9 }]}>{phase === "error" ? c("Watch details could not be loaded.", "No se pudieron cargar los detalles de la guardia.") : c("Loading watch details…", "Cargando detalles de la guardia…")}</Text>}
    {row("radar", "radio", c("Watch Radar", "Radar de vigilancia"), staffing.error ? c("Unavailable", "No disponible") : alertRows.length, staffing.error ? <Text style={muted}>{c("Watch Radar is unavailable.", "El radar de vigilancia no está disponible.")}</Text> : alertRows.length ? alertRows.map(alert => <View key={alert.id} style={{ gap: 3, borderColor: alert.severity === "critical" ? "#c24141" : "#d69e25", borderWidth: 1, borderRadius: 7, padding: 8 }}><Text style={label}>{alert.title}</Text><Text style={muted}>{alert.siteName} · {alert.gateName}</Text><Text style={muted}>{date(alert.startsAt, alert.timezone)} — {date(alert.endsAt, alert.timezone)}</Text>{action(c("Open staffing calendar", "Abrir calendario de personal"), () => router.push(alert.href as never))}</View>) : <Text style={muted}>{c("No current staffing gaps or unassigned watches within the next 24 hours.", "No hay faltas actuales ni guardias sin asignar en las próximas 24 horas.")}</Text>)}
    {row("schedule", "clock", c("My Watch", "Mi guardia"), schedule.isPending ? c("Loading…", "Cargando…") : schedule.isError ? c("Schedule unavailable", "Horario no disponible") : next ? date(next.startsAt, next.timezone) : c("No upcoming watches", "Sin próximas guardias"), schedule.data?.watches.length ? schedule.data.watches.map(w => <View key={w.assignmentId} style={{ borderBottomColor: "#3a3a3a", borderBottomWidth: 1, paddingBottom: 6 }}><Text style={label}>{w.siteName} · {w.gateName}</Text><Text style={muted}>{date(w.startsAt, w.timezone)} — {date(w.endsAt, w.timezone)}</Text><View style={{ flexDirection: "row" }}>{action(c("Confirm", "Confirmar"), () => void respond(w, "confirm"), busy || w.response === "confirmed")}{action(c("Conflict", "Conflicto"), () => setConflict(conflict === w.id ? null : w.id), busy)}</View>{conflict === w.id && <><TextInput accessibilityLabel={c("Scheduling conflict", "Conflicto de horario")} placeholder={c("Brief reason", "Motivo breve")} placeholderTextColor="#a3a3a3" value={reason} onChangeText={setReason} style={{ color: "#ececec", borderWidth: 1, borderColor: primary, borderRadius: 6, padding: 6 }} />{action(c("Report conflict", "Informar conflicto"), () => void respond(w, "conflict"), !reason.trim() || busy)}</>}</View>) : <Text style={muted}>{schedule.isError ? c("Your schedule could not be loaded.", "No se pudo cargar tu horario.") : c("No scheduled watches.", "Sin guardias programadas.")}</Text>)}
    {current && !ownWatch && action(c("Assume Watch", "Asumir vigilancia"), () => onWebAction("assume"))}
    {row("roster", "user-check", c("On watch", "En vigilancia"), watches.isSuccess ? watchRows.length : c("Unavailable", "No disponible"), <>{watchStatus ? <Text style={[muted, { marginLeft: 7, fontSize: 12 }]}>{watchStatus}</Text> : null}{watchRows.length ? watchRows.map(w => <View key={`${w.stationId}:${w.userId}`} style={{ marginLeft: 14, paddingVertical: 5, borderBottomColor: "#3a3a3a", borderBottomWidth: 1 }}><View style={{ flexDirection: "row", alignItems: "center" }}><Text style={[label, { flex: 1, fontSize: 13 }]}>{w.name}</Text>{w.canManage && w.watchId && <>{action(c("Assume", "Asumir"), () => setAssumeWatch(w), busy || w.userId === user?.id)}{action(c("Assign", "Asignar"), () => setSelectedWatch(w), busy)}</>}</View><Text style={muted}>{w.siteName} · {w.gateName}</Text></View>) : <Text style={muted}>{watches.isError ? c("Watch roster unavailable.", "Lista de vigilancia no disponible.") : c("No gatekeepers currently on watch.", "No hay porteros de vigilancia.")}</Text>}{assumeWatch && <View style={{ padding: 8, borderWidth: 1, borderColor: primary, borderRadius: 7 }}><Text style={label}>{c(`Assume ${assumeWatch.name}'s watch at ${assumeWatch.siteName}?`, `¿Asumir la guardia de ${assumeWatch.name} en ${assumeWatch.siteName}?`)}</Text><View style={{ flexDirection: "row" }}>{action(c("Confirm assumption", "Confirmar asunción"), () => void manage(assumeWatch, "assume"), busy)}{action(c("Cancel", "Cancelar"), () => setAssumeWatch(null))}</View></View>}{selectedWatch && <View style={{ padding: 8, borderWidth: 1, borderColor: primary, borderRadius: 7 }}><Text style={label}>{c("Available watch standers", "Personal disponible")}</Text>{standers.data?.operators.map(person => action(`${person.name} · ${person.companyName}`, () => void manage(selectedWatch, "assign", person.membershipId), busy))}{!standers.isPending && !standers.data?.operators.length && <Text style={muted}>{c("No available watch standers.", "No hay personal disponible.")}</Text>}{action(c("Cancel", "Cancelar"), () => setSelectedWatch(null))}</View>}</>)}
    {ownWatch && action(c("Prepare turnover", "Preparar relevo"), () => onWebAction("turnover"))}
    {!!standNotice && <Text accessibilityRole="alert" style={muted}>{standNotice}</Text>}
    {(["previous", "next"] as const).map(section => row(section, section === "previous" ? "edit" : "clock", section === "previous" ? c("Previous watch", "Vigilancia anterior") : c("Next Watch", "Próxima guardia"), timeline.isPending ? c("Loading…", "Cargando…") : timeline.isError ? c("Unavailable", "No disponible") : timeline.data?.sites.filter(site => site[section]).length ?? 0, timeline.data?.sites.map(site => { const watch = site[section] as (NonNullable<typeof site.previous> & NonNullable<typeof site.next>) | null; return <View key={site.siteId} style={{ paddingBottom: 6, borderBottomColor: "#3a3a3a", borderBottomWidth: 1 }}><Text style={label}>{watch ? section === "previous" ? watch.name : watch.people.length ? watch.people.map(person => person.name).join(", ") : c("Unassigned", "Sin asignar") : site.siteName}</Text><Text style={muted}>{watch ? `${site.siteName} · ${watch.gateName}` : section === "previous" ? c("No completed watch recorded.", "No hay guardias completadas registradas.") : c("No upcoming watch scheduled.", "No hay próximas guardias programadas.")}</Text>{watch && <Text style={muted}>{section === "previous" ? date(watch.endedAt) : `${date(watch.startsAt, watch.timezone)} — ${date(watch.endsAt, watch.timezone)}`}</Text>}{section === "previous" && watch && <>{!!watch.notes && <Text style={muted}>{watch.notes}</Text>}{watch.handoffId && action(c("Open shift notes", "Abrir notas del turno"), () => router.push(`/shift-notes?stationId=${watch.stationId}&siteId=${site.siteId}&handoffId=${watch.handoffId}` as never))}</>}</View>; }) ?? <Text style={muted}>{timeline.isError ? c("Watch history and schedule unavailable.", "Historial y horario de guardias no disponibles.") : c("Loading watches…", "Cargando guardias…")}</Text>))}
    {row("notes", "clipboard", c("Read shift notes", "Leer notas del turno"), undefined, <>{notes.data?.rows.slice(0, 10).map(note => action(`${note.station_name ? `${note.station_name} · ` : ""}${note.outgoing_name} · ${date(note.filed_at ?? note.created_at ?? note.acknowledged_at)}`, () => router.push(`/shift-notes?stationId=${stationId}&handoffId=${note.id}` as never)))}{!notes.isPending && !notes.data?.rows.length && <Text style={muted}>{notes.isError ? c("Shift notes unavailable.", "Notas del turno no disponibles.") : c("No filed shift notes.", "No hay notas de turno archivadas.")}</Text>}{action(c("All shift notes", "Todas las notas del turno"), () => router.push(`/shift-notes?stationId=${stationId}` as never))}</>)}
  </View>;
}
