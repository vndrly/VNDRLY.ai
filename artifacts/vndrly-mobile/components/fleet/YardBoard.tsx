import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetYardOrderSchema, FleetYardOrderInputSchema, FleetYardSchema, FleetDetailPageSchema, FleetInventorySchema, type FleetInventoryAsset, type FleetYardOrder, type FleetYard, type FleetYardOrderAction, type FleetDetail } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
import FleetChoiceField from "@/components/FleetChoiceField";
import { readFleetYardActor, yardFeedback, yardScope, type FleetYardActor } from "./yard-client";

type OrderDetail = { order: FleetYardOrder; events: { id: string; type: string; at: string; detail: unknown }[] };
type Attempt = { id: string; input: FleetYardOrderAction } | { input: ReturnType<typeof FleetYardOrderInputSchema.parse> };

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
  const [assetNames, setAssetNames] = useState<Record<string, FleetInventoryAsset>>({});
  const [reviewAction, setReviewAction] = useState<"assign" | "start" | "report" | null>(null);
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
      if (selectedId) await loadOrder(selectedId, 0, !!pending.current || !!reviewAction);
      setError("");
    } catch (cause) { if (current()) {
      if ([401, 403, 404].includes((cause as { status?: number }).status ?? 0)) { setActor(null); setYards([]); setOrders([]); setDetail(null); setShowCreate(false); pending.current = null; }
      setError(yardFeedback(cause, copy, "Yard Board unavailable.", "yard"));
    } }
  }
  async function loadOrder(id: string, minimumVersion = 0, preserveDraft = false) {
    const value = await read<OrderDetail>(`/api/fleet/yard-orders/${encodeURIComponent(id)}`);
    const order = FleetYardOrderSchema.parse(value.order);
    if (order.id !== id || order.companyId !== identity.companyId) throw Error("Yard Order scope mismatch.");
    if (order.version < minimumVersion) throw Error("Yard Order readback mismatch. Retry the exact request.");
    if (current()) { setDetail({ order, events: value.events }); setSelectedId(id); if (!preserveDraft) { setMissing([]); setDamaged([]); setReportNotes(""); setAlternatives([]); setSubstitutions({}); } setOrders(prior => [order, ...prior.filter(item => item.id !== id)]); }
    const names = await Promise.all(order.requestedAssetIds.map(async assetId => {
      try { const page = FleetInventorySchema.parse(await read(`/api/fleet/yard-assets?assetId=${encodeURIComponent(assetId)}`)); return page.assets[0]; }
      catch { return null; }
    }));
    if (current()) setAssetNames(prior => ({ ...prior, ...Object.fromEntries(names.filter((asset): asset is FleetInventoryAsset => !!asset).map(asset => [asset.id, asset])) }));
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  async function act(input: FleetYardOrderAction) {
    if (lock.current || !actor || !detail) return;
    if (pending.current && (!("id" in pending.current) || pending.current.id !== detail.order.id)) { setError(copy("Finish recovering the selected Yard Order before changing orders.")); return; }
    const retry = !!pending.current;
    pending.current ??= { id: detail.order.id, input };
    const exact = pending.current;
    if (!("id" in exact)) return;
    lock.current = true; setBusy(true); setError("");
    let posting = false;
    try {
      let receipt: FleetYardOrder | null = null;
      if (retry) try {
        const found = await read<{ operationId: string; result: unknown }>(`/api/fleet/yard-orders/operations/${exact.input.operationId}`);
        receipt = FleetYardOrderSchema.parse(found.result);
      } catch (cause) { if ((cause as { status?: number }).status !== 404) throw cause; }
      let response: unknown = receipt;
      if (!response) { posting = true; response = await apiFetch(`/api/fleet/yard-orders/${exact.id}/actions`, { method: "POST", body: JSON.stringify(exact.input) }, authScope.current); posting = false; }
      const result = FleetYardOrderSchema.parse(response);
      if (result.id !== exact.id || result.version < exact.input.expectedVersion + 1) throw Error("Yard Order readback mismatch.");
      await loadOrder(exact.id, result.version);
      if (!current()) return;
      pending.current = null; setReviewAction(null); setNotice(copy("Yard Order saved."));
    } catch (cause) { if (current()) {
      const status = (cause as { status?: number }).status;
      if (posting && status && status >= 400 && status < 500 && ![408, 429].includes(status)) {
        pending.current = null;
        if (status === 409) { setReviewAction(exact.input.kind); try { await loadOrder(exact.id, 0, true); } catch { /* Keep the draft and allow refresh. */ } setError(copy("Yard Order changed. Review your findings, then reapply.")); }
        else setError(yardFeedback(cause, copy, "Yard action was rejected. Review and correct it.", "yard"));
      } else setError(yardFeedback(cause, copy, "Yard action needs recovery. Retry the same request.", "yard"));
    } }
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
    } catch (cause) { if (current()) setError(yardFeedback(cause, copy, "Alternatives unavailable.", "yard")); }
  }
  async function createOrder() {
    if (!actor || lock.current) return;
    let posting = false;
    try {
      const retry = !!pending.current;
      if (!pending.current) {
        if (!yardId || (!detailId && !runId)) throw Error(copy("Choose a Yard and a Detail or Run."));
        if (runId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) throw Error(copy("Run ID must be a valid identifier."));
        if (scheduledAt && !Number.isFinite(Date.parse(scheduledAt))) throw Error(copy("Scheduled time must be a valid date and time."));
        const chosen = availableDetails.find(item => item.id === detailId);
        const now = new Date().toISOString();
        const order = FleetYardOrderSchema.parse({ id: Crypto.randomUUID(), companyId: actor.companyId, version: 1, yardId, detailId: chosen?.id ?? null, runId: runId || null, status: "requested", outcome: null, requestedByUserId: actor.userId, assignedToUserId: null, requestedAt: now, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null, startedAt: null, reportedAt: null, requestedAssetIds: chosen ? [chosen.vehicleAssetId] : [], actualAssetIds: [], findings: [], notes });
        pending.current = { input: FleetYardOrderInputSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: 0, scope: yardScope(actor), order }) };
      }
      const exact = pending.current!;
      if ("id" in exact) return;
      lock.current = true; setBusy(true); setError("");
      let receipt: FleetYardOrder | null = null;
      if (retry) try { const found = await read<{ operationId: string; result: unknown }>(`/api/fleet/yard-orders/operations/${exact.input.operationId}`); receipt = FleetYardOrderSchema.parse(found.result); }
      catch (cause) { if ((cause as { status?: number }).status !== 404) throw cause; }
      let response: unknown = receipt;
      if (!response) { posting = true; response = await apiFetch("/api/fleet/yard-orders", { method: "POST", body: JSON.stringify(exact.input) }, authScope.current); posting = false; }
      const saved = FleetYardOrderSchema.parse(response);
      if (saved.id !== exact.input.order.id) throw Error("Yard Order receipt mismatch.");
      await loadOrder(saved.id);
      pending.current = null; setShowCreate(false); setNotice(copy("Yard Order requested."));
    } catch (cause) { if (current()) { const status = (cause as { status?: number }).status; if (posting && status && status >= 400 && status < 500 && ![408, 429].includes(status)) pending.current = null; setError(yardFeedback(cause, copy, "Yard Order needs recovery. Retry the same request.", "yard")); } }
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
  const assetLabel = (id: string) => { const asset = assetNames[id]; return asset ? `${asset.name} · ${asset.aliases[0]?.value ?? asset.category} · ${id}` : id; };
  return <View style={{ gap: 16 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{copy("Yard Board")}</Text>
    <Text style={{ color: colors.mutedForeground }}>{copy("Receive, assemble, and report readiness for the exact Yard Order.")}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {!!notice && <Text style={{ color: colors.text }}>{notice}</Text>}
    <TogglePillButton color="blue" disabled={busy} onPress={() => void load()}>{copy("Refresh Yard Board")}</TogglePillButton>
    {!selectedId && !showCreate && <View style={{ gap: 10 }}>
      {canAssign && <TogglePillButton color="blue" onPress={() => void openCreate()}>{copy("Request Yard work")}</TogglePillButton>}
      {orders.map(item => <View key={item.id} style={card}><Text style={{ color: colors.text, fontWeight: "700" }}>{item.notes || copy("Yard Order")}</Text><Text style={{ color: colors.mutedForeground }}>{yards.find(yard => yard.id === item.yardId)?.name ?? copy("No Yard assigned")} · {copy(item.status.replaceAll("_", " "))}</Text><TogglePillButton color="blue" accessibilityLabel={`${copy("Open Yard Order")} ${item.id}`} onPress={() => void loadOrder(item.id)}>{copy("Open Yard Order")}</TogglePillButton></View>)}
    </View>}
    {showCreate && actor && <View style={card}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>{copy("Request Yard work")}</Text>
      <FleetChoiceField label={copy("Yard")} value={yardId} options={yards.filter(yard => yard.active).map(yard => ({ id: yard.id, label: yard.name }))} onChange={setYardId} disabled={busy || !!pending.current} />
      <FleetChoiceField label={copy("Reusable Detail")} value={detailId} options={[{ id: "", label: copy("Choose from a Run") }, ...availableDetails.map(item => ({ id: item.id, label: item.name }))]} onChange={setDetailId} disabled={busy || !!pending.current} />
      <TextInput accessibilityLabel={copy("Run ID")} placeholder={copy("Optional assigned Run ID")} value={runId} onChangeText={setRunId} editable={!busy && !pending.current} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TextInput accessibilityLabel={copy("Scheduled time")} placeholder={copy("Optional ISO time")} value={scheduledAt} onChangeText={setScheduledAt} editable={!busy && !pending.current} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TextInput accessibilityLabel={copy("Work request")} value={notes} onChangeText={setNotes} editable={!busy && !pending.current} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TogglePillButton color="blue" disabled={busy} onPress={() => void createOrder()}>{copy("Save Yard request")}</TogglePillButton>
      <TogglePillButton disabled={busy || !!pending.current} onPress={() => setShowCreate(false)}>{copy("Cancel")}</TogglePillButton>
    </View>}
    {order && <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{order.notes || copy("Yard Order")}</Text>
      <Text style={{ color: colors.mutedForeground }}>{yards.find(yard => yard.id === order.yardId)?.name ?? copy("No Yard")} · {copy(order.status.replaceAll("_", " "))}</Text>
      <Text style={{ color: colors.text }}>{copy("Requested components")}: {order.requestedAssetIds.length}</Text>
      {order.requestedAssetIds.map(id => <Text key={`asset:${id}`} style={{ color: colors.text }}>{assetLabel(id)}</Text>)}
      {order.findings.map((finding, index) => <Text key={`${finding.assetId}:${index}`} accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(finding.kind)}: {assetLabel(finding.assetId)} · {finding.note}</Text>)}
      {order.status === "reported" && <Text style={{ color: colors.text }}>{`${copy("Reported")} · ${copy(order.outcome?.replaceAll("_", " ") ?? "")}`}</Text>}
      {!!pending.current && "id" in pending.current && pending.current.id === order.id && <TogglePillButton color="blue" disabled={busy} onPress={() => void act((pending.current as { id: string; input: Parameters<typeof act>[0] }).input)}>{copy("Recover Yard Order action")}</TogglePillButton>}
      {order.status === "requested" && canAssign && <View style={{ gap: 8 }}>{canAssignOthers && <TextInput accessibilityLabel={copy("Assign Yard worker user ID")} placeholder={copy("Leave blank to assign yourself")} keyboardType="numeric" value={assignee} onChangeText={setAssignee} editable={!busy && !pending.current} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />}<TogglePillButton color="blue" disabled={busy} onPress={() => action("assign")}>{canAssignOthers && assignee ? copy("Assign Yard worker") : copy("Assign to me")}</TogglePillButton></View>}
      {order.status === "assigned" && canProgress && <TogglePillButton color="blue" disabled={busy} onPress={() => action("start")}>{copy("Start Yard work")}</TogglePillButton>}
      {!!reviewAction && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy("Review the current Yard Order and your retained findings, then reapply the action.")}</Text>}
      {order.status === "in_progress" && canProgress && <View style={{ gap: 10 }}>
        <Text style={{ color: colors.mutedForeground }}>{copy("Check requested components. Findings are advisory and remain on the report.")}</Text>
        {order.requestedAssetIds.map(assetId => <View key={assetId} style={{ gap: 5 }}><Text style={{ color: colors.text }}>{assetLabel(assetId)}</Text><TogglePillButton color="blue" disabled={busy || !!pending.current} accessibilityLabel={`${missing.includes(assetId) ? copy("Found component") : copy("Missing component")} ${assetLabel(assetId)}`} onPress={() => { setMissing(prior => prior.includes(assetId) ? prior.filter(id => id !== assetId) : [...prior, assetId]); setSubstitutions(prior => { const next = { ...prior }; delete next[assetId]; return next; }); }}>{missing.includes(assetId) ? copy("Found component") : copy("Missing component")}</TogglePillButton><TogglePillButton color="blue" disabled={busy || !!pending.current} accessibilityLabel={`${damaged.includes(assetId) ? copy("Condition cleared") : copy("Damaged component")} ${assetLabel(assetId)}`} onPress={() => setDamaged(prior => prior.includes(assetId) ? prior.filter(id => id !== assetId) : [...prior, assetId])}>{damaged.includes(assetId) ? copy("Condition cleared") : copy("Damaged component")}</TogglePillButton></View>)}
        {!!missing.length && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{missing.length} {copy("components missing. You can still report an outcome.")}</Text>}
        {!!missing.length && <TogglePillButton color="blue" disabled={busy || !!pending.current} onPress={() => void reviewAlternatives()}>{copy("Review alternatives")}</TogglePillButton>}
        {missing.map(original => <View key={`replacement:${original}`} style={{ gap: 4 }}><Text style={{ color: colors.text }}>{copy("Replacement for")} {assetLabel(original)}: {substitutions[original] ? assetLabel(substitutions[original].assetId) : copy("None selected")}</Text>{alternatives.map(candidate => <View key={`${original}:${candidate.assetId}`} style={{ gap: 4 }}><Text style={{ color: candidate.available ? colors.text : colors.destructive }}>{candidate.reasons.length ? candidate.reasons.map(copy).join(", ") : copy("Co-located and unreserved")}</Text><TogglePillButton color="blue" disabled={busy || !!pending.current} accessibilityLabel={`${copy("Use")} ${assetLabel(candidate.assetId)} ${copy("for")} ${assetLabel(original)}`} onPress={() => setSubstitutions(prior => ({ ...prior, [original]: candidate }))}>{copy("Use")} {assetLabel(candidate.assetId)} {copy("for")} {assetLabel(original)}</TogglePillButton></View>)}{!!substitutions[original] && <TogglePillButton disabled={busy || !!pending.current} onPress={() => setSubstitutions(prior => { const next = { ...prior }; delete next[original]; return next; })}>{copy("Clear replacement")}</TogglePillButton>}</View>)}
        <TextInput accessibilityLabel={copy("Yard report reasons")} placeholder={copy("Condition and substitution reasons")} value={reportNotes} onChangeText={setReportNotes} editable={!busy && !pending.current} multiline style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
        <TogglePillButton color="green" disabled={busy} onPress={() => action("report", "ready")}>{copy("Ready")}</TogglePillButton>
        <TogglePillButton color="blue" disabled={busy} onPress={() => action("report", "needs_attention")}>{copy("Needs attention")}</TogglePillButton>
        <TogglePillButton color="blue" disabled={busy} onPress={() => action("report", "unable_to_complete")}>{copy("Unable to complete")}</TogglePillButton>
      </View>}
      {detail.events.length > 0 && <View style={{ gap: 4 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{copy("Yard history")}</Text>{detail.events.map(event => <Text key={event.id} style={{ color: colors.mutedForeground }}>{copy(event.type.replaceAll("_", " "))} · {new Date(event.at).toLocaleString()}</Text>)}</View>}
      {!initialYardOrderId && <TogglePillButton disabled={busy || !!pending.current} onPress={() => { setSelectedId(""); setDetail(null); setReviewAction(null); }}>{copy("All Yard Orders")}</TogglePillButton>}
      {!!pending.current && "id" in pending.current && <Text accessibilityRole="alert" style={{ color: colors.text }}>{copy("Pending action belongs to Yard Order")} {pending.current.id}. {copy("Retry this order before leaving.")}</Text>}
    </View>}
  </View>;
}
