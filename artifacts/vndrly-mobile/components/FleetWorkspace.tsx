import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import type { FleetOverview, FleetRun, FleetResources, FleetActionInput } from "@workspace/api-zod";
import { CreateFleetRunSchema } from "@workspace/api-zod";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import TogglePillButton from "@/components/TogglePillButton";
import FleetRunAction from "@/components/FleetRunAction";
import MapboxNativeMap from "@/components/MapboxNativeMap";
import FleetSetup from "@/components/FleetSetup";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { fleetActionInput, fleetErrorMessage, fleetRunLabel } from "@/lib/fleet-mobile";
import { nativeFleetOffline } from "@/lib/fleet-offline-native";
import type { FleetOfflineScope, FleetQueuedAction } from "@/lib/fleet-offline";

export default function FleetWorkspace({ initialRunId, initialMode = "desk" }: { initialRunId?: string; initialMode?: "desk" | "my-day" } = {}) {
  const colors = useColors();
  const { user, activeMembershipId, activeMembership } = useAuth();
  const identity = `${user?.id}:${activeMembershipId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [data, setData] = useState<{ identity: string; overview: FleetOverview; resources: FleetResources } | null>(null);
  const [selected, setSelected] = useState<string | null>(initialRunId ?? null);
  const [mode, setMode] = useState<"desk" | "my-day" | "dispatch" | "map" | "setup">(initialMode);
  const [fleetFilter, setFleetFilter] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [title, setTitle] = useState("");
  const [fleetId, setFleetId] = useState("");
  const [driver, setDriver] = useState<number | null>(null);
  const [vehicle, setVehicle] = useState("");
  const [trailer, setTrailer] = useState<string | null>(null);
  const [stopSites, setStopSites] = useState<{ siteId: number; kind: "pickup" | "delivery" | "return" }[]>([]);
  const [stopKind, setStopKind] = useState<"pickup" | "delivery" | "return">("pickup");
  const [reason, setReason] = useState("");
  const [unresolved, setUnresolved] = useState<{ path: string; body: unknown; operationId: string } | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [queued, setQueued] = useState<FleetQueuedAction[]>([]);
  const companyId = activeMembership ? (activeMembership.orgType === "vendor" ? activeMembership.orgId : null) : user?.vendorId;
  const scope: FleetOfflineScope | null = user?.id && companyId ? { userId: user.id, companyId, membershipId: activeMembershipId } : null;
  async function readQueue() { if (scope) { const document = await nativeFleetOffline.read(scope); if (identityRef.current === identity) setQueued(document.actions); } }
  useEffect(() => {
    setSelected(initialRunId ?? null); setTitle(""); setFleetId(""); setDriver(null); setVehicle(""); setTrailer(null); setStopSites([]); setReason(""); setUnresolved(null); setBusy(false); setCachedAt(null); setQueued([]); setMode(initialMode); setFleetFilter(null);
  }, [identity, initialRunId, initialMode]);
  useEffect(() => {
    let alive = true;
    setData(null); setError("");
    if (scope) void readQueue().catch(() => undefined);
    if (user?.id) void apiFetch<FleetOverview>("/api/fleet/overview")
      .then(async overview => {
        const resources = overview.capabilities.canDispatch ? await apiFetch<FleetResources>("/api/fleet/resources") : { drivers: [], equipment: [] };
        if (alive && identityRef.current === identity) {
          setData({ identity, overview, resources });
          setFleetFilter(overview.preference?.selectedFleetId ?? null);
          setCachedAt(null);
          setUnresolved(pending => pending && overview.runs.some(r => r.events.some(e => e.operationId === pending.operationId)) ? null : pending);
          if (scope && overview.capabilities.canDrive) void nativeFleetOffline.cache(scope, overview).catch(e => { if (alive) setError(e instanceof Error ? e.message : "Fleet cache unavailable."); });
          if (scope) void nativeFleetOffline.read(scope).then(async document => {
            for (const item of document.actions) if (overview.runs.some(r => r.events.some(event => event.operationId === item.input.operationId))) await nativeFleetOffline.resolve(scope, item.input.operationId, "accepted");
            if (alive) await readQueue();
          }).catch(() => undefined);
        }
      })
      .catch(async e => {
        if (!alive) return;
        setError(fleetErrorMessage(e));
        if (scope && (e as { code?: string }).code === "network.unreachable") {
          const document = await nativeFleetOffline.read(scope).catch(() => null);
          if (alive && document?.overview) { setData({ identity, overview: document.overview, resources: { drivers: [], equipment: [] } }); setCachedAt(document.cachedAt); setQueued(document.actions); }
        }
      });
    return () => { alive = false; };
  }, [identity, revision, user?.id]);
  const current = data?.identity === identity ? data : null;
  const overview = current?.overview;
  const run = overview?.runs.find(r => r.id === selected);
  const visibleRuns = overview?.runs.filter(item => (!fleetFilter || item.fleetId === fleetFilter) && (mode !== "my-day" || item.driverUserId === user?.id)) ?? [];
  const fleet = overview?.fleets.find(f => f.id === fleetId);
  const textStyle = { color: colors.text, fontSize: 16 };
  const fieldStyle = { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 };
  async function write(path: string, body: unknown) {
    const requestIdentity = identity;
    setBusy(true); setError("");
    try { await apiFetch(path, { method: "POST", body: JSON.stringify(body) }); if (identityRef.current !== requestIdentity) return; if (scope && /\/actions$/.test(path)) await nativeFleetOffline.resolve(scope, (body as FleetActionInput).operationId, "accepted"); setUnresolved(null); setRevision(n => n + 1); }
    catch (e) {
      if (identityRef.current !== requestIdentity) return;
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        if (scope && /\/actions$/.test(path)) await nativeFleetOffline.resolve(scope, (body as FleetActionInput).operationId, status === 401 || status === 403 ? "revoked" : "conflict", e instanceof Error ? e.message : "Fleet refused this offline action.");
        setUnresolved(null);
        setError(`${fleetErrorMessage(e)} Refresh current permissions and run revision before preparing another action.`);
        setData(null);
        return;
      }
      const operationId = (body as { operationId: string }).operationId;
      if (scope && /\/actions$/.test(path)) {
        const input = body as FleetActionInput;
        try { await nativeFleetOffline.enqueue(scope, { runId: path.split("/").at(-2)!, input, capturedAt: (input as FleetActionInput & { capturedAt?: string }).capturedAt ?? new Date().toISOString(), state: "unsynced" }); await readQueue(); }
        catch (queueError) { setError(queueError instanceof Error ? queueError.message : "Offline storage failed."); return; }
      }
      setUnresolved({ path, body, operationId });
      setError(`${fleetErrorMessage(e)} Outcome needs verification. Refresh the run before retrying operation ${operationId}.`);
      setData(null);
    }
    finally { if (identityRef.current === requestIdentity) setBusy(false); }
  }
  function action(target: FleetRun, name: FleetActionInput["action"], fields: Partial<FleetActionInput> = {}) {
    try {
      const body = fleetActionInput(target, name, Crypto.randomUUID(), name === "reassign" ? { driverUserId: driver ?? undefined, vehicleAssetId: vehicle || undefined, trailerAssetId: trailer, reason: reason || undefined } : fields);
      Object.assign(body, { capturedAt: new Date().toISOString(), source: "user_report" });
      void write(`/api/fleet/runs/${target.id}/actions`, body);
    } catch (e) { setError(e instanceof Error ? e.message : "Action unavailable."); }
  }
  function createRun() {
    const result = CreateFleetRunSchema.safeParse({ operationId: Crypto.randomUUID(), fleetId, title, driverUserId: driver, vehicleAssetId: vehicle, trailerAssetId: trailer,
      stops: stopSites.map((stop, sequence) => ({ id: Crypto.randomUUID(), ...stop, sequence })) });
    if (!result.success) { setError("Choose a fleet, driver, ready truck, title and ordered pickup/delivery stops."); return; }
    void write("/api/fleet/runs", result.data);
  }
  async function synchronize(item: FleetQueuedAction) {
    if (!scope) return;
    const requestIdentity = identity;
    setBusy(true);
    try {
      const saved = await apiFetch<FleetRun>(`/api/fleet/runs/${item.runId}`);
      if (identityRef.current !== requestIdentity) return;
      if (saved.events.some(event => event.operationId === item.input.operationId)) {
        await nativeFleetOffline.resolve(scope, item.input.operationId, "accepted"); await readQueue(); setRevision(n => n + 1);
      } else {
        await write(`/api/fleet/runs/${item.runId}/actions`, item.input);
      }
    } catch (e) {
      if (identityRef.current !== requestIdentity) return;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404) { await nativeFleetOffline.resolve(scope, item.input.operationId, "revoked", "Current account no longer has access to this run."); await readQueue(); }
      setError(e instanceof Error ? e.message : "Queued action remains unsynced.");
    } finally { if (identityRef.current === requestIdentity) setBusy(false); }
  }
  async function saveHome(defaultWorkspace: "standard" | "fleet_desk" | "fleet_my_day") {
    if (!overview?.preference || cachedAt) return;
    const requestIdentity = identity;
    setBusy(true);
    try {
      await apiFetch("/api/fleet/preferences", { method: "POST", body: JSON.stringify({ expectedVersion: overview.preference.version, defaultWorkspace, selectedFleetId: fleetFilter }) });
      if (identityRef.current === requestIdentity) setRevision(n => n + 1);
    } catch (e) { if (identityRef.current === requestIdentity) { setError(`${fleetErrorMessage(e)} Refresh the saved preference before retrying.`); setData(null); } }
    finally { if (identityRef.current === requestIdentity) setBusy(false); }
  }
  return <ScreenSafeArea><ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    <WorkHubPageTitle title={mode === "my-day" || (overview?.roles.includes("driver") && !overview.capabilities.canDispatch) ? "My Fleet Day" : "Fleet Ops"} />
    <Text style={textStyle}>Active company: {overview?.companyId ?? "Checking authorization"}</Text>
    <TogglePillButton onPress={() => setRevision(n => n + 1)} disabled={busy}>Refresh Fleet</TogglePillButton>
    {overview && <View style={{ gap: 8 }}><TogglePillButton solid={mode === "desk"} onPress={() => setMode("desk")}>Fleet Desk / My Run</TogglePillButton>{overview.capabilities.canDrive && <TogglePillButton solid={mode === "my-day"} onPress={() => setMode("my-day")}>My Day</TogglePillButton>}<TogglePillButton solid={mode === "map"} onPress={() => setMode("map")}>Fleet Map</TogglePillButton>{overview.capabilities.canDispatch && <TogglePillButton solid={mode === "dispatch"} onPress={() => setMode("dispatch")}>Dispatch</TogglePillButton>}{overview.capabilities.canSetup && <TogglePillButton solid={mode === "setup"} onPress={() => setMode("setup")}>Fleet setup</TogglePillButton>}</View>}
    {overview?.enabled && <View style={{ gap: 8 }}><TogglePillButton solid={!fleetFilter} onPress={() => setFleetFilter(null)}>All authorized fleets</TogglePillButton>{overview.fleets.map(item => <TogglePillButton key={item.id} solid={fleetFilter === item.id} onPress={() => setFleetFilter(item.id)}>{item.name}</TogglePillButton>)}{overview.preference && !cachedAt && <><Text style={textStyle}>Saved home: {overview.preference.defaultWorkspace.replaceAll("_", " ")}. Changing a home or filter does not expand access.</Text><TogglePillButton disabled={busy} onPress={() => void saveHome(overview.preference!.defaultWorkspace)}>Save this Fleet filter</TogglePillButton>{overview.capabilities.canDispatch && <TogglePillButton disabled={busy} onPress={() => void saveHome("fleet_desk")}>Make Fleet Desk my home</TogglePillButton>}{overview.capabilities.canDrive && <TogglePillButton disabled={busy} onPress={() => void saveHome("fleet_my_day")}>Make My Fleet Day my home</TogglePillButton>}<TogglePillButton disabled={busy} onPress={() => void saveHome("standard")}>Use standard home</TogglePillButton></>}</View>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {cachedAt && <Text style={textStyle}>Offline assigned-work cache from {cachedAt}. Permissions and readiness are unverified. Entries remain unsynced until the server accepts them; no location is collected.</Text>}
    {queued.map(item => <View key={item.input.operationId} style={{ gap: 8 }}><Text style={textStyle}>{item.input.action}: {item.state} · captured {item.capturedAt} · run {item.runId} · {item.message ?? "Not accepted by the server"}</Text>{item.state === "unsynced" ? <TogglePillButton disabled={busy || !!cachedAt} onPress={() => void synchronize(item)}>Verify and synchronize queued operation</TogglePillButton> : <TogglePillButton disabled={busy} onPress={() => { if (scope) void nativeFleetOffline.discardRefused(scope, item.input.operationId).then(readQueue).catch(e => setError(e instanceof Error ? e.message : "Could not discard local entry.")); }}>Discard refused local entry</TogglePillButton>}</View>)}
    {unresolved && <View style={{ gap: 8 }}><Text style={textStyle}>Unverified operation: {unresolved.operationId}. No new action can be started until this outcome is resolved.</Text><TogglePillButton disabled={busy || !current} onPress={() => void write(unresolved.path, unresolved.body)}>Retry same operation after readback</TogglePillButton></View>}
    {!current && !error && <ActivityIndicator />}
    {overview && !overview.enabled && <Text style={textStyle}>Fleet is not enabled for your current company and grants.</Text>}
    {mode === "setup" && overview?.capabilities.canSetup && <FleetSetup key={`${identity}:${revision}`} onSaved={() => setRevision(n => n + 1)} />}
    {current && overview?.enabled && <>
      <Text style={textStyle}>Updated {overview.generatedAt}. Roles: {overview.roles.join(", ")}</Text>
      {(mode === "desk" || mode === "map") && <><Text style={textStyle}>Location sources</Text>
      {overview.observations.length > 0 && <MapboxNativeMap height={280} points={overview.observations.map((observation, index) => ({ id: `${observation.runId}:${index}`, latitude: observation.latitude, longitude: observation.longitude, title: `Driver phone · ${observation.freshness}`, color: observation.freshness === "recent" ? colors.primary : colors.mutedForeground }))} />}
      {overview.observations.length === 0 && <Text style={textStyle}>No sourced Fleet location is available. Truck position, ETA and live tracking are unavailable.</Text>}
      {overview.observations.map((o, i) => <Text key={`${o.runId}:${i}`} style={textStyle}>Driver phone for run {o.runId}: {o.latitude}, {o.longitude} · {o.freshness} · recorded {o.recordedAt}. This is a phone observation, not truck telemetry.</Text>)}
      {overview.unavailableIntegrations.map(name => <Text key={name} style={textStyle}>{name}: unavailable</Text>)}
      </>}
      {mode !== "setup" && mode !== "map" && <>
      <Text style={[textStyle, { fontWeight: "700" }]}>Runs</Text>
      {visibleRuns.length === 0 && <Text style={textStyle}>No authorized runs for this view.</Text>}
      {visibleRuns.map(item => <TogglePillButton key={item.id} onPress={() => { setSelected(item.id); router.push(`/fleet-run/${item.id}` as never); }}>{fleetRunLabel(item)}</TogglePillButton>)}
      </>}
      {run && <View style={{ gap: 12, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
        <Text style={textStyle}>{fleetRunLabel(run)} · revision {run.version}</Text>
        {run.status === "acknowledged" && <Text style={textStyle}>Before starting, record the initial odometer and inspection report for this assigned equipment. A reported defect blocks starting.</Text>}
        {run.status === "in_progress" && <Text style={textStyle}>Closeout requires the required stops, delivery references and ending odometer. Fleet completion does not approve a ticket or payment.</Text>}
        <Text style={textStyle}>Driver {run.labels?.driverName ?? run.driverUserId} · truck {run.labels?.vehicleName ?? run.vehicleAssetId} · trailer {run.labels?.trailerName ?? run.trailerAssetId ?? "none"}</Text>
        {run.stops.map(stop => <Text key={stop.id} style={textStyle}>{stop.sequence + 1}. {stop.kind} · {run.labels?.sites.find(site => site.siteId === stop.siteId)?.name ?? `site ${stop.siteId}`}</Text>)}
        {run.inspections.map((inspection, index) => <Text key={index} style={textStyle}>Inspection report: {inspection.outcome} · {inspection.notes} · {inspection.recordedAt} · source {inspection.source}</Text>)}
        {run.loads.map(load => <Text key={load.id} style={textStyle}>{load.commodity}: {load.quantity} {load.unit} · manifest {load.manifestReference} · delivery {load.deliveryReference ?? "not recorded"} · source {load.source}</Text>)}
        {run.records.map(record => <Text key={record.id} style={textStyle}>{record.kind}: {record.quantity ?? record.reading} {record.unit} · {record.notes} · source {record.source} · captured {record.capturedAt ?? "not separately supplied"} · accepted {record.recordedAt}</Text>)}
        {run.events.map(event => <Text key={event.id} style={textStyle}>{event.type} · captured {event.capturedAt ?? "not separately supplied"} · accepted {event.recordedAt}</Text>)}
        {run.linkedTicketId && <TogglePillButton onPress={() => router.push(`/ticket/${run.linkedTicketId}` as never)}>Open linked ticket</TogglePillButton>}
        <TextInput accessibilityLabel="Fleet action reason" placeholder="Reason" value={reason} onChangeText={setReason} style={fieldStyle} />
        {run.allowedActions.includes("reassign") && <TogglePillButton onPress={() => { setMode("dispatch"); setFleetId(run.fleetId); setDriver(null); setVehicle(""); setTrailer(null); }}>Choose reassignment resources</TogglePillButton>}
        {run.allowedActions.map(name => name === "reassign" ? <TogglePillButton key={name} disabled={busy || !!unresolved || !!cachedAt || !driver || !vehicle || queued.some(item => item.runId === run.id)} onPress={() => action(run, name)}>Reassign using selected dispatch resources</TogglePillButton> : <FleetRunAction key={`${run.id}:${run.version}:${name}`} run={run} action={name} tickets={current.resources.tickets?.filter(ticket => run.siteIds.includes(ticket.siteId))} disabled={busy || !!unresolved || queued.some(item => item.runId === run.id)} onSubmit={fields => action(run, name, fields)} />)}
      </View>}
      {overview.capabilities.canDispatch && mode === "dispatch" && <View style={{ gap: 12 }}>
        <Text style={[textStyle, { fontWeight: "700" }]}>Dispatch resources / new run</Text>
        <TextInput accessibilityLabel="Fleet run title" placeholder="Run title" value={title} onChangeText={setTitle} style={fieldStyle} />
        {overview.fleets.map(f => <TogglePillButton key={f.id} solid={fleetId === f.id} onPress={() => { setFleetId(f.id); setStopSites([]); setDriver(null); }}>{f.name}</TogglePillButton>)}
        {current.resources.drivers.filter(d => d.fleetIds.includes(fleetId)).map(d => <TogglePillButton key={d.userId} solid={driver === d.userId} onPress={() => setDriver(d.userId)}>{d.name}</TogglePillButton>)}
        {current.resources.equipment.filter(e => e.dispatchable).map(e => <View key={e.id} style={{ gap: 8 }}><Text style={textStyle}>{e.name} · {e.category} · {e.status}</Text>{["vehicle", "truck"].includes(e.category) && <TogglePillButton solid={vehicle === e.id} onPress={() => setVehicle(e.id)}>Use as truck</TogglePillButton>}{e.category === "trailer" && <TogglePillButton solid={trailer === e.id} onPress={() => setTrailer(e.id)}>Use as trailer</TogglePillButton>}</View>)}
        <TogglePillButton onPress={() => setTrailer(null)}>No trailer</TogglePillButton>
        <Text style={textStyle}>Ordered stops: {stopSites.map(stop => `${stop.kind} site ${stop.siteId}`).join(" → ") || "Choose pickup then delivery"}</Text>
        {(["pickup", "delivery", "return"] as const).map(kind => <TogglePillButton key={kind} solid={stopKind === kind} onPress={() => setStopKind(kind)}>{kind} stop</TogglePillButton>)}
        {fleet?.siteIds.map(siteId => <TogglePillButton key={siteId} onPress={() => setStopSites(s => [...s, { siteId, kind: stopKind }])}>Add site {siteId}</TogglePillButton>)}
        <TogglePillButton onPress={() => setStopSites([])}>Clear stops</TogglePillButton>
        <TogglePillButton disabled={busy || !!unresolved} onPress={createRun}>Create draft run</TogglePillButton>
      </View>}
      <TogglePillButton onPress={() => router.push("/work-hub" as never)}>Work Hub</TogglePillButton>
      <TogglePillButton onPress={() => router.push("/(tabs)/askv" as never)}>Ask V</TogglePillButton>
    </>}
  </ScrollView></ScreenSafeArea>;
}
