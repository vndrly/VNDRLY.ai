import React from "react";
import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import type { FleetHomeProjection } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import type { FleetModuleId } from "./FleetShell";

type ModuleState = FleetHomeProjection["moduleStates"][number]["state"];
type Row = { label: string; value: string; icon: React.ComponentProps<typeof Feather>["name"]; module: FleetModuleId; state?: ModuleState };
export type FleetHomeVisibility = Partial<Record<FleetModuleId, boolean>>;

function count(value: number | null | undefined, suffix: string, copy: (text: string) => string) {
  return value == null ? copy("Unavailable") : `${value} ${copy(suffix)}`;
}

function OperationsRow({ row, onOpen }: { row: Row; onOpen: (module: FleetModuleId) => void }) {
  const colors = useColors();
  const copy = useFleetCopy();
  const value = row.state === "unavailable" ? "Unavailable" : row.value;
  return <Pressable accessibilityRole="button" accessibilityLabel={copy(`Open ${row.label}`)} onPress={() => onOpen(row.module)} style={({ pressed }) => ({ alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 11, opacity: pressed ? .7 : 1, paddingVertical: 13 })}>
    <Feather name={row.icon} size={19} color={colors.primary} />
    <Text style={{ color: colors.text, flex: 1, fontSize: 15, fontWeight: "600" }}>{copy(row.label)}</Text>
    <Text style={{ color: row.state === "warning" || row.state === "unavailable" ? colors.destructive : colors.mutedForeground, fontSize: 13 }}>{copy(value)}</Text>
    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
  </Pressable>;
}

function OperationsCard({ id, title, subtitle, icon, rows, wide, onOpen }: { id: string; title: string; subtitle: string; icon: React.ComponentProps<typeof Feather>["name"]; rows: Row[]; wide: boolean; onOpen: (module: FleetModuleId) => void }) {
  const colors = useColors();
  const copy = useFleetCopy();
  return <View testID={`fleet-home-${id}`} style={{ backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, paddingHorizontal: 16, paddingTop: 16, ...(wide ? { flex: 1, minWidth: 0 } : { width: "100%" }) }}>
    <View style={{ alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 14 }}>
      <View style={{ alignItems: "center", backgroundColor: `${colors.primary}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name={icon} size={21} color={colors.primary} /></View>
      <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{copy(title)}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{copy(subtitle)}</Text></View>
    </View>
    {rows.map((row) => <OperationsRow key={row.label} row={row} onOpen={onOpen} />)}
  </View>;
}

export default function FleetHome({ projection, onOpen, visibility = {}, onRetry }: {
  projection: FleetHomeProjection;
  onOpen: (module: FleetModuleId, runId?: string, yardOrderId?: string) => void;
  visibility?: FleetHomeVisibility;
  onRetry?: () => void;
}) {
  const colors = useColors();
  const copy = useFleetCopy();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const capabilities = new Set(projection.capabilities);
  const admin = capabilities.has("admin");
  const dispatch = admin || capabilities.has("dispatch") || capabilities.has("self_dispatch");
  const yard = admin || capabilities.has("yard") || dispatch;
  const office = admin || capabilities.has("office");
  const driver = capabilities.has("driver");
  const independent = projection.mode === "my_fleet_day";
  const state = (module: string) => projection.moduleStates.find((item) => item.module === module)?.state;
  const metrics = projection.metrics;
  const dispatchRows: Row[] = [
    ...(yard && visibility.yard !== false ? [{ label: "Yard Orders", value: count(metrics?.yardOrders, "open", copy), icon: "package" as const, module: "yard" as const, state: state("yard") }] : []),
    ...(dispatch && !independent && visibility.dispatch !== false ? [{ label: "Ready for Dispatch", value: count(metrics?.awaitingDispatch, "ready", copy), icon: "truck" as const, module: "dispatch" as const, state: state("dispatch") }] : []),
    ...((driver || dispatch || office) ? [{ label: "Active Runs", value: count(metrics?.activeRuns, "active", copy), icon: "repeat" as const, module: (independent || driver && !dispatch && !office ? "driver" : "runs") as FleetModuleId, state: state("history") }] : []),
    ...(!independent && (driver || dispatch || office) ? [{ label: "Run History", value: count(metrics?.runHistory, "runs", copy), icon: "clock" as const, module: "history" as const, state: state("history") }] : []),
  ];
  const readinessRows: Row[] = [
    ...(dispatch ? [{ label: "Available Drivers", value: count(metrics?.availableDrivers, "available", copy), icon: "users" as const, module: "dispatch" as const, state: state("assets") }] : []),
    ...(yard && visibility.assets !== false ? [{ label: "Equipment & Yard Inventory", value: count(metrics?.yardInventory, "ready", copy), icon: "box" as const, module: "assets" as const, state: state("assets") }] : []),
    ...((admin || office || dispatch) && visibility.compliance !== false ? [{ label: "Compliance & Safety", value: metrics?.complianceScore == null ? copy("Unavailable") : `${metrics.complianceScore} · ${metrics.complianceStatus ? (() => { const label = copy(metrics.complianceStatus); return label[0].toUpperCase() + label.slice(1); })() : copy("Unscored")}`, icon: "shield" as const, module: "compliance" as const, state: state("compliance") }] : []),
  ];
  const primary = projection.nextAction;
  const unavailable = projection.moduleStates.some((item) => item.state === "unavailable");
  const actionModule = primary?.kind === "report_yard_order" ? "yard" : primary?.kind === "review_closeout" || primary?.kind === "review_ticket" || primary?.kind === "finalize_ticket" ? "office" : primary?.kind === "prepare_detail" ? "dispatch" : "driver";
  const tools = [
    ...(admin || dispatch ? [{ label: "Fleet Map", icon: "map" as const, module: "map" as const }] : []),
    ...(office ? [{ label: "Office Review", icon: "briefcase" as const, module: "office" as const }] : []),
    ...(admin ? [{ label: "Fleet Setup", icon: "settings" as const, module: "setup" as const }] : []),
  ].filter((tool) => visibility[tool.module] !== false || tool.module === "setup");

  return <View style={{ gap: 16 }}>
    <View style={{ gap: 4 }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{copy(independent ? "My Fleet Day" : "Operations")}</Text><Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{copy(independent ? "Your next job, route, and return" : "Dispatch work and confirm Fleet readiness")}</Text></View>
    {unavailable && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy("Some Fleet information is unavailable. Open a row for its current records.")}</Text>{onRetry && <TogglePillButton color="blue" accessibilityLabel={copy("Retry Fleet Home")} onPress={onRetry}>{copy("Retry Fleet Home")}</TogglePillButton>}</View>}
    {primary && <View testID="fleet-home-next" style={{ backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, gap: 10, padding: 16 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{copy("Next action")}</Text><TogglePillButton solid accessibilityLabel={copy(primary.label)} onPress={() => primary.yardOrderId ? onOpen(actionModule, primary.runId ?? undefined, primary.yardOrderId) : onOpen(actionModule, primary.runId ?? undefined)}>{copy(primary.label)}</TogglePillButton></View>}
    {projection.warnings.map((warning) => <Text key={warning.id} accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(warning.message)}</Text>)}
    <View testID="fleet-home-cards" style={{ flexDirection: wide && !independent && readinessRows.length ? "row" : "column", flexWrap: "wrap", gap: 12 }}>
      {dispatchRows.length ? <OperationsCard id="dispatch" title="Dispatch" subtitle={independent ? "Your yard work and active runs" : "Plan, release, track, and review runs"} icon="truck" rows={dispatchRows} wide={wide && !independent && readinessRows.length > 0} onOpen={onOpen} /> : null}
      {!independent && readinessRows.length ? <OperationsCard id="readiness" title="Fleet Readiness" subtitle="People, equipment, compliance, and safety" icon="check-circle" rows={readinessRows} wide={wide} onOpen={onOpen} /> : null}
    </View>
    {tools.length ? <View style={{ gap: 10 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{copy("More tools")}</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{tools.map((tool) => <Pressable key={tool.label} accessibilityRole="button" accessibilityLabel={copy(`Open ${tool.label}`)} onPress={() => onOpen(tool.module)} style={({ pressed }) => ({ alignItems: "center", backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 14, borderWidth: 2, flexDirection: "row", gap: 8, opacity: pressed ? .72 : 1, paddingHorizontal: 14, paddingVertical: 11 })}><Feather name={tool.icon} size={18} color={colors.primary} /><Text style={{ color: colors.text, fontWeight: "600" }}>{copy(tool.label)}</Text></Pressable>)}</View></View> : null}
  </View>;
}
