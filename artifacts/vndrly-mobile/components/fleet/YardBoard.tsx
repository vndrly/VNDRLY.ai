import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetYardOrderSchema, FleetYardSchema, FleetDetailPageSchema, type FleetYardOrder, type FleetYard, type FleetYardOrderAction, type FleetDetail } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
import FleetChoiceField from "@/components/FleetChoiceField";
import { readFleetYardActor, yardScope, type FleetYardActor } from "./yard-client";

type OrderDetail = { order: FleetYardOrder; events: { id: string; type: string; at: string; detail: unknown }[] };
type Attempt = { id: string; input: FleetYardOrderAction } | { input: { operationId: string; expectedVersion: 0; scope: ReturnType<typeof yardScope>; order: FleetYardOrder } };

export default function YardBoard({ initialYardOrderId, initialRunId }: { initialYardOrderId?: string; initialRunId?: string }) {
  const { user, activeMembership, activeMembershipId } = useAuth();
  const identity = { companyId: activeMembership?.orgId ?? user?.vendorId ?? 0, userId: user?.id ?? 0, membershipId: activeMembershipId ?? user?.activeMembershipId ?? 0 };
  const identityKey = `${identity.companyId}:${identity.userId}:${identity.membershipId}`;
  return <YardBoardContent key={identityKey} identity={identity} initialYardOrderId={initialYardOrderId} initialRunId={initialRunId} />;
}

function YardBoardContent({ identity, initialYardOrderId, initialRunId }: { identity: { companyId: number; userId: number; membershipId: number }; initialYardOrderId?: string; initialRunId?: string }) {
  const colors = useColors(), copy = useFleetCopy();
  const authScope = useRef(captureAuthScope());
  const alive = useRef(true), lock = useRef(false), pending = useRef<Attempt | null>(null);
  const [actor, setActor] = useState<FleetYardActor | null>(null);
  const [yards, setYards] = useState<FleetYard[]>([]), [orders, setOrders] = useState<FleetYardOrder[]>([]);
  const [selectedId, setSelectedId] = useState(initialYardOrderId ?? "");
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false), [availableDetails, setAvailableDetails] = useState<FleetDetail[]>([]);
  const [yardId, setYardId] = useState(""), [detailId, setDetailId] = useState(""), [runId, setRunId] = useState(initialRunId ?? ""), [scheduledAt, setScheduledAt] = useState(""), [notes, setNotes] = useState("");
  const [missing, setMissing] = useState<string[]>([]), [reportNotes, setReportNotes] = useState(""), [assignee, setAssignee] = useState("");
  const [damaged, setDamaged] = useState<string[]>([]);
  const [alternatives, setAlternatives] = useState<{ assetId: string; available: boolean; reasons: string[] }[]>([]);
  const [substitutions, setSubstitutions] = useState<Record<string, { assetId: string; reasons: string[] }>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const current = () => alive.current && isAuthScopeCurrent(authScope.current);
  const read = async <T,>(path: string): Promise<T> => {
    const value = await apiFetch<T>(path, {}, authScope.current);
    if (!current()) throw Error("Fleet account changed. Refresh this workspace.");
    return value;
  };
  async function load() {
    try {
      const nextActor = await readFleetYardActor(identity, authScope.current);
      if (!current()) return;
      const [yardPage, orderPage] = await Promise.all([
        read<{ yards: unknown[] }>("/api/fleet/yards"),
        read<{ orders: unknown[] }>("/api/fleet/yard-orders"),
      ]);
      const nextYards = yardPage.yards.map(value => FleetYardSchema.parse(value));
      if (nextYards.some(yard => yard.companyId !== identity.companyId)) throw Error("Yard company scope mismatch.");
      const nextOrders = orderPage.orders.map(value => FleetYardOrderSchema.parse(value));
      if (nextOrders.some(order => order.companyId !== identity.companyId)) throw Error("Yard Order company scope mismatch.");
      if (!current()) return;
      setActor(nextActor); setYards(nextYards); setOrders(nextOrders);
      setYardId(value => value || nextYards.find(yard => yard.isHomeBase)?.id || nextYards[0]?.id || "");
      if (selectedId) await loadOrder(selectedId);
      setError("");
    } catch (cause) { if (current()) {
      if ([401, 403, 404].includes((cause as { status?: number }).status ?? 0)) { setActor(null); setYards([]); setOrders([]); setDetail(null); setShowCreate(false); pending.current = null; }
      setError(cause instanceof Error ? cause.message : "Yard Board unavailable.");
    } }
  }
  async function loadOrder(id: string, minimumVersion = 0) {
    const value = await read<OrderDetail>(`/api/fleet/yard-orders/${encodeURIComponent(id)}`);
    const order = FleetYardOrderSchema.parse(value.order);
    if (order.id !== id || order.companyId !== identity.companyId) throw Error("Yard Order scope mismatch.");
    if (order.version < minimumVersion) throw Error("Yard Order readback mismatch. Retry the exact request.");
    if (current()) { setDetail({ order, events: value.events }); setSelectedId(id); setMissing([]); setDamaged([]); setReportNotes(""); setAlternatives([]); setSubstitutions({}); setOrders(prior => [order, ...prior.filter(item => item.id !== id)]); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  async function act(input: FleetYardOrderAction) {
    if (lock.current || !actor || !detail) return;
    pending.current ??= { id: detail.order.id, input };
    const exact = pending.current;
    if (!("id" in exact)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = FleetYardOrderSchema.parse(await apiFetch(`/api/fleet/yard-orders/${exact.id}/actions`, { method: "POST", body: JSON.stringify(exact.input) }, authScope.current));
      if (result.id !== exact.id || result.version < exact.input.expectedVersion + 1) throw Error("Yard Order readback mismatch.");
      await loadOrder(exact.id, result.version);
      if (!current()) return;
      pending.current = null; setNotice(copy("Yard Order saved."));
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Yard action needs recovery. Retry the same request."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  function action(kind: "assign" | "start" | "report", outcome?: "ready" | "needs_attention" | "unable_to_complete") {
    if (!actor || !detail) return;
    const common = { operationId: Crypto.randomUUID(), expectedVersion: detail.order.version, scope: yardScope(actor), orderId: detail.order.id };
    if (kind === "assign") { const userId = Number(assignee) || actor.userId; void act({ ...common, kind, assignedToUserId: userId }); }
    else if (kind === "start") void act({ ...common, kind });
    else void act({ ...common, kind, outcome: outcome!, actualAssetIds: [...detail.order.requestedAssetIds.filter(id => !missing.includes(id)), ...Object.values(substitutions).map(item => item.assetId)], findings: [...missing.map(assetId => substitutions[assetId] ? { assetId, kind: "substituted" as const, note: `Substituted with ${substitutions[assetId].assetId}; advisory: ${substitutions[assetId].reasons.join(", ") || "none"}` } : { assetId, kind: "missing" as const, note: "Component missing at Yard" }), ...damaged.filter(id => !missing.includes(id)).map(assetId => ({ assetId, kind: "damaged" as const, note: reportNotes || "Component damaged at Yard" }))], notes: reportNotes });
  }
  async function reviewAlternatives() {
    if (!order?.yardId) return;
    const startAt = order.scheduledAt ?? new Date().toISOString();
    const endAt = new Date(Date.parse(startAt) + 24 * 60 * 60 * 1000).toISOString();
    const query = new URLSearchParams({ startAt, endAt });
    try {
      const value = await read<{ candidates: { assetId: string; available: boolean; reasons: string[] }[] }>(`/api/fleet/yards/${encodeURIComponent(order.yardId)}/suggestions?${query}`);
      if (current()) setAlternatives(value.candidates.filter(candidate => !order.requestedAssetIds.includes(candidate.assetId)));
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Alternatives unavailable."); }
  }
  async function createOrder() {
    if (!actor || lock.current || !yardId || (!detailId && !runId)) { setError("Choose a Yard and a Detail or Run."); return; }
    const chosen = availableDetails.find(item => item.id === detailId);
    const now = new Date().toISOString();
    const order = FleetYardOrderSchema.parse({ id: Crypto.randomUUID(), companyId: actor.companyId, version: 1, yardId, detailId: chosen?.id ?? null, runId: runId || null, status: "requested", outcome: null, requestedByUserId: actor.userId, assignedToUserId: null, requestedAt: now, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null, startedAt: null, reportedAt: null, requestedAssetIds: chosen ? [chosen.vehicleAssetId] : [], actualAssetIds: [], findings: [], notes });
    pending.current ??= { input: { operationId: Crypto.randomUUID(), expectedVersion: 0, scope: yardScope(actor), order } };
    const exact = pending.current;
    if ("id" in exact) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const saved = FleetYardOrderSchema.parse(await apiFetch("/api/fleet/yard-orders", { method: "POST", body: JSON.stringify(exact.input) }, authScope.current));
      if (saved.id !== exact.input.order.id) throw Error("Yard Order receipt mismatch.");
      await loadOrder(saved.id);
      pending.current = null; setShowCreate(false); setNotice("Yard Order requested.");
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Yard Order needs recovery. Retry the same request."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  async function openCreate() {
    setShowCreate(true); setDetail(null); setSelectedId("");
    try { const page = FleetDetailPageSchema.parse(await read("/api/fleet/details")); setAvailableDetails(page.details); }
    catch { setAvailableDetails([]); }
  }
  const order = detail?.order;
  const canAssign = actor?.capabilities.some(value => ["admin", "dispatch", "self_dispatch"].includes(value));
  const canAssignOthers = actor?.capabilities.some(value => ["admin", "dispatch"].includes(value));
  const canWork = actor?.capabilities.some(value => ["admin", "dispatch", "yard", "self_dispatch"].includes(value));
  const canProgress = canWork && !!order && (order.assignedToUserId === actor?.userId || !!actor?.capabilities.some(value => ["admin", "dispatch"].includes(value)));
  const card = { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2, borderRadius: 16, padding: 16, gap: 10 } as const;
  return <View style={{ gap: 16 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{copy("Yard Board")}</Text>
    <Text style={{ color: colors.mutedForeground }}>{copy("Receive, assemble, and report readiness for the exact Yard Order.")}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {!!notice && <Text style={{ color: colors.text }}>{notice}</Text>}
    <TogglePillButton color="blue" disabled={busy} onPress={() => void load()}>{copy("Refresh Yard Board")}</TogglePillButton>
    {!selectedId && !showCreate && <View style={{ gap: 10 }}>
      {canAssign && <TogglePillButton color="blue" onPress={() => void openCreate()}>{copy("Request Yard work")}</TogglePillButton>}
      {orders.map(item => <View key={item.id} style={card}><Text style={{ color: colors.text, fontWeight: "700" }}>{item.notes || copy("Yard Order")}</Text><Text style={{ color: colors.mutedForeground }}>{yards.find(yard => yard.id === item.yardId)?.name ?? copy("No Yard assigned")} · {item.status.replaceAll("_", " ")}</Text><TogglePillButton color="blue" accessibilityLabel={`Open Yard Order ${item.id}`} onPress={() => void loadOrder(item.id)}>{copy("Open Yard Order")}</TogglePillButton></View>)}
    </View>}
    {showCreate && actor && <View style={card}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>{copy("Request Yard work")}</Text>
      <FleetChoiceField label="Yard" value={yardId} options={yards.filter(yard => yard.active).map(yard => ({ id: yard.id, label: yard.name }))} onChange={setYardId} disabled={busy} />
      <FleetChoiceField label="Reusable Detail" value={detailId} options={[{ id: "", label: "Choose from a Run" }, ...availableDetails.map(item => ({ id: item.id, label: item.name }))]} onChange={setDetailId} disabled={busy} />
      <TextInput accessibilityLabel="Run ID" placeholder="Optional assigned Run ID" value={runId} onChangeText={setRunId} editable={!busy} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TextInput accessibilityLabel="Scheduled time" placeholder="Optional ISO time" value={scheduledAt} onChangeText={setScheduledAt} editable={!busy} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TextInput accessibilityLabel="Work request" value={notes} onChangeText={setNotes} editable={!busy} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TogglePillButton color="blue" disabled={busy} onPress={() => void createOrder()}>{copy("Save Yard request")}</TogglePillButton>
      <TogglePillButton disabled={busy || !!pending.current} onPress={() => setShowCreate(false)}>{copy("Cancel")}</TogglePillButton>
    </View>}
    {order && <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{order.notes || copy("Yard Order")}</Text>
      <Text style={{ color: colors.mutedForeground }}>{yards.find(yard => yard.id === order.yardId)?.name ?? copy("No Yard")} · {order.status.replaceAll("_", " ")}</Text>
      <Text style={{ color: colors.text }}>{copy("Requested components")}: {order.requestedAssetIds.length}</Text>
      {order.findings.map((finding, index) => <Text key={`${finding.assetId}:${index}`} accessibilityRole="alert" style={{ color: colors.destructive }}>{finding.kind}: {finding.assetId} · {finding.note}</Text>)}
      {order.status === "reported" && <Text style={{ color: colors.text }}>{`Reported · ${order.outcome?.replaceAll("_", " ")}`}</Text>}
      {order.status === "requested" && canAssign && <View style={{ gap: 8 }}>{canAssignOthers && <TextInput accessibilityLabel="Assign Yard worker user ID" placeholder="Leave blank to assign yourself" keyboardType="numeric" value={assignee} onChangeText={setAssignee} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />}<TogglePillButton color="blue" disabled={busy} onPress={() => action("assign")}>{canAssignOthers && assignee ? copy("Assign Yard worker") : copy("Assign to me")}</TogglePillButton></View>}
      {order.status === "assigned" && canProgress && <TogglePillButton color="blue" disabled={busy} onPress={() => action("start")}>{copy("Start Yard work")}</TogglePillButton>}
      {order.status === "in_progress" && canProgress && <View style={{ gap: 10 }}>
        <Text style={{ color: colors.mutedForeground }}>{copy("Check requested components. Findings are advisory and remain on the report.")}</Text>
        {order.requestedAssetIds.map((assetId, index) => <TogglePillButton key={assetId} color="blue" disabled={busy} onPress={() => setMissing(prior => prior.includes(assetId) ? prior.filter(id => id !== assetId) : [...prior, assetId])}>{missing.includes(assetId) ? `Found component ${index + 1}` : "Missing component"}</TogglePillButton>)}
        {order.requestedAssetIds.map((assetId, index) => <TogglePillButton key={`condition:${assetId}`} color="blue" disabled={busy} onPress={() => setDamaged(prior => prior.includes(assetId) ? prior.filter(id => id !== assetId) : [...prior, assetId])}>{damaged.includes(assetId) ? `Condition cleared ${index + 1}` : "Damaged component"}</TogglePillButton>)}
        {!!missing.length && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{`${missing.length} component missing. You can still report an outcome.`}</Text>}
        {!!missing.length && <TogglePillButton color="blue" disabled={busy} onPress={() => void reviewAlternatives()}>{copy("Review alternatives")}</TogglePillButton>}
        {alternatives.map(candidate => <View key={candidate.assetId} style={{ gap: 4 }}><Text style={{ color: candidate.available ? colors.text : colors.destructive }}>{candidate.reasons.length ? candidate.reasons.join(", ") : copy("Co-located and unreserved")}</Text><TogglePillButton color="blue" disabled={busy} accessibilityLabel={`Use ${candidate.assetId}`} onPress={() => { const original = missing.find(id => !substitutions[id]) ?? missing[0]; if (original) setSubstitutions(prior => ({ ...prior, [original]: candidate })); }}>{`Use ${candidate.assetId}`}</TogglePillButton></View>)}
        <TextInput accessibilityLabel="Yard report reasons" placeholder="Condition and substitution reasons" value={reportNotes} onChangeText={setReportNotes} editable={!busy} multiline style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
        <TogglePillButton color="green" disabled={busy} onPress={() => action("report", "ready")}>{copy("Ready")}</TogglePillButton>
        <TogglePillButton color="blue" disabled={busy} onPress={() => action("report", "needs_attention")}>{copy("Needs attention")}</TogglePillButton>
        <TogglePillButton color="blue" disabled={busy} onPress={() => action("report", "unable_to_complete")}>{copy("Unable to complete")}</TogglePillButton>
      </View>}
      {detail.events.length > 0 && <View style={{ gap: 4 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{copy("Yard history")}</Text>{detail.events.map(event => <Text key={event.id} style={{ color: colors.mutedForeground }}>{event.type} · {new Date(event.at).toLocaleString()}</Text>)}</View>}
      {!initialYardOrderId && <TogglePillButton onPress={() => { setSelectedId(""); setDetail(null); }}>{copy("All Yard Orders")}</TogglePillButton>}
    </View>}
  </View>;
}
