import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { GateStaffingAlert } from "@workspace/gate-booth";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useGateStaffingAlerts } from "@/hooks/use-gate-staffing-alerts";
import { captureAuthScope } from "@/lib/auth";
import { parseNotificationTarget } from "@/lib/notification-destination";

export default function GateStaffingAlerts() {
  const state = useGateStaffingAlerts(), colors = useColors();
  const { i18n } = useTranslation(), es = i18n?.language?.startsWith("es") ?? false;
  const alerts = state.alerts.filter(alert => alert.status !== "resolved");
  if (!alerts.length && !state.error) return null;
  return <View style={styles.list}>
    {alerts.map(alert => <StaffingCard key={`${state.generation}:${alert.id}`} alert={alert} paused={state.notificationsPaused || alert.notificationsPaused} generation={state.generation} busy={state.pendingId !== null} failed={state.acknowledgmentErrorId === alert.id} acknowledge={() => void state.acknowledge(alert.id)} />)}
    {state.error ? <View style={styles.list}><Text style={{ color: colors.mutedForeground }}>{es ? "No se pudo actualizar la cobertura de guardia." : "Gate staffing could not refresh."}</Text><TogglePillButton compactOnTablet onPress={() => void state.refresh()}>{es ? "Reintentar cobertura" : "Retry staffing status"}</TogglePillButton></View> : null}
  </View>;
}

function at(value: string, timezone: string) {
  try { return new Date(value).toLocaleString([], { timeZone: timezone }); }
  catch { return new Date(value).toLocaleString(); }
}
function StaffingCard({ alert, paused, generation, busy, failed, acknowledge }: { alert: GateStaffingAlert; paused: boolean; generation: number; busy: boolean; failed: boolean; acknowledge(): void }) {
  const colors = useColors(), { i18n } = useTranslation(), es = i18n?.language?.startsWith("es") ?? false;
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [confirming, setConfirming] = useState(false), [reducedMotion, setReducedMotion] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;
  const upcoming = alert.kind === "watch_radar", critical = !upcoming && alert.severity === "critical", canAcknowledge = !paused && alert.status === "open" && alert.canAcknowledge;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReducedMotion(value); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => { active = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (paused || reducedMotion || !critical || alert.status !== "open") { opacity.setValue(1); return; }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [paused, reducedMotion, critical, alert.status, opacity]);
  const accent = paused ? colors.border : critical ? "#dc2626" : "#b45309";
  const text = { color: colors.foreground };
  const target = parseNotificationTarget(alert.href);
  const validCalendar = target?.kind === "staffing" && target.id === alert.shiftId && target.stationId === alert.stationId && target.siteId === String(alert.siteId);
  return <View testID={`staffing-alert-${alert.id}`} style={[styles.card, { borderColor: accent, backgroundColor: colors.card }]}>
    <Animated.View style={{ opacity }}><Text accessibilityRole={paused ? undefined : "alert"} style={[styles.status, { color: paused ? colors.mutedForeground : accent }]}>{paused
      ? c("Staffing notifications paused for this company", "Notificaciones de cobertura pausadas para esta empresa")
      : alert.status === "acknowledged" ? c("Acknowledged · Coverage still needed", "Confirmado · Aún se necesita cobertura")
      : critical ? c("Critical · Awaiting acknowledgment", "Crítico · Pendiente de confirmación")
      : c("Staffing warning", "Aviso de cobertura")}</Text></Animated.View>
    <Text style={[styles.title, text]}>{paused ? c("Gate staffing", "Cobertura de guardia") : upcoming ? c("Upcoming watch needs assignment", "La próxima guardia necesita asignación") : alert.title}</Text>
    <Text style={text}>{alert.siteName} · {alert.gateName}</Text>
    <Text style={text}>{upcoming ? c(`${alert.requiredCount} required for upcoming watch`, `${alert.requiredCount} requeridos para la próxima guardia`) : c(`${alert.actualCount} on watch · ${alert.requiredCount} required`, `${alert.actualCount} en guardia · ${alert.requiredCount} requeridos`)}</Text>
    <Text style={{ color: colors.mutedForeground }}>{at(alert.startsAt, alert.timezone)} — {at(alert.endsAt, alert.timezone)} · {alert.timezone}</Text>
    {!paused && alert.status === "acknowledged" && alert.acknowledgedBy && alert.acknowledgedAt ? <Text style={text}>{c(`Acknowledged by ${alert.acknowledgedBy.name}`, `Confirmado por ${alert.acknowledgedBy.name}`)} · {at(alert.acknowledgedAt, alert.timezone)}</Text> : null}
    {!paused ? <Text style={{ color: colors.mutedForeground }}>{c("Acknowledgment stops reminders for everyone. Only a saved watch restores actual coverage.", "La confirmación detiene recordatorios para todos. Solo una guardia guardada restaura la cobertura real.")}</Text> : null}
    {canAcknowledge ? confirming ? <View style={styles.list}>
      <Text style={text}>{c("Confirm responsibility for this staffing alert?", "¿Confirmar responsabilidad por esta alerta de cobertura?")}</Text>
      {failed ? <Text accessibilityRole="alert" style={text}>{c("Acknowledgment could not be confirmed. Retry this same alert.", "No se pudo confirmar. Reintente esta misma alerta.")}</Text> : null}
      <TogglePillButton compactOnTablet color={critical ? "red" : "brand"} disabled={busy} accessibilityLabel={c("Confirm acknowledgment", "Confirmar recepción")} onPress={() => { if (captureAuthScope().generation === generation) acknowledge(); }}>{c("Confirm acknowledgment", "Confirmar recepción")}</TogglePillButton>
      <TogglePillButton compactOnTablet disabled={busy} onPress={() => setConfirming(false)}>{c("Cancel", "Cancelar")}</TogglePillButton>
    </View> : <TogglePillButton compactOnTablet color={critical ? "red" : "brand"} disabled={busy} accessibilityLabel={c("Acknowledge staffing alert", "Confirmar alerta de cobertura")} onPress={() => setConfirming(true)}>{c("Acknowledge staffing alert", "Confirmar alerta de cobertura")}</TogglePillButton> : null}
    {!paused && validCalendar ? <TogglePillButton compactOnTablet accessibilityLabel={c("Open staffing calendar", "Abrir calendario de cobertura")} onPress={() => { if (captureAuthScope().generation === generation) router.push(alert.href as never); }}>{c("Open staffing calendar", "Abrir calendario de cobertura")}</TogglePillButton> : null}
  </View>;
}
const styles = StyleSheet.create({ list: { gap: 10 }, card: { borderWidth: 2, borderRadius: 12, padding: 14, gap: 8 }, title: { fontSize: 17, fontWeight: "700" }, status: { fontSize: 14, fontWeight: "700" } });
