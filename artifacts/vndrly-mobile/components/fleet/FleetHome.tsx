import React, { useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { FleetRunOrderPageSchema, FleetYardOrderSchema, type FleetHomeProjection, type FleetOverview, type FleetRun, type FleetYardOrder } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import type { FleetModuleId } from "./FleetShell";

type ModuleState = FleetHomeProjection["moduleStates"][number]["state"];
type DetailKind = "yard" | "ready" | "active" | "builder" | "history" | "drivers" | "equipment" | "compliance";
type Row = { key: string; label: string; value: string; icon: React.ComponentProps<typeof Feather>["name"]; module: FleetModuleId; state?: ModuleState; expandable?: DetailKind; createLabel?: string; createModule?: FleetModuleId };
type Preview = { id: string; title: string; detail: string; status: string; danger?: boolean; tone?: "green" | "gray" | "amber" | "red"; module: FleetModuleId; runId?: string; yardOrderId?: string; runOrderId?: string; driverUserId?: number; assetId?: string };
type PreviewState = { loading: boolean; error?: string; items: Preview[]; capped?: boolean };
export type FleetHomeVisibility = Partial<Record<FleetModuleId, boolean>>;

const count = (value: number | null | undefined, suffix: string, copy: (text: string) => string) => value == null ? copy("Unavailable") : `${value} ${copy(suffix)}`;
const words = (value: string) => value.replaceAll("_", " ");
const place = (run: FleetRun, index: number) => run.stops[index]?.destination?.name ?? run.labels?.sites.find(site => site.siteId === run.stops[index]?.siteId)?.name ?? `Site ${run.stops[index]?.siteId ?? ""}`;
const route = (run: FleetRun) => `${place(run, 0)} → ${place(run, Math.max(0, run.stops.length - 1))}`;
const driverReadiness = (run: FleetRun) => run.status === "draft" ? "Assigned" : run.status === "dispatched" ? "Awaiting driver" : run.status === "acknowledged" ? "Driver ready" : run.status === "in_progress" ? "In progress" : words(run.status);
const yardReadiness = (order?: FleetYardOrder) => !order ? "No Yard order" : words(order.outcome ?? order.status);

function PreviewList({ state, onOpen }: { state?: PreviewState; onOpen: FleetHomeProps["onOpen"] }) {
  const colors = useColors(), copy = useFleetCopy();
  if (!state || state.loading) return <Text style={{ color: colors.mutedForeground, paddingVertical: 10 }}>{copy("Loading current records…")}</Text>;
  if (state.error) return <Text accessibilityRole="alert" style={{ color: colors.destructive, paddingVertical: 10 }}>{copy(state.error)}</Text>;
  if (!state.items.length) return <Text style={{ color: colors.mutedForeground, paddingVertical: 10 }}>{copy("No current records")}</Text>;
  return <View style={{ gap: 6, paddingBottom: 8 }}>
    {state.capped && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{copy("Showing latest 50 · max 50")}</Text>}
    {state.items.map(item => { const warning = item.danger || item.tone === "red", accent = warning ? colors.destructive : item.tone === "amber" ? "#d97706" : item.tone === "green" ? "#16a34a" : colors.primary; return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={copy(`Open ${item.title}`)} onPress={() => item.driverUserId || item.assetId ? onOpen(item.module, undefined, undefined, undefined, item.driverUserId, item.assetId) : onOpen(item.module, item.runId, item.yardOrderId, item.runOrderId)} style={({ pressed }) => ({ backgroundColor: `${accent}12`, borderColor: colors.border, borderLeftColor: accent, borderLeftWidth: 3, borderRadius: 8, gap: 2, opacity: pressed ? .7 : 1, paddingHorizontal: 10, paddingVertical: 8 })}>
      <Text numberOfLines={1} style={{ color: warning ? colors.destructive : colors.text, fontSize: 13, fontWeight: "700" }}>{copy(item.title)}</Text>
      <Text numberOfLines={1} style={{ color: warning ? colors.destructive : colors.mutedForeground, fontSize: 12 }}>{copy(item.detail)} · {copy(item.status)}</Text>
    </Pressable>; })}
  </View>;
}

function OperationsRow({ row, expanded, preview, onToggle, onOpen }: { row: Row; expanded: boolean; preview?: PreviewState; onToggle: () => void; onOpen: FleetHomeProps["onOpen"] }) {
  const colors = useColors(), copy = useFleetCopy(), value = row.state === "unavailable" ? "Unavailable" : row.value;
  return <View style={{ borderTopColor: colors.border, borderTopWidth: 1 }}>
    <View style={{ alignItems: "center", flexDirection: "row" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={copy(`Open ${row.label}`)} onPress={() => row.expandable ? onToggle() : onOpen(row.module)} style={({ pressed }) => ({ alignItems: "center", flex: 1, flexDirection: "row", gap: 11, opacity: pressed ? .7 : 1, paddingVertical: 13 })}>
        <Feather name={row.icon} size={19} color={colors.primary} /><Text style={{ color: colors.text, flex: 1, fontSize: 15, fontWeight: "600" }}>{copy(row.label)}</Text>
        <Text style={{ color: row.state === "warning" || row.state === "unavailable" ? colors.destructive : colors.mutedForeground, fontSize: 13 }}>{copy(value)}</Text><Feather name={row.expandable && expanded ? "chevron-down" : "chevron-right"} size={18} color={colors.mutedForeground} />
      </Pressable>
      {row.createLabel && <Pressable accessibilityRole="button" accessibilityLabel={copy(row.createLabel)} onPress={() => onOpen(row.createModule ?? row.module)} style={{ padding: 8 }}><Feather name="plus-circle" size={19} color={colors.primary} /></Pressable>}
    </View>
    {row.expandable && expanded && <PreviewList state={preview} onOpen={onOpen} />}
  </View>;
}

function OperationsCard({ id, title, subtitle, icon, rows, wide, expanded, previews, onToggle, onOpen }: { id: string; title: string; subtitle: string; icon: React.ComponentProps<typeof Feather>["name"]; rows: Row[]; wide: boolean; expanded: DetailKind | null; previews: Partial<Record<DetailKind, PreviewState>>; onToggle: (kind: DetailKind) => void; onOpen: FleetHomeProps["onOpen"] }) {
  const colors = useColors(), copy = useFleetCopy();
  return <View testID={`fleet-home-${id}`} style={{ backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, paddingHorizontal: 16, paddingTop: 16, ...(wide ? { flex: 1, minWidth: 0 } : { width: "100%" }) }}>
    <View style={{ alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 14 }}><View style={{ alignItems: "center", backgroundColor: `${colors.primary}22`, borderRadius: 12, height: 40, justifyContent: "center", width: 40 }}><Feather name={icon} size={21} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontSize: 19, fontWeight: "700" }}>{copy(title)}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{copy(subtitle)}</Text></View></View>
    {rows.map(row => <OperationsRow key={row.key} row={row} expanded={!!row.expandable && expanded === row.expandable} preview={row.expandable ? previews[row.expandable] : undefined} onToggle={() => row.expandable && onToggle(row.expandable)} onOpen={onOpen} />)}
  </View>;
}

type FleetHomeProps = { projection: FleetHomeProjection; onOpen: (module: FleetModuleId, runId?: string, yardOrderId?: string, runOrderId?: string, driverUserId?: number, assetId?: string) => void; visibility?: FleetHomeVisibility; onRetry?: () => void };
export default function FleetHome({ projection, onOpen, visibility = {}, onRetry }: FleetHomeProps) {
  const colors = useColors(), copy = useFleetCopy(), { width } = useWindowDimensions(), wide = width >= 768;
  const [expanded, setExpanded] = useState<DetailKind | null>(null), [previews, setPreviews] = useState<Partial<Record<DetailKind, PreviewState>>>({});
  const generation = useRef(0), capabilities = new Set(projection.capabilities), admin = capabilities.has("admin"), dispatch = admin || capabilities.has("dispatch") || capabilities.has("self_dispatch"), yard = admin || capabilities.has("yard") || dispatch, office = admin || capabilities.has("office"), driver = capabilities.has("driver"), independent = projection.mode === "my_fleet_day";
  const state = (module: string) => projection.moduleStates.find(item => item.module === module)?.state, metrics = projection.metrics;
  async function load(kind: DetailKind) {
    if (previews[kind]) return;
    if (kind !== "builder" && projection.previews) {
      const saved = projection.previews[kind];
      if (Array.isArray(saved)) {
        const module: FleetModuleId = kind === "yard" ? "yard" : kind === "ready" ? "dispatch" : kind === "history" ? "history" : kind === "drivers" ? "drivers" : kind === "equipment" ? "assets" : kind === "compliance" ? "compliance" : independent || driver && !dispatch && !office ? "driver" : "dispatch";
        setPreviews(value => ({ ...value, [kind]: { loading: false, capped: kind === "history" && projection.previews?.historyCapped, items: saved.map((item: any) => ({ ...item, id: item.id ?? `driver-${item.userId}`, module, tone: kind === "drivers" ? item.status === "available" ? "green" : "gray" : kind === "equipment" ? item.status === "available" ? "green" : item.status === "unavailable" ? "red" : "gray" : kind === "compliance" ? item.status : undefined, runId: ["yard", "drivers", "equipment", "compliance"].includes(kind) ? (kind === "yard" ? item.runId ?? undefined : undefined) : item.id, yardOrderId: kind === "yard" ? item.id : undefined, driverUserId: kind === "drivers" || kind === "compliance" && item.target === "driver" ? Number(item.userId ?? item.targetId) : undefined, assetId: kind === "equipment" ? String(item.id) : kind === "compliance" && item.target === "equipment" ? String(item.targetId) : undefined })) } }));
        return;
      }
    }
    setPreviews(value => ({ ...value, [kind]: { loading: true, items: [] } }));
    const request = ++generation.current, scope = captureAuthScope();
    try {
      let items: Preview[] = [], capped = false;
      if (kind === "builder") {
        const page = FleetRunOrderPageSchema.parse(await apiFetch("/api/fleet/run-orders", {}, scope));
        items = page.orders.map(order => ({ id: order.id, title: order.name, detail: `${order.origin.name} → ${order.destination.name}`, status: "Edit Run", module: "runs", runOrderId: order.id }));
      } else {
        const [overviewRaw, yardRaw] = await Promise.all([
          kind === "yard" ? Promise.resolve(null) : apiFetch("/api/fleet/overview", {}, scope),
          kind === "yard" || kind === "ready" ? apiFetch("/api/fleet/yard-orders", {}, scope) : Promise.resolve(null),
        ]), overview = overviewRaw as FleetOverview | null, orders = yardRaw ? FleetYardOrderSchema.array().parse((yardRaw as { orders?: unknown }).orders) : [];
        const orderFor = (runId: string) => orders.find(order => order.runId === runId);
        if (kind === "yard") items = orders.filter(order => order.status !== "reported" || order.outcome !== "ready").map(order => ({ id: order.id, title: order.notes || `Yard Order ${order.id.slice(0, 8)}`, detail: `${order.requestedAssetIds.length} components · ${words(order.status)}`, status: order.outcome ? words(order.outcome) : order.assignedToUserId ? "Yard assigned" : "Awaiting assignment", danger: order.outcome === "unable_to_complete" || order.outcome === "needs_attention", module: "yard", runId: order.runId ?? undefined, yardOrderId: order.id }));
        if (kind === "ready") items = overview!.runs.filter(run => run.status === "draft" && (!orderFor(run.id) || orderFor(run.id)?.outcome === "ready")).map(run => ({ id: run.id, title: run.linkedTicketId ? `Ticket #${run.linkedTicketId} · ${run.title}` : run.title, detail: `${route(run)} · Yard: ${yardReadiness(orderFor(run.id))}`, status: `Driver: ${driverReadiness(run)}`, module: "dispatch", runId: run.id }));
        if (kind === "active") items = overview!.runs.filter(run => ["dispatched", "acknowledged", "in_progress"].includes(run.status)).map(run => ({ id: run.id, title: run.linkedTicketId ? `Ticket #${run.linkedTicketId} · ${run.title}` : run.title, detail: route(run), status: driverReadiness(run), module: independent || driver && !dispatch && !office ? "driver" : "dispatch", runId: run.id }));
        if (kind === "history") { const history = overview!.runs.filter(run => ["submitted_for_review", "completed", "cancelled"].includes(run.status)).slice(0, 50); capped = history.length === 50 || !!overview!.page?.nextCursor; items = history.map(run => ({ id: run.id, title: run.linkedTicketId ? `Ticket #${run.linkedTicketId} · ${run.title}` : run.title, detail: route(run), status: words(run.status), module: "history", runId: run.id })); }
      }
      if (request === generation.current && isAuthScopeCurrent(scope)) setPreviews(value => ({ ...value, [kind]: { loading: false, items, capped } }));
    } catch { if (request === generation.current && isAuthScopeCurrent(scope)) setPreviews(value => ({ ...value, [kind]: { loading: false, items: [], error: "Current records are unavailable. Open the workspace to retry." } })); }
  }
  const toggle = (kind: DetailKind) => { const next = expanded === kind ? null : kind; setExpanded(next); if (next) void load(next); };
  const dispatchRows: Row[] = [
    ...(yard && visibility.yard !== false ? [{ key: "yard", label: "Yard Orders", value: count(metrics?.yardOrders, "open", copy), icon: "package" as const, module: "yard" as const, state: state("yard"), expandable: "yard" as const }] : []),
    ...(dispatch && !independent && visibility.dispatch !== false ? [{ key: "ready", label: "Ready for Dispatch", value: count(metrics?.awaitingDispatch, "ready", copy), icon: "truck" as const, module: "dispatch" as const, state: state("dispatch"), expandable: "ready" as const }] : []),
    ...((driver || dispatch || office) ? [{ key: "active", label: "Active Ticket Runs", value: count(metrics?.activeRuns, "active", copy), icon: "repeat" as const, module: "dispatch" as FleetModuleId, state: state("history"), expandable: "active" as const }] : []),
    ...(!independent && (dispatch || office) ? [{ key: "builder", label: "Run Builder", value: copy("Saved Runs"), icon: "plus-square" as const, module: "runs" as const, state: state("history"), expandable: "builder" as const, createLabel: "Create New Run", createModule: "runs" as const }] : []),
    ...(!independent && (driver || dispatch || office) ? [{ key: "history", label: "Run History", value: count(metrics?.runHistory, "runs", copy), icon: "clock" as const, module: "history" as const, state: state("history"), expandable: "history" as const }] : []),
  ];
  const readinessRows: Row[] = [
    ...(dispatch ? [{ key: "drivers", label: "Available Drivers", value: count(metrics?.availableDrivers, "available", copy), icon: "users" as const, module: "drivers" as const, state: state("assets"), expandable: "drivers" as const, createLabel: "Add a Driver", createModule: "drivers" as const }] : []),
    ...(yard && visibility.assets !== false ? [{ key: "inventory", label: "Equipment & Yard Safety", value: metrics?.equipmentInUse == null ? copy("Unavailable") : `${metrics.equipmentInUse} ${copy("in use")} · ${metrics.equipmentAvailable} ${copy("available")} · ${metrics.equipmentUnavailable} ${copy("unavailable")}`, icon: "box" as const, module: "assets" as const, state: state("assets"), expandable: "equipment" as const }] : []),
    ...((admin || office || dispatch) && visibility.compliance !== false ? [{ key: "compliance", label: "Compliance & Safety", value: metrics?.complianceScore == null ? copy("Unavailable") : `${metrics.complianceScore} · ${metrics.complianceStatus ? copy(metrics.complianceStatus).replace(/^./, c => c.toUpperCase()) : copy("Unscored")}`, icon: "shield" as const, module: "compliance" as const, state: state("compliance"), expandable: "compliance" as const }] : []),
  ];
  const primary = projection.nextAction, unavailable = projection.moduleStates.some(item => item.state === "unavailable"), actionModule = primary?.kind === "report_yard_order" ? "yard" : primary?.kind === "review_closeout" || primary?.kind === "review_ticket" || primary?.kind === "finalize_ticket" ? "office" : primary?.kind === "prepare_detail" ? "dispatch" : "driver";
  const tools = [...(admin || dispatch ? [{ label: "Fleet Map", icon: "map" as const, module: "map" as const }] : []), ...(office ? [{ label: "Office Review", icon: "briefcase" as const, module: "office" as const }] : []), ...(admin ? [{ label: "Fleet Setup", icon: "settings" as const, module: "setup" as const }] : [])].filter(tool => visibility[tool.module] !== false || tool.module === "setup");
  return <View style={{ gap: 16 }}>
    <View style={{ gap: 4 }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{copy(independent ? "My Fleet Day" : "Operations")}</Text><Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{copy(independent ? "Your next job, route, and return" : "Dispatch work and confirm Fleet readiness")}</Text></View>
    {unavailable && <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy("Some Fleet information is unavailable. Open a row for its current records.")}</Text>{onRetry && <TogglePillButton color="blue" accessibilityLabel={copy("Retry Fleet Home")} onPress={onRetry}>{copy("Retry Fleet Home")}</TogglePillButton>}</View>}
    {primary && <View testID="fleet-home-next" style={{ backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 16, borderWidth: 2, gap: 10, padding: 16 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{copy("Next action")}</Text><TogglePillButton solid accessibilityLabel={copy(primary.label)} onPress={() => primary.yardOrderId ? onOpen(actionModule, primary.runId ?? undefined, primary.yardOrderId) : onOpen(actionModule, primary.runId ?? undefined)}>{copy(primary.label)}</TogglePillButton></View>}
    {projection.warnings.map(warning => <Text key={warning.id} accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(warning.message)}</Text>)}
    <View testID="fleet-home-cards" style={{ flexDirection: wide && !independent && readinessRows.length ? "row" : "column", flexWrap: "wrap", gap: 12 }}>
      {!!dispatchRows.length && <OperationsCard id="dispatch" title="Dispatch" subtitle={independent ? "Your yard work and active runs" : "Plan, release, track, and review runs"} icon="truck" rows={dispatchRows} wide={wide && !independent && readinessRows.length > 0} expanded={expanded} previews={previews} onToggle={toggle} onOpen={onOpen} />}
      {!independent && !!readinessRows.length && <OperationsCard id="readiness" title="Fleet Readiness" subtitle="People, equipment, compliance, and safety" icon="check-circle" rows={readinessRows} wide={wide} expanded={expanded} previews={previews} onToggle={toggle} onOpen={onOpen} />}
    </View>
    {!!tools.length && <View style={{ gap: 10 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{copy("More tools")}</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{tools.map(tool => <Pressable key={tool.label} accessibilityRole="button" accessibilityLabel={copy(`Open ${tool.label}`)} onPress={() => onOpen(tool.module)} style={({ pressed }) => ({ alignItems: "center", backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 14, borderWidth: 2, flexDirection: "row", gap: 8, opacity: pressed ? .72 : 1, paddingHorizontal: 14, paddingVertical: 11 })}><Feather name={tool.icon} size={18} color={colors.primary} /><Text style={{ color: colors.text, fontWeight: "600" }}>{copy(tool.label)}</Text></Pressable>)}</View></View>}
  </View>;
}
