import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetDispatchPlanInputSchema, FleetDispatchPlanSchema, FleetDispatchPlanUpdateSchema, FleetRoutePlanSchema, FleetRunSchema, FleetDetailPageSchema, FleetDetailSnapshotSchema, FleetRunOrderSchema, FleetYardOrderInputSchema, FleetYardOrderSchema, FleetActionInputSchema, type FleetRun, type FleetDetail, type FleetDispatchPlan, type FleetDestination, type FleetRoutePlan, type FleetOverview, type FleetResources, type FleetYardOrder } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
import FleetChoiceField from "@/components/FleetChoiceField";
import FleetRouteFields from "@/components/FleetRouteFields";
import FleetRunOrderChoice from "@/components/FleetRunOrderChoice";
import { fleetRunOrderRoute } from "@workspace/api-zod";
import FleetRunBilling, { type FleetBillingChoice } from "@/components/FleetRunBilling";
import { createFleetRunFromPlan } from "@/components/FleetRunPlan";

type Yard = { id: string; companyId: number; destinationId: string | null; isHomeBase: boolean; active: boolean; name: string };
type BoardData = { overview: FleetOverview; resources: FleetResources; places: FleetDestination[]; yards: Yard[]; yardOrders: FleetYardOrder[]; details: FleetDetail[]; plans: FleetDispatchPlan[] };

export function defaultFleetDispatchRoute(yard: FleetDestination, job: FleetDestination): FleetRoutePlan {
  const origin = { type: "canonical" as const, location: yard };
  const destination = { type: "canonical" as const, location: job };
  return FleetRoutePlanSchema.parse({ origin, stops: [
    { id: Crypto.randomUUID(), kind: "delivery", sequence: 0, cycleId: null, location: destination },
    { id: Crypto.randomUUID(), kind: "return", sequence: 1, cycleId: null, location: origin },
  ], base: origin, returnPolicy: "return_required", plannedWindow: null });
}

export default function DispatchBoard() {
  const { user, activeMembershipId, activeMembership } = useAuth();
  const identity = `${user?.id ?? 0}:${activeMembershipId ?? 0}:${activeMembership?.orgId ?? user?.vendorId ?? 0}`;
  return <DispatchBoardContent key={identity} />;
}

function DispatchBoardContent() {
  const colors = useColors(), copy = useFleetCopy();
  const scope = useRef(captureAuthScope()), alive = useRef(true), lock = useRef(false);
  const pendingCreate = useRef<ReturnType<typeof FleetDispatchPlanInputSchema.parse> | null>(null);
  const pendingUpdate = useRef<ReturnType<typeof FleetDispatchPlanUpdateSchema.parse> | null>(null);
  const pendingYard = useRef<{ planId: string; input: ReturnType<typeof FleetYardOrderInputSchema.parse>; bindOperationId: string } | null>(null);
  const releaseAttempt = useRef<{ planId: string; create: ReturnType<typeof createFleetRunFromPlan>; runId: string | null; dispatchOperationId: string; bindOperationId: string } | null>(null);
  const reassignAttempt = useRef<{ runId: string; action: ReturnType<typeof FleetActionInputSchema.parse>; dispatchOperationId: string; ticketId: number } | null>(null);
  const [data, setData] = useState<BoardData | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(""), [fleetId, setFleetId] = useState(""), [billingSiteId, setBillingSiteId] = useState(0);
  const [ticket, setTicket] = useState<FleetDispatchPlan["ticket"] | null>(null), [route, setRoute] = useState<FleetRoutePlan | null>(null);
  const [routeEditorKey, setRouteEditorKey] = useState(0);
  const [jobId, setJobId] = useState(""), [selectedId, setSelectedId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState(0), [selectedDetailId, setSelectedDetailId] = useState(""), [selectedYardOrderId, setSelectedYardOrderId] = useState("");
  const [billing, setBilling] = useState<FleetBillingChoice | null>(null), [selectedRunOrder, setSelectedRunOrder] = useState<{ id: string; version: number } | null>(null);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  async function read<T>(path: string): Promise<T> {
    const result = await apiFetch<T>(path, {}, scope.current);
    if (!current()) throw Error("Fleet account changed. Reload Dispatch.");
    return result;
  }
  async function load() {
    try {
      const [overview, resources, plans, commercial, yardPage, yardOrders, details] = await Promise.all([
        read<FleetOverview>("/api/fleet/overview"), read<FleetResources>("/api/fleet/resources"),
        read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans"),
        read<{ destinations: FleetDestination[] }>("/api/fleet/commercial"), read<{ yards: Yard[] }>("/api/fleet/yards"),
        read<{ orders: FleetYardOrder[] }>("/api/fleet/yard-orders"), read<unknown>("/api/fleet/details"),
      ]);
      if (!current()) return;
      if (!overview.capabilities.canDispatch || plans.plans.some(plan => plan.companyId !== overview.companyId) || yardPage.yards.some(yard => yard.companyId !== overview.companyId))
        throw Error("Dispatch permission or company scope changed.");
      const parsed = plans.plans.map(plan => FleetDispatchPlanSchema.parse(plan));
      const detailPage = FleetDetailPageSchema.parse(details);
      setData({ overview, resources, places: commercial.destinations, yards: yardPage.yards, yardOrders: yardOrders.orders.filter(order => order.companyId === overview.companyId), details: detailPage.details, plans: parsed });
      setFleetId(prior => prior || overview.fleets[0]?.id || "");
      setBillingSiteId(prior => prior || overview.fleets[0]?.siteIds[0] || 0);
      setJobId(prior => prior || commercial.destinations.find(place => !yardPage.yards.some(yard => yard.destinationId === place.id))?.id || "");
      setError("");
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Dispatch Board unavailable."); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  const home = data?.yards.find(yard => yard.active && yard.isHomeBase && yard.destinationId);
  const homePlace = data?.places.find(place => place.id === home?.destinationId);
  const jobPlace = data?.places.find(place => place.id === jobId);
  const group = data?.overview.fleets.find(item => item.id === fleetId);
  const selected = data?.plans.find(plan => plan.id === selectedId);
  const selectedRun = data?.overview.runs.find(run => run.id === selected?.runId);
  async function save() {
    if (lock.current || !route || !ticket || !group || !billingSiteId) return;
    const exact = pendingCreate.current ?? FleetDispatchPlanInputSchema.parse({ operationId: Crypto.randomUUID(), fleetId, title, billingSiteId, routePlan: route, ticket, detailId: null, driverUserId: null, ...(selectedRunOrder ? { runOrderSelection: selectedRunOrder } : {}) });
    pendingCreate.current = exact; lock.current = true; setBusy(true); setError("");
    try {
      let plan = (await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans")).plans.find(item => item.operationId === exact.operationId);
      if (!plan) plan = FleetDispatchPlanSchema.parse(await apiFetch("/api/fleet/dispatch-plans", { method: "POST", body: JSON.stringify(exact) }, scope.current));
      const canonical = FleetDispatchPlanSchema.parse(plan);
      if (canonical.operationId !== exact.operationId || canonical.companyId !== data?.overview.companyId) throw Error("Dispatch plan readback mismatch.");
      const fresh = await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans");
      if (!fresh.plans.some(item => item.id === canonical.id && item.operationId === exact.operationId)) throw Error("Dispatch plan not yet visible. Retry the exact save.");
      if (!current()) return;
      setData(previous => previous ? { ...previous, plans: fresh.plans.map(item => FleetDispatchPlanSchema.parse(item)) } : previous);
      setSelectedId(canonical.id); pendingCreate.current = null;
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Plan outcome unknown. Retry the exact save."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  async function prepare() {
    if (!selected || lock.current) return;
    const exact = pendingUpdate.current ?? FleetDispatchPlanUpdateSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: selected.version, detailId: selectedDetailId || selected.detailId || null, driverUserId: selectedDriverId || selected.driverUserId || null, yardOrderId: selectedYardOrderId || selected.yardOrderId || null, state: "ready_to_dispatch" });
    pendingUpdate.current = exact; lock.current = true; setBusy(true); setError("");
    try {
      const before = await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans");
      let saved = before.plans.find(plan => plan.id === selected.id && plan.version > exact.expectedVersion && plan.detailId === exact.detailId && plan.driverUserId === exact.driverUserId && plan.state === "ready_to_dispatch");
      if (!saved) saved = FleetDispatchPlanSchema.parse(await apiFetch(`/api/fleet/dispatch-plans/${selected.id}`, { method: "PATCH", body: JSON.stringify(exact) }, scope.current));
      const canonical = FleetDispatchPlanSchema.parse(saved);
      if (canonical.id !== selected.id || canonical.companyId !== data?.overview.companyId || canonical.version <= exact.expectedVersion) throw Error("Plan preparation readback mismatch.");
      const fresh = await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans");
      if (!fresh.plans.some(plan => plan.id === canonical.id && plan.version >= canonical.version)) throw Error("Plan readiness not yet visible. Retry the exact request.");
      setData(previous => previous ? { ...previous, plans: fresh.plans } : previous); pendingUpdate.current = null;
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Plan readiness needs verification."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  async function requestYardDetail() {
    if (!selected || selected.state !== "waiting_on_yard" || lock.current || !data?.overview.accountScope) return;
    const detailId = selectedDetailId || selected.detailId;
    const detail = data.details.find(item => item.id === detailId);
    if (!detail || !home) return;
    const account = data.overview.accountScope;
    if (account.companyId !== data.overview.companyId || !account.userId || !account.membershipId) return;
    if (!pendingYard.current || pendingYard.current.planId !== selected.id) {
      const now = new Date().toISOString();
      const order = FleetYardOrderSchema.parse({ id: Crypto.randomUUID(), companyId: account.companyId, version: 1, yardId: home.id,
        detailId: detail.id, runId: null, status: "requested", outcome: null, requestedByUserId: account.userId, assignedToUserId: null,
        requestedAt: now, scheduledAt: selected.routePlan.plannedWindow?.startAt ?? null, startedAt: null, reportedAt: null,
        requestedAssetIds: [detail.vehicleAssetId], actualAssetIds: [], findings: [], notes: `Dispatch plan ${selected.id}` });
      pendingYard.current = { planId: selected.id, input: FleetYardOrderInputSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: 0,
        scope: { owner: { type: "vendor", id: account.companyId }, userId: account.userId, membershipId: account.membershipId, sessionVersion: account.sessionVersion }, order }), bindOperationId: Crypto.randomUUID() };
    }
    const attempt = pendingYard.current;
    lock.current = true; setBusy(true); setError("");
    try {
      let saved: FleetYardOrder | null = null;
      try {
        const receipt = await read<{ result: unknown }>(`/api/fleet/yard-orders/operations/${attempt.input.operationId}`);
        saved = FleetYardOrderSchema.parse(receipt.result);
      } catch (cause) { if ((cause as { status?: number }).status !== 404) throw cause; }
      if (!saved) saved = FleetYardOrderSchema.parse(await apiFetch("/api/fleet/yard-orders", { method: "POST", body: JSON.stringify(attempt.input) }, scope.current));
      if (saved.id !== attempt.input.order.id || saved.companyId !== account.companyId || saved.detailId !== detail.id) throw Error("Yard Order readback mismatch.");
      const fresh = await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans");
      const currentPlan = fresh.plans.find(item => item.id === selected.id);
      if (!currentPlan) throw Error("Dispatch plan changed. Reload before linking Yard work.");
      if (currentPlan.yardOrderId !== saved.id) {
        const update = FleetDispatchPlanUpdateSchema.parse({ operationId: attempt.bindOperationId, expectedVersion: currentPlan.version,
          detailId: detail.id, yardOrderId: saved.id, state: "waiting_on_yard" });
        await apiFetch(`/api/fleet/dispatch-plans/${selected.id}`, { method: "PATCH", body: JSON.stringify(update) }, scope.current);
      }
      const verified = await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans");
      if (!verified.plans.some(item => item.id === selected.id && item.detailId === detail.id && item.yardOrderId === saved.id && item.state === "waiting_on_yard")) throw Error("Yard request needs verification. Retry the exact request.");
      setData(previous => previous ? { ...previous, plans: verified.plans, yardOrders: [...previous.yardOrders.filter(item => item.id !== saved.id), saved] } : previous);
      setSelectedYardOrderId(saved.id); pendingYard.current = null;
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Yard request needs verification."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  async function release() {
    if (!selected || selected.state !== "ready_to_dispatch" || selected.ticket.kind !== "authorized" || !selected.detailId || !selected.driverUserId || !billing || billing.mode !== "existing_ticket" || billing.ticketId !== selected.ticket.ticketId || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      let attempt = releaseAttempt.current;
      if (!attempt || attempt.planId !== selected.id) {
        const snapshot = FleetDetailSnapshotSchema.parse(await read(`/api/fleet/details/${selected.detailId}?driverUserId=${selected.driverUserId}`));
        if (snapshot.detail.companyId !== data?.overview.companyId || snapshot.detail.id !== selected.detailId || snapshot.detail.driverUserId !== selected.driverUserId) throw Error("Detail or driver changed. Review the plan.");
        const order = selected.runOrderSelection ? FleetRunOrderSchema.parse(await read(`/api/fleet/run-orders/${selected.runOrderSelection.id}`)) : undefined;
        if (order && order.version !== selected.runOrderSelection?.version) throw Error("Saved Run changed. Review the route.");
        const create = createFleetRunFromPlan({ operationId: Crypto.randomUUID(), originStopId: Crypto.randomUUID(), fleetId: selected.fleetId, title: selected.title,
          plan: { detail: snapshot, route: selected.routePlan, billingSiteId: selected.billingSiteId, timeZone: selected.routePlan.origin.type === "canonical" ? (selected.routePlan.origin.location.timeZone ?? "America/Chicago") : "America/Chicago", ...(order ? { runOrder: order } : {}) }, billing });
        attempt = { planId: selected.id, create, runId: null, dispatchOperationId: Crypto.randomUUID(), bindOperationId: Crypto.randomUUID() };
        releaseAttempt.current = attempt;
      }
      let run: FleetRun;
      if (attempt.runId) run = FleetRunSchema.parse(await read(`/api/fleet/runs/${attempt.runId}`));
      else {
        run = FleetRunSchema.parse(await apiFetch("/api/fleet/runs", { method: "POST", body: JSON.stringify(attempt.create) }, scope.current));
        attempt.runId = run.id;
      }
      if (run.companyId !== data?.overview.companyId || run.linkedTicketId !== selected.ticket.ticketId || run.driverUserId !== selected.driverUserId || run.resourceAssignment?.snapshot.detail.id !== selected.detailId) throw Error("Run and ticket readback mismatch.");
      if (run.status === "draft") {
        const action = { operationId: attempt.dispatchOperationId, expectedVersion: run.version, action: "dispatch" };
        run = FleetRunSchema.parse(await apiFetch(`/api/fleet/runs/${run.id}/actions`, { method: "POST", body: JSON.stringify(action) }, scope.current));
      }
      run = FleetRunSchema.parse(await read(`/api/fleet/runs/${run.id}`));
      if (run.status !== "dispatched" || !run.events.some(event => event.operationId === attempt.dispatchOperationId)) throw Error("Dispatch outcome needs verification. Retry the same request.");
      const bind = FleetDispatchPlanUpdateSchema.parse({ operationId: attempt.bindOperationId, expectedVersion: selected.version, state: "released", runId: run.id });
      await apiFetch(`/api/fleet/dispatch-plans/${selected.id}`, { method: "PATCH", body: JSON.stringify(bind) }, scope.current);
      const fresh = await read<{ plans: FleetDispatchPlan[] }>("/api/fleet/dispatch-plans");
      if (!fresh.plans.some(plan => plan.id === selected.id && plan.state === "released" && plan.runId === run.id)) throw Error("Release readback needs verification. Retry the exact request.");
      setData(previous => previous ? { ...previous, plans: fresh.plans, overview: { ...previous.overview, runs: [run, ...previous.overview.runs.filter(item => item.id !== run.id)] } } : previous);
      releaseAttempt.current = null;
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Run release needs verification."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  async function reassign() {
    if (!selectedRun || !selected || selected.ticket.kind !== "authorized" || !selectedRun.allowedActions.includes("reassign") || lock.current || !data) return;
    const driverId = selectedDriverId || selectedRun.driverUserId;
    const detailId = selectedDetailId || selectedRun.resourceAssignment?.snapshot.detail.id;
    const detail = data.details.find(item => item.id === detailId);
    if (!detail || !driverId || !selectedRun.resourceAssignment) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (!reassignAttempt.current || reassignAttempt.current.runId !== selectedRun.id) {
        const snapshot = FleetDetailSnapshotSchema.parse(await read(`/api/fleet/details/${detail.id}?driverUserId=${driverId}`));
        if (snapshot.detail.companyId !== data.overview.companyId || snapshot.detail.id !== detail.id || snapshot.detail.driverUserId !== driverId) throw Error("Reassigned Detail changed. Review again.");
        const action = FleetActionInputSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: selectedRun.version, action: "reassign",
          driverUserId: driverId, vehicleAssetId: snapshot.detail.vehicleAssetId,
          trailerAssetId: snapshot.rigPackage?.components.find(item => item.role === "trailer")?.assetId ?? null,
          reason: "Dispatch reassigned the driver and Detail before start",
          detailSelection: { version: 2, detailId: detail.id, detailVersion: detail.version,
            timeZone: selectedRun.resourceAssignment.reservation.timeZone, returnPolicy: selectedRun.resourceAssignment.returnPolicy } });
        reassignAttempt.current = { runId: selectedRun.id, action, dispatchOperationId: Crypto.randomUUID(), ticketId: selected.ticket.ticketId };
      }
      const attempt = reassignAttempt.current;
      let run = FleetRunSchema.parse(await read(`/api/fleet/runs/${attempt.runId}`));
      if (!run.events.some(event => event.operationId === attempt.action.operationId))
        run = FleetRunSchema.parse(await apiFetch(`/api/fleet/runs/${attempt.runId}/actions`, { method: "POST", body: JSON.stringify(attempt.action) }, scope.current));
      run = FleetRunSchema.parse(await read(`/api/fleet/runs/${attempt.runId}`));
      if (run.linkedTicketId !== attempt.ticketId || run.driverUserId !== attempt.action.driverUserId || run.resourceAssignment?.snapshot.detail.id !== attempt.action.detailSelection?.detailId || !run.events.some(event => event.operationId === attempt.action.operationId))
        throw Error("Reassignment and ticket readback mismatch.");
      if (run.status === "draft") {
        run = FleetRunSchema.parse(await apiFetch(`/api/fleet/runs/${run.id}/actions`, { method: "POST", body: JSON.stringify(FleetActionInputSchema.parse({ operationId: attempt.dispatchOperationId, expectedVersion: run.version, action: "dispatch" })) }, scope.current));
      }
      run = FleetRunSchema.parse(await read(`/api/fleet/runs/${attempt.runId}`));
      if (run.status !== "dispatched" || run.linkedTicketId !== attempt.ticketId || !run.events.some(event => event.operationId === attempt.dispatchOperationId)) throw Error("Redispatch needs verification. Retry the exact request.");
      setData(previous => previous ? { ...previous, overview: { ...previous.overview, runs: [run, ...previous.overview.runs.filter(item => item.id !== run.id)] } } : previous);
      reassignAttempt.current = null; setSelectedDriverId(0); setSelectedDetailId("");
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Reassignment needs verification."); }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  const text = { color: colors.text }, card = { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2, borderRadius: 12, padding: 14, gap: 10 } as const;
  if (!data) return <View style={card}><Text style={text}>{copy("Loading Dispatch Board")}</Text>{!!error && <Text accessibilityRole="alert" style={text}>{error}</Text>}<TogglePillButton onPress={() => void load()}>{copy("Retry Dispatch Board")}</TogglePillButton></View>;
  return <View style={{ gap: 12 }}>
    <View style={card}><Text style={{ ...text, fontWeight: "700" }}>{copy("Dispatch Board")}</Text>
      <Text style={text}>{copy("Authorized work → route and return → Yard Detail → driver → review and release")}</Text>
      <Text style={text}>{copy("Advisory compliance warnings do not block planning. Physical readiness is checked at release.")}</Text>
      <TogglePillButton disabled={busy} onPress={() => void load()}>{copy("Refresh Dispatch Board")}</TogglePillButton>
      {data.plans.map(plan => <TogglePillButton key={plan.id} solid={selectedId === plan.id} disabled={busy || ((!!pendingUpdate.current || !!pendingYard.current || !!releaseAttempt.current || !!reassignAttempt.current) && selectedId !== plan.id)} onPress={() => {
        setSelectedId(plan.id); setSelectedDriverId(0); setSelectedDetailId(""); setSelectedYardOrderId(""); setBilling(null);
      }}>{plan.title} · {copy(plan.state === "waiting_on_yard" ? "Waiting on Yard" : plan.state === "ready_to_dispatch" ? "Ready to dispatch" : "Released")}</TogglePillButton>)}
      {selected && <Text style={text}>{selected.ticket.kind === "authorized" ? `Ticket #${selected.ticket.ticketId}` : copy("Non-billable Office-review draft")} · {selected.routePlan.stops.length} {copy("ordered stops")}</Text>}
      {selected && selected.state !== "released" && <View style={{ gap: 8 }}>
        <FleetChoiceField label={copy("Run driver")} value={String(selectedDriverId || selected.driverUserId || "")} options={data.resources.drivers.filter(driver => driver.fleetIds.includes(selected.fleetId)).map(driver => ({ id: String(driver.userId), label: driver.name }))} onChange={value => setSelectedDriverId(Number(value))} disabled={busy} />
        <FleetChoiceField label={copy("Detail request / reservation")} value={selectedDetailId || selected.detailId || ""} options={data.details.filter(detail => detail.accessGroupIds.includes(selected.fleetId) && !detail.archivedAt).map(detail => ({ id: detail.id, label: detail.name }))} onChange={setSelectedDetailId} disabled={busy} />
        <FleetChoiceField label={copy("Yard Order (optional)")} value={selectedYardOrderId || selected.yardOrderId || ""} options={data.yardOrders.filter(order => order.detailId === (selectedDetailId || selected.detailId)).map(order => ({ id: order.id, label: `${copy(order.status)}${order.outcome ? ` / ${copy(order.outcome)}` : ""} · ${order.id}` }))} onChange={setSelectedYardOrderId} disabled={busy} />
        {selected.state === "waiting_on_yard" && <TogglePillButton disabled={busy || !(selectedDetailId || selected.detailId) || !home || !data.overview.accountScope} onPress={() => void requestYardDetail()}>{copy(pendingYard.current ? "Verify and retry exact Yard request" : "Request Yard Detail")}</TogglePillButton>}
        {selected.state === "waiting_on_yard" && <TogglePillButton disabled={busy || !(selectedDriverId || selected.driverUserId) || !(selectedDetailId || selected.detailId)} onPress={() => void prepare()}>{copy(pendingUpdate.current ? "Verify and retry exact readiness" : "Review ready Detail and driver")}</TogglePillButton>}
        {selected.ticket.kind === "office_review_draft" && <Text style={text}>{copy("Office must attach an authorized ticket before this non-billable draft can be released.")}</Text>}
        {selected.state === "ready_to_dispatch" && selected.ticket.kind === "authorized" && <><FleetRunBilling siteId={selected.billingSiteId} fleetId={selected.fleetId} authorizedTicketId={selected.ticket.ticketId} onChange={setBilling} disabled={busy} /><TogglePillButton disabled={busy || billing?.mode !== "existing_ticket" || billing.ticketId !== selected.ticket.ticketId} onPress={() => void release()}>{copy(releaseAttempt.current ? "Verify and retry exact release" : "Release to driver")}</TogglePillButton></>}
      </View>}
      {selectedRun && selected?.state === "released" && <View style={{ gap: 8 }}>
        <Text style={text}>{copy("Run in progress")} · {copy(selectedRun.status)} · Ticket #{selectedRun.linkedTicketId}</Text>
        {selectedRun.allowedActions.includes("reassign") && <><Text style={text}>{copy("Reassign before start; the authorized ticket stays linked.")}</Text>
          <FleetChoiceField label={copy("Replacement driver")} value={String(selectedDriverId || selectedRun.driverUserId)} options={data.resources.drivers.filter(driver => driver.fleetIds.includes(selectedRun.fleetId)).map(driver => ({ id: String(driver.userId), label: driver.name }))} onChange={value => setSelectedDriverId(Number(value))} disabled={busy} />
          <FleetChoiceField label={copy("Replacement Detail")} value={selectedDetailId || selectedRun.resourceAssignment?.snapshot.detail.id || ""} options={data.details.filter(detail => detail.accessGroupIds.includes(selectedRun.fleetId) && !detail.archivedAt).map(detail => ({ id: detail.id, label: detail.name }))} onChange={setSelectedDetailId} disabled={busy} />
          <TogglePillButton disabled={busy || !(selectedDetailId || selectedRun.resourceAssignment?.snapshot.detail.id)} onPress={() => void reassign()}>{copy(reassignAttempt.current ? "Verify and retry exact reassignment" : "Reassign and redispatch")}</TogglePillButton></>}
      </View>}
    </View>
    <View style={card}><Text style={{ ...text, fontWeight: "700" }}>{copy("Build a Run")}</Text>
      <TextInput accessibilityLabel={copy("Run title")} value={title} onChangeText={setTitle} editable={!busy} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 10 }} />
      <FleetChoiceField label={copy("Fleet group")} value={fleetId} options={data.overview.fleets.map(item => ({ id: item.id, label: item.name }))} onChange={value => { setFleetId(value); setBillingSiteId(data.overview.fleets.find(item => item.id === value)?.siteIds[0] ?? 0); }} disabled={busy} />
      <FleetChoiceField label={copy("Billing site")} value={String(billingSiteId || "")} options={(group?.siteIds ?? []).map(id => ({ id: String(id), label: `Site ${id}` }))} onChange={value => setBillingSiteId(Number(value))} disabled={busy} />
      <Text style={text}>{copy("Choose the work authorization")}</Text>
      <TogglePillButton solid={ticket?.kind === "office_review_draft"} onPress={() => setTicket({ kind: "office_review_draft", billable: false })}>{copy("Office-review draft")}</TogglePillButton>
      {(data.resources.tickets ?? []).filter(item => item.siteId === billingSiteId && ["initiated", "in_progress", "pending_review", "kicked_back", "completed"].includes(item.status)).map(item => <TogglePillButton key={item.id} solid={ticket?.kind === "authorized" && ticket.ticketId === item.id} onPress={() => setTicket({ kind: "authorized", ticketId: item.id })}>{copy("Authorized ticket")} #{item.id}</TogglePillButton>)}
      <FleetChoiceField label={copy("Job destination")} value={jobId} options={data.places.filter(place => place.active && place.id !== homePlace?.id).map(place => ({ id: place.id, label: place.name }))} onChange={setJobId} disabled={busy} />
      {homePlace && jobPlace && <TogglePillButton onPress={() => { setSelectedRunOrder(null); setRoute(defaultFleetDispatchRoute(homePlace, jobPlace)); setRouteEditorKey(value => value + 1); }}>{copy("Use yard → job → return")}</TogglePillButton>}
      <FleetRouteFields key={routeEditorKey} value={route} destinations={data.places} onChange={value => { setSelectedRunOrder(null); setRoute(value); }} disabled={busy} />
      {group && <FleetRunOrderChoice companyId={data.overview.companyId} groupId={group.id} disabled={busy} onChange={order => { if (order) { setSelectedRunOrder({ id: order.id, version: order.version }); setRoute(fleetRunOrderRoute(order, Crypto.randomUUID)); setRouteEditorKey(value => value + 1); } }} />}
      <TogglePillButton disabled={busy || !route || !ticket || !title.trim() || !billingSiteId} onPress={() => void save()}>{copy(pendingCreate.current ? "Verify and retry exact plan" : "Save waiting plan")}</TogglePillButton>
      {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    </View>
  </View>;
}
