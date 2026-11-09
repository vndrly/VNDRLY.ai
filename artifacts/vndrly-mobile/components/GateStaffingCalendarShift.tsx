import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";
import { type GateStaffingCalendarContext } from "@/lib/gate-staffing-calendar";
import { isGatekeeperUser, isOfficeMobileViewer } from "@/lib/mobile-viewer";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import GateShiftAssignments from "./GateShiftAssignments";
import TogglePillButton from "./TogglePillButton";

function subscribeAuth(listener: () => void) {
  const user = subscribeUser(listener), token = subscribeToken(listener);
  return () => { user(); token(); };
}
const authGeneration = () => captureAuthScope().generation;
type Shift = { id: string; title: string; siteLocationId: number; gateStationId: string; startsAt: string; endsAt: string; timezone: string };

export default function GateStaffingCalendarShift({ context }: { context: GateStaffingCalendarContext }) {
  const generation = useSyncExternalStore(subscribeAuth, authGeneration);
  return <ShiftPanel key={`${generation}:${context.shiftId}:${context.siteId}:${context.stationId}:${context.date}`} context={context} />;
}
function ShiftPanel({ context }: { context: GateStaffingCalendarContext }) {
  const { user } = useAuth(), colors = useColors(), { i18n } = useTranslation();
  const es = i18n.language.startsWith("es"), scope = useRef(captureAuthScope()).current, mounted = useRef(false);
  const [shift, setShift] = useState<Shift | null>(null), [failed, setFailed] = useState(false);
  const current = () => mounted.current && isAuthScopeCurrent(scope);
  const load = async () => {
    setShift(null); setFailed(false);
    try {
      const result = await apiFetch<{ item: Shift }>(`/api/work-hub/calendar/items/shift/${context.shiftId}`, {}, scope);
      if (!current()) return;
      const s = result.item;
      if (!s || s.id !== context.shiftId || String(s.siteLocationId) !== context.siteId || s.gateStationId !== context.stationId) throw new Error("Shift changed");
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: s.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(s.startsAt));
      const part = (type: string) => parts.find(value => value.type === type)?.value;
      if (`${part("year")}-${part("month")}-${part("day")}` !== context.date) throw new Error("Shift date changed");
      setShift(s);
    } catch { if (current()) setFailed(true); }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  const active = user?.availableMemberships?.find(item => item.id === user.activeMembershipId);
  const canAssign = user?.role === "admin" || active?.role === "admin" || user?.vendorRole === "gate_supervisor";
  const canReviewWatch = isOfficeMobileViewer(user) || isGatekeeperUser(user);
  return <View style={{ gap: 10, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12 }}>
    {failed ? <><Text accessibilityRole="alert" style={{ color: colors.mutedForeground }}>{es ? "Este turno ya no está disponible para este sitio y puerta en su empresa actual." : "This shift is no longer available for this site and gate in your current company."}</Text><TogglePillButton compactOnTablet onPress={() => void load()}>{es ? "Reintentar turno" : "Retry exact shift"}</TogglePillButton></> : shift ? <>
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 18, fontWeight: "700" }}>{shift.title}</Text>
      <Text style={{ color: colors.mutedForeground }}>{context.date} · {shift.timezone}</Text>
      <Text style={{ color: colors.foreground }}>{es ? "La asignación planifica la cobertura. Revisar la guardia no la inicia; confirme Asumir Guardia en Gate." : "Assignment plans coverage. Reviewing the watch does not start it; confirm Assume Watch in Gate."}</Text>
      {canAssign ? <GateShiftAssignments shiftId={context.shiftId} /> : null}
      {canReviewWatch ? <TogglePillButton compactOnTablet onPress={() => {
        if (current()) router.push(`/(tabs)/change-over?siteId=${context.siteId}&stationId=${context.stationId}&workHubShiftId=${context.shiftId}&gateMode=1&purpose=assume` as never);
      }}>{es ? "Revisar Gate / Asumir Guardia" : "Review Gate / Assume Watch"}</TogglePillButton> : null}
    </> : <ActivityIndicator accessibilityLabel={es ? "Cargando turno exacto" : "Loading exact shift"} />}
  </View>;
}
