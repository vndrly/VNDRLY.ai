import FleetReviewPacket from "@/components/FleetReviewPacket";
import FleetReplacement from "@/components/FleetReplacement";
import FleetCargo from "@/components/FleetCargo";
import FleetEvidence from "@/components/FleetEvidence";
import FleetDraftEditor from "@/components/FleetDraftEditor";
import FleetDriverAvailability from "@/components/FleetDriverAvailability";
import FleetEta from "@/components/FleetEta";
import { useFleetCopy } from "@/lib/fleet-copy";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import type { FleetOverview, FleetRun, FleetResources, FleetActionInput } from "@workspace/api-zod";
import { CreateFleetRunSchema, previewFleetRunActions } from "@workspace/api-zod";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import TogglePillButton from "@/components/TogglePillButton";
import FleetRunAction from "@/components/FleetRunAction";
import MapboxNativeMap from "@/components/MapboxNativeMap";
import FleetPhoneLocation from "@/components/FleetPhoneLocation";
import FleetLiveActivity from "@/components/FleetLiveActivity";
import FleetGate from "@/components/FleetGate";
import FleetReports from "@/components/FleetReports";
import FleetMaintenance from "@/components/FleetMaintenance";
import FleetSetup from "@/components/FleetSetup";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { fleetActionInput, fleetErrorMessage, fleetQueueErrorMessage, fleetRunLabel } from "@/lib/fleet-mobile";
import { nativeFleetOffline } from "@/lib/fleet-offline-native";
import { FLEET_OFFLINE_MAX_ACTIONS, fleetQueueBase, fleetQueueAssignmentMatches, replayFleetSequence, type FleetOfflineScope, type FleetQueuedAction } from "@/lib/fleet-offline";
export default function FleetWorkspace({ initialRunId, initialMode = "desk" }: {
    initialRunId?: string;
    initialMode?: "desk" | "my-day";
} = {}) {
    const colors = useColors();
    const copy = useFleetCopy();
    const { t } = useTranslation();
    const describeFleetError = (error: unknown) => {
        const code = (error as { code?: string })?.code;
        return code === "fleet.driver_availability_unknown" ? t("fleetAvailability.unknown_no_window") : code === "fleet.driver_schedule_conflict" ? t("fleetAvailability.recorded_conflict") : fleetErrorMessage(error);
    };
    const { user, activeMembershipId, activeMembership } = useAuth();
    const identity = `${user?.id}:${activeMembershipId}`;
    const identityRef = useRef(identity);
    identityRef.current = identity;
    const [data, setData] = useState<{
        identity: string;
        overview: FleetOverview;
        resources: FleetResources;
    } | null>(null);
    const [selected, setSelected] = useState<string | null>(initialRunId ?? null);
    const [mode, setMode] = useState<"desk" | "my-day" | "dispatch" | "map" | "setup" | "maintenance" | "reports" | "directory" | "review">(initialMode);
    const [fleetFilter, setFleetFilter] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [revision, setRevision] = useState(0);
    const [title, setTitle] = useState("");
    const [fleetId, setFleetId] = useState("");
    const [driver, setDriver] = useState<number | null>(null);
    const [vehicle, setVehicle] = useState("");
    const [trailer, setTrailer] = useState<string | null>(null);
    const [stopSites, setStopSites] = useState<{
        siteId: number;
        kind: "pickup" | "delivery" | "return";
    }[]>([]);
    const [stopKind, setStopKind] = useState<"pickup" | "delivery" | "return">("pickup");
    const [reason, setReason] = useState("");
    const [unresolved, setUnresolved] = useState<{
        path: string;
        body: unknown;
        operationId: string;
    } | null>(null);
    const [cachedAt, setCachedAt] = useState<string | null>(null);
    const [queued, setQueued] = useState<FleetQueuedAction[]>([]);
    const companyId = activeMembership ? (activeMembership.orgType === "vendor" ? activeMembership.orgId : null) : user?.vendorId;
    const verifiedAccount = data?.identity === identity ? data.overview.accountScope : undefined;
    const scope: FleetOfflineScope | null = user?.id && companyId ? { userId: user.id, companyId, membershipId: activeMembershipId, ...(verifiedAccount?.userId === user.id && verifiedAccount.companyId === companyId && verifiedAccount.membershipId === activeMembershipId ? {sessionVersion:verifiedAccount.sessionVersion}: {}) } : null;
    async function readQueue() { if (scope) {
        const document = await nativeFleetOffline.read(scope);
        if (identityRef.current === identity)
            setQueued(document.actions);
    } }
    useEffect(() => {
        setSelected(initialRunId ?? null);
        setTitle("");
        setFleetId("");
        setDriver(null);
        setVehicle("");
        setTrailer(null);
        setStopSites([]);
        setReason("");
        setUnresolved(null);
        setBusy(false);
        setCachedAt(null);
        setQueued([]);
        setMode(initialMode);
        setFleetFilter(null);
    }, [identity, initialRunId, initialMode]);
    useEffect(() => {
        let alive = true;
        setData(null);
        setError("");
        if (scope)
            void readQueue().catch(() => undefined);
        if (user?.id)
            void apiFetch<FleetOverview>("/api/fleet/overview")
                .then(async (overview) => {
                if (initialRunId && !overview.runs.some(run => run.id === initialRunId)) {
                    const exact = await apiFetch<FleetRun>(`/api/fleet/runs/${initialRunId}`);
                    overview = { ...overview, runs: [...overview.runs, exact] };
                }
                const resources = overview.capabilities.canDispatch ? await apiFetch<FleetResources>("/api/fleet/resources") : { drivers: [], equipment: [] };
                if (alive && identityRef.current === identity) {
                    setData({ identity, overview, resources });
                    setFleetFilter(overview.preference?.selectedFleetId ?? null);
                    setCachedAt(null);
                    setUnresolved(pending => pending && overview.runs.some(r => r.events.some(e => e.operationId === pending.operationId)) ? null : pending);
                    const account = overview.accountScope;
                    const freshScope = scope && account?.userId === scope.userId && account.companyId === scope.companyId && account.membershipId === scope.membershipId ? {...scope,sessionVersion:account.sessionVersion} : scope;
                    if (freshScope?.sessionVersion !== undefined) await nativeFleetOffline.bindAccount(freshScope);
                    if (freshScope && overview.capabilities.canDrive)
                        void nativeFleetOffline.cache(freshScope, overview).catch(e => { if (alive)
                            setError(e instanceof Error ? e.message : "Fleet cache unavailable."); });
                    if (scope)
                        void nativeFleetOffline.read(scope).then(async (document) => {
                            for (const item of document.actions)
                                if (item.state === "unsynced" && item.sessionVersion === freshScope?.sessionVersion && overview.runs.some(r => r.events.some(event => event.operationId === item.input.operationId)))
                                    await nativeFleetOffline.resolve(scope, item.input.operationId, "accepted");
                            if (alive)
                                await readQueue();
                        }).catch(() => undefined);
                }
            })
                .catch(async (e) => {
                if (!alive)
                    return;
                setError(describeFleetError(e));
                if (scope && (e as {
                    code?: string;
                }).code === "network.unreachable") {
                    const document = await nativeFleetOffline.read(scope).catch(() => null);
                    if (alive && document?.overview) {
                        setData({ identity, overview: document.overview, resources: { drivers: [], equipment: [] } });
                        setCachedAt(document.cachedAt);
                        setQueued(document.actions);
                    }
                }
            });
        return () => { alive = false; };
    }, [identity, revision, user?.id, initialRunId]);
    const current = data?.identity === identity ? data : null;
    const overview = current?.overview;
    const run = overview?.runs.find(r => r.id === selected);
    const pendingRun = queued.filter(item => item.runId === run?.id);
    let proposed: ReturnType<typeof previewFleetRunActions> | null = null;
    let previewError = "";
    if (run && pendingRun.length) {
        try {
            if (!overview?.capabilities.canDrive || run.driverUserId !== user?.id || !fleetQueueAssignmentMatches(pendingRun[0].base, run)) throw new Error("Fleet assignment changed. The offline sequence was not rebased.");
            if (pendingRun.some(item => item.state !== "unsynced")) throw new Error("Resolve the refused Fleet sequence before recording more facts.");
            proposed = previewFleetRunActions(run, pendingRun.map(item => item.input));
        } catch (e) { previewError = e instanceof Error ? e.message : "Offline sequence cannot continue."; }
    }
    const actionRun = run && proposed ? { ...run, version: proposed.expectedVersion, currentStopId: proposed.currentStopId, allowedActions: proposed.allowedActions } : run;
    const formRun = actionRun && proposed ? { ...actionRun, loads: proposed.loads } : actionRun;
    const visibleRuns = overview?.runs.filter(item => (!fleetFilter || item.fleetId === fleetFilter) && (mode !== "my-day" || item.driverUserId === user?.id) && (mode !== "review" || item.status === "submitted_for_review")) ?? [];
    const fleet = overview?.fleets.find(f => f.id === fleetId);
    const textStyle = { color: colors.text, fontSize: 16 };
    const fieldStyle = { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 };
    async function write(path: string, body: unknown) {
        const requestIdentity = identity;
        setBusy(true);
        setError("");
        try {
            await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
            if (identityRef.current !== requestIdentity)
                return;
            if (scope && /\/actions$/.test(path))
                await nativeFleetOffline.resolve(scope, (body as FleetActionInput).operationId, "accepted");
            setUnresolved(null);
            setRevision(n => n + 1);
        }
        catch (e) {
            if (identityRef.current !== requestIdentity)
                return;
            const status = (e as {
                status?: number;
            }).status;
            if (status && status >= 400 && status < 500) {
                if (scope && /\/actions$/.test(path))
                    await nativeFleetOffline.resolve(scope, (body as FleetActionInput).operationId, status === 401 || status === 403 ? "revoked" : "conflict", e instanceof Error ? e.message : "Fleet refused this offline action.");
                setUnresolved(null);
                setError(`${copy(describeFleetError(e))} ${copy("Refresh current permissions and run revision before preparing another action.")}`);
                setData(null);
                return;
            }
            const operationId = (body as {
                operationId: string;
            }).operationId;
            if (scope && /\/actions$/.test(path) && overview?.runs.some(run => run.id === path.split("/").at(-2) && run.driverUserId === scope.userId && !["dispatch", "reassign", "cancel", "review", "link_ticket"].includes((body as FleetActionInput).action))) {
                const input = body as FleetActionInput;
                try {
                    const original = overview?.runs.find(run => run.id === path.split("/").at(-2));
                    if (!original) throw new Error("Fleet assignment unavailable for offline capture.");
                    await nativeFleetOffline.enqueue(scope, { base: queued.find(item => item.runId === original.id)?.base ?? fleetQueueBase(original), runId: original.id, input, capturedAt: (input as FleetActionInput & {
                            capturedAt?: string;
                        }).capturedAt ?? new Date().toISOString(), state: "unsynced" });
                    await readQueue();
                }
                catch (queueError) {
                    setUnresolved({ path, body, operationId });
                    setError(fleetQueueErrorMessage(queueError));
                    return;
                }
            }
            if (!scope || !/\/actions$/.test(path) || !overview?.runs.some(run => run.id === path.split("/").at(-2) && run.driverUserId === scope.userId && !["dispatch", "reassign", "cancel", "review", "link_ticket"].includes((body as FleetActionInput).action))) setUnresolved({ path, body, operationId });
            setError(`${copy(describeFleetError(e))} ${copy("Outcome needs verification. Refresh the run before retrying operation")} ${operationId}.`);
            setData(null);
            setRevision(n => n + 1);
        }
        finally {
            if (identityRef.current === requestIdentity)
                setBusy(false);
        }
    }
    function action(target: FleetRun, name: FleetActionInput["action"], fields: Partial<FleetActionInput> = {}) {
        try {
            const body = fleetActionInput(target, name, Crypto.randomUUID(), name === "reassign" ? { driverUserId: driver ?? undefined, vehicleAssetId: vehicle || undefined, trailerAssetId: trailer, reason: reason || undefined } : fields);
            Object.assign(body, { capturedAt: new Date().toISOString(), source: "user_report" });
            if (scope && (cachedAt || queued.some(item => item.runId === target.id))) {
                const original = overview?.runs.find(item => item.id === target.id);
                if (!original || original.driverUserId !== scope.userId) throw new Error("Only assigned driver facts can be stored offline.");
                const base = queued.find(item => item.runId === target.id)?.base ?? fleetQueueBase(original);
                const requestIdentity = identity;
                setBusy(true);
                void nativeFleetOffline.enqueue(scope, { base, runId: target.id, input: body, capturedAt: body.capturedAt!, state: "unsynced" }).then(readQueue).catch(e => { if (identityRef.current === requestIdentity) setError(fleetQueueErrorMessage(e)); }).finally(() => { if (identityRef.current === requestIdentity) setBusy(false); });
            } else void write(`/api/fleet/runs/${target.id}/actions`, body);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Action unavailable.");
        }
    }
    function createRun() {
        const result = CreateFleetRunSchema.safeParse({ operationId: Crypto.randomUUID(), fleetId, title, driverUserId: driver, vehicleAssetId: vehicle, trailerAssetId: trailer,
            stops: stopSites.map((stop, sequence) => ({ id: Crypto.randomUUID(), ...stop, sequence })) });
        if (!result.success) {
            setError("Choose a fleet, driver, ready truck, title and ordered pickup/delivery stops.");
            return;
        }
        void write("/api/fleet/runs", result.data);
    }
    async function synchronize(item: FleetQueuedAction) {
        if (!scope)
            return;
        const requestIdentity = identity;
        setBusy(true);
        try {
            const assertAccount = () => { if (identityRef.current !== requestIdentity) throw new Error("Fleet account changed. Synchronization stopped."); };
            if (!Number.isInteger(scope.sessionVersion)) throw new Error("Fresh account verification is required before synchronization.");
            await replayFleetSequence(queued.filter(entry => entry.runId === item.runId), {
                scope,
                readRun: async id => { assertAccount(); const saved = await apiFetch<FleetRun>(`/api/fleet/runs/${id}`); assertAccount(); return saved; },
                submit: async (id, input) => { assertAccount(); const saved = await apiFetch<FleetRun>(`/api/fleet/runs/${id}/actions`, { method: "POST", body: JSON.stringify(input) }); assertAccount(); return saved; },
                resolve: async (id, state, message) => { assertAccount(); await nativeFleetOffline.resolve(scope, id, state, message); },
            });
            assertAccount();
            await readQueue();
            setUnresolved(null);
            setRevision(n => n + 1);
        }
        catch (e) {
            if (identityRef.current !== requestIdentity)
                return;
            const status = (e as {
                status?: number;
            }).status;
            if (status === 401 || status === 403 || status === 404) {
                await nativeFleetOffline.resolve(scope, item.input.operationId, "revoked", "Current account no longer has access to this run.");
                await readQueue();
            }
            await readQueue();
            setError(e instanceof Error ? e.message : "Queued action remains unsynced.");
        }
        finally {
            if (identityRef.current === requestIdentity)
                setBusy(false);
        }
    }
    async function loadMoreRuns() {
        if (!overview?.page?.nextCursor || cachedAt) return;
        const requestIdentity = identity; setBusy(true);
        try {
            const next = await apiFetch<FleetOverview>(`/api/fleet/overview?cursor=${encodeURIComponent(overview.page.nextCursor)}`);
            if (identityRef.current !== requestIdentity) return;
            setData(previous => previous?.identity === requestIdentity ? { ...previous, overview: { ...next, runs: [...new Map([...previous.overview.runs, ...next.runs].map(run => [run.id, run])).values()] } } : previous);
        } catch (e) { if (identityRef.current === requestIdentity) setError(describeFleetError(e)); }
        finally { if (identityRef.current === requestIdentity) setBusy(false); }
    }
    async function saveHome(defaultWorkspace: "standard" | "fleet_desk" | "fleet_my_day") {
        if (!overview?.preference || cachedAt)
            return;
        const requestIdentity = identity;
        setBusy(true);
        try {
            await apiFetch("/api/fleet/preferences", { method: "POST", body: JSON.stringify({ expectedVersion: overview.preference.version, defaultWorkspace, selectedFleetId: fleetFilter }) });
            if (identityRef.current === requestIdentity)
                setRevision(n => n + 1);
        }
        catch (e) {
            if (identityRef.current === requestIdentity) {
                setError(`${copy(describeFleetError(e))} ${copy("Refresh the saved preference before retrying.")}`);
                setData(null);
            }
        }
        finally {
            if (identityRef.current === requestIdentity)
                setBusy(false);
        }
    }
    return <ScreenSafeArea><ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    <WorkHubPageTitle title={copy(mode === "my-day" || (overview?.roles.includes("driver") && !overview.capabilities.canDispatch) ? "My Fleet Day" : "Fleet Ops")}/>
    <Text style={textStyle}>{copy("Active company: ")}{overview?.companyId ?? copy("Checking authorization")}</Text>
    <TogglePillButton onPress={() => setRevision(n => n + 1)} disabled={busy}>{copy("Refresh Fleet")}</TogglePillButton>
    {overview && <View style={{ gap: 8 }}><TogglePillButton solid={mode === "desk"} onPress={() => setMode("desk")}>{copy("Fleet Desk / My Run")}</TogglePillButton>{overview.capabilities.canDrive && <TogglePillButton solid={mode === "my-day"} onPress={() => setMode("my-day")}>{copy("My Day")}</TogglePillButton>}<TogglePillButton disabled={!!cachedAt} solid={mode === "reports"} onPress={() => setMode("reports")}>{copy("Fleet reports")}</TogglePillButton><TogglePillButton solid={mode === "map"} onPress={() => setMode("map")}>{copy("Fleet Map")}</TogglePillButton>{overview.capabilities.canDispatch && <><TogglePillButton disabled={!!cachedAt} solid={mode === "directory"} onPress={() => setMode("directory")}>{copy("Fleet directory / readiness")}</TogglePillButton><TogglePillButton solid={mode === "review"} onPress={() => setMode("review")}>{copy("Fleet review")}</TogglePillButton></>}{overview.capabilities.canDispatch && <TogglePillButton solid={mode === "dispatch"} onPress={() => setMode("dispatch")}>{copy("Dispatch")}</TogglePillButton>}{((overview.capabilities.canReportDefect ?? (overview.capabilities.canManage || overview.capabilities.canDrive)) || overview.capabilities.canMaintain === true) && <TogglePillButton disabled={!!cachedAt} solid={mode === "maintenance"} onPress={() => setMode("maintenance")}>{copy("Fleet maintenance")}</TogglePillButton>}{overview.capabilities.canSetup && <TogglePillButton solid={mode === "setup"} onPress={() => setMode("setup")}>{copy("Fleet setup")}</TogglePillButton>}</View>}
    {overview?.enabled && <View style={{ gap: 8 }}><TogglePillButton solid={!fleetFilter} onPress={() => setFleetFilter(null)}>{copy("All authorized fleets")}</TogglePillButton>{overview.fleets.map(item => <TogglePillButton key={item.id} solid={fleetFilter === item.id} onPress={() => setFleetFilter(item.id)}>{item.name}</TogglePillButton>)}{overview.preference && !cachedAt && <><Text style={textStyle}>{copy("Saved home: ")}{copy(overview.preference.defaultWorkspace.replaceAll("_", " "))}{copy(". Changing a home or filter does not expand access.")}</Text><TogglePillButton disabled={busy} onPress={() => void saveHome(overview.preference!.defaultWorkspace)}>{copy("Save this Fleet filter")}</TogglePillButton>{overview.capabilities.canDispatch && <TogglePillButton disabled={busy} onPress={() => void saveHome("fleet_desk")}>{copy("Make Fleet Desk my home")}</TogglePillButton>}{overview.capabilities.canDrive && <TogglePillButton disabled={busy} onPress={() => void saveHome("fleet_my_day")}>{copy("Make My Fleet Day my home")}</TogglePillButton>}<TogglePillButton disabled={busy} onPress={() => void saveHome("standard")}>{copy("Use standard home")}</TogglePillButton></>}</View>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy(error)}</Text>}
    {cachedAt && <Text style={textStyle}>{copy("Offline assigned-work cache from ")}{cachedAt}{copy(". Permissions and readiness are unverified. Entries remain unsynced until the server accepts them; no location is collected.")}</Text>}
    {queued.length > 0 && <Text style={textStyle}>{copy("Queued entries")}: {queued.length}/{FLEET_OFFLINE_MAX_ACTIONS} · {copy("Device storage is bounded; longer reports may need synchronization before another capture.")}</Text>}
    {queued.map(item => <View key={item.input.operationId} style={{ gap: 8 }}><Text style={textStyle}>{copy(item.input.action.replaceAll("_", " "))}{copy(": ")}{copy(item.state)}{copy(" \u00B7 captured ")}{item.capturedAt}{copy(" \u00B7 run ")}{item.runId}{copy(" \u00B7 ")}{item.message ? copy(item.message) : copy("Not accepted by the server")}</Text>{["commodity", "quantity", "unit", "manifestReference", "deliveryReference", "notes", "reason", "reading", "inspectionOutcome"].map(field => (item.input as Record<string, unknown>)[field] !== undefined && <Text key={field} style={textStyle}>{copy(field)}: {String((item.input as Record<string, unknown>)[field])}</Text>)}{item.input.inspectionResponses?.map(response=><Text key={response.id} style={textStyle}>{overview?.runs.find(run=>run.id===item.runId)?.operationalProfile?.inspectionItems.find(rule=>rule.id===response.id)?.label??response.id}: {copy(response.outcome)}{response.notes?` · ${response.notes}`:""}</Text>)}{Object.entries(item.input.manifestValues??{}).map(([id,value])=><Text key={id} style={textStyle}>{overview?.runs.find(run=>run.id===item.runId)?.operationalProfile?.manifestFields.find(rule=>rule.id===id)?.label??id}: {value}</Text>)}{item.state === "unsynced" ? <TogglePillButton disabled={busy || !!cachedAt} onPress={() => void synchronize(item)}>{copy("Verify and synchronize queued operation")}</TogglePillButton> : <TogglePillButton disabled={busy} onPress={() => { if (scope)
        void nativeFleetOffline.discardRefused(scope, item.input.operationId).then(readQueue).catch(e => setError(e instanceof Error ? e.message : "Could not discard local entry.")); }}>{copy("Discard refused local entry")}</TogglePillButton>}</View>)}
    {unresolved && <View style={{ gap: 8 }}><Text style={textStyle}>{copy("Unverified operation: ")}{unresolved.operationId}{copy(". No new action can be started until this outcome is resolved.")}</Text><TogglePillButton disabled={busy || !current} onPress={() => void write(unresolved.path, unresolved.body)}>{copy("Retry same operation after readback")}</TogglePillButton></View>}
    {!current && !error && <ActivityIndicator />}
    {overview && !overview.enabled && <Text style={textStyle}>{copy("Fleet is not enabled for your current company and grants.")}</Text>}
    {mode === "directory" && current && overview?.capabilities.canDispatch && !cachedAt && <View style={{gap:8}}><Text style={textStyle}>{copy("Authorized driver and equipment directory. Availability is a current server projection; dispatch rechecks qualifications, holds and site access.")}</Text>{current.resources.drivers.filter(driver => !fleetFilter || driver.fleetIds.includes(fleetFilter)).map(driver => <View key={driver.userId}><Text style={textStyle}>{driver.name}</Text><FleetDriverAvailability key={`${identity}:${driver.userId}`} driverUserId={driver.userId} actorUserId={user!.id} companyId={overview.companyId}/></View>)}{current.resources.equipment.filter(asset => !fleetFilter || overview.fleets.find(fleet => fleet.id === fleetFilter)?.equipmentAssetIds.includes(asset.id)).map(asset => <Text key={asset.id} style={textStyle}>{asset.name} · {copy(asset.category)} · {copy(asset.status)} · {copy(asset.dispatchable ? "Dispatch candidate" : "Not dispatchable")} · {asset.id}</Text>)}</View>}
    {mode === "review" && <Text style={textStyle}>{copy("Loaded runs awaiting review. Open a run to inspect recorded references and use its permitted review action. Missing media is not physical proof.")}</Text>}
    {mode === "reports" && overview && !cachedAt && <FleetReports key={identity} overview={overview}/>}
    {mode === "maintenance" && overview && current && !cachedAt && user?.id && <FleetMaintenance key={identity} overview={overview} resources={current.resources} userId={user.id}/>}
    {mode === "setup" && overview?.capabilities.canSetup && <FleetSetup key={`${identity}:${revision}`} onSaved={() => setRevision(n => n + 1)}/>}
    {current && overview?.enabled && <>
      <Text style={textStyle}>{copy("Updated ")}{overview.generatedAt}{copy(". Roles: ")}{overview.roles.map(role => copy(role.replaceAll("_", " "))).join(", ")}</Text>
      {(mode === "desk" || mode === "map") && <><Text style={textStyle}>{copy("Location sources")}</Text>
      {overview.observations.length > 0 && <MapboxNativeMap height={280} points={overview.observations.map((observation, index) => ({ id: `${observation.runId}:${index}`, latitude: observation.latitude, longitude: observation.longitude, title: `${copy("Driver phone")} · ${copy(observation.freshness)}`, color: observation.freshness === "recent" ? colors.primary : colors.mutedForeground }))}/>}
      {overview.observations.length === 0 && <Text style={textStyle}>{copy("No sourced Fleet location is available. Truck position, ETA and live tracking are unavailable.")}</Text>}
      {overview.observations.map((o, i) => <Text key={`${o.runId}:${i}`} style={textStyle}>{copy("Driver phone for run ")}{o.runId}{copy(": ")}{o.latitude}{copy(", ")}{o.longitude}{copy(" \u00B7 ")}{copy(o.freshness)}{copy(" \u00B7 recorded ")}{o.recordedAt}{copy(". This is a phone observation, not truck telemetry.")}</Text>)}
      {overview.unavailableIntegrations.length > 0 && <Text style={textStyle}>{copy("Vehicle and trailer trackers, camera feeds and truck-safe routing need separately configured integrations.")}</Text>}
      </>}
      {mode !== "setup" && mode !== "map" && mode !== "maintenance" && mode !== "reports" && <>
      <Text style={[textStyle, { fontWeight: "700" }]}>{copy("Runs")}</Text>
      {visibleRuns.length === 0 && <Text style={textStyle}>{copy("No authorized runs for this view.")}</Text>}
      {overview.page?.nextCursor && <TogglePillButton disabled={busy || !!cachedAt} onPress={() => void loadMoreRuns()}>{copy("Load more runs")}</TogglePillButton>}
      {visibleRuns.map(item => <TogglePillButton key={item.id} onPress={() => { setSelected(item.id); router.push(`/fleet-run/${item.id}` as never); }}>{fleetRunLabel(item, copy)}</TogglePillButton>)}
      </>}
      {run && mode !== "maintenance" && mode !== "reports" && <View style={{ gap: 12, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
        {!cachedAt && user && (run.driverUserId === user.id || overview.capabilities.canDispatch) && <FleetDriverAvailability key={`${identity}:${run.id}:availability`} driverUserId={run.driverUserId} actorUserId={user.id} companyId={overview.companyId} runId={run.id}/>} 
        <FleetDraftEditor key={`${identity}:${run.id}`} run={run} fleet={overview.fleets.find(fleet=>fleet.id===run.fleetId)} disabled={busy || !!cachedAt || !!unresolved || pendingRun.length>0} onSaved={()=>setRevision(n=>n+1)}/>
        {run.schedule && <Text style={textStyle}>{copy("Planned schedule")}: {run.schedule.plannedStartAt} → {run.schedule.plannedEndAt} · {run.schedule.timezone} · {copy("Informational hours")}</Text>}
        {run.operationalProfile && <Text style={textStyle}>{copy("Saved operational profile")}: {run.operationalProfile.name}</Text>}
        <Text style={textStyle}>{fleetRunLabel(run, copy)}{copy(" \u00B7 revision ")}{run.version}</Text>
        {run.status === "acknowledged" && <Text style={textStyle}>{copy("Before starting, record the initial odometer and inspection report for this assigned equipment. A reported defect blocks starting.")}</Text>}
        {run.status === "in_progress" && <Text style={textStyle}>{copy("Closeout requires the required stops, delivery references and ending odometer. Fleet completion does not approve a ticket or payment.")}</Text>}
        <Text style={textStyle}>{copy("Driver ")}{run.labels?.driverName ?? run.driverUserId}{copy(" \u00B7 truck ")}{run.labels?.vehicleName ?? run.vehicleAssetId}{copy(" \u00B7 trailer ")}{run.labels?.trailerName ?? run.trailerAssetId ?? copy("none")}</Text>
        {run.stops.map(stop => <Text key={stop.id} style={textStyle}>{stop.sequence + 1}{copy(". ")}{copy(stop.kind)}{copy(" \u00B7 ")}{run.labels?.sites.find(site => site.siteId === stop.siteId)?.name ?? `site ${stop.siteId}`}</Text>)}
        {run.inspections.map((inspection, index) => <Text key={index} style={textStyle}>{copy("Inspection report: ")}{copy(inspection.outcome)}{copy(" \u00B7 ")}{inspection.notes}{copy(" \u00B7 ")}{inspection.recordedAt}{copy(" \u00B7 source ")}{copy(inspection.source)}</Text>)}
        {run.loads.map(load => <Text key={load.id} style={textStyle}>{load.commodity}{copy(": ")}{load.quantity} {load.unit}{copy(" \u00B7 manifest ")}{load.manifestReference}{copy(" \u00B7 delivery ")}{load.deliveryReference ?? copy("not recorded")}{copy(" \u00B7 source ")}{copy(load.source)}</Text>)}
        {run.records.map(record => <Text key={record.id} style={textStyle}>{copy(record.kind)}{copy(": ")}{record.quantity ?? record.reading} {record.unit}{copy(" \u00B7 ")}{record.notes}{copy(" \u00B7 source ")}{copy(record.source)}{copy(" \u00B7 captured ")}{record.capturedAt ?? copy("not separately supplied")}{copy(" \u00B7 accepted ")}{record.recordedAt}</Text>)}
        {run.events.map(event => <Text key={event.id} style={textStyle}>{event.type}{copy(" \u00B7 captured ")}{event.capturedAt ?? copy("not separately supplied")}{copy(" \u00B7 accepted ")}{event.recordedAt}</Text>)}
        {run.driverUserId === user?.id && overview.capabilities.canDrive && verifiedAccount && !cachedAt && <FleetPhoneLocation key={`${identity}:${run.id}:${run.vehicleAssetId}:${run.trailerAssetId}`} run={run} account={verifiedAccount} disabled={busy || !!unresolved || pendingRun.length > 0}/>}
        {run.driverUserId === user?.id && overview.capabilities.canDrive && verifiedAccount && !cachedAt && <FleetLiveActivity key={`live:${identity}:${run.id}`} runId={run.id} active={run.status === "in_progress" && run.phase !== "paused"} disabled={busy || !!unresolved || pendingRun.length > 0} />}
        <FleetReplacement key={`${identity}:${run.id}`} run={run} canDispatch={overview.capabilities.canDispatch} equipment={current.resources.equipment.filter(asset=>overview.fleets.find(f=>f.id===run.fleetId)?.equipmentAssetIds.includes(asset.id))} disabled={busy || !!cachedAt || !!unresolved || pendingRun.length>0} onChanged={()=>setRevision(n=>n+1)}/>
        <FleetCargo key={`${identity}:${run.id}`} run={run} canDispatch={overview.capabilities.canDispatch} disabled={busy || !!cachedAt || !!unresolved || pendingRun.length>0} onChanged={()=>setRevision(n=>n+1)}/>
        <FleetReviewPacket key={`${identity}:${run.id}`} run={run} disabled={busy || !!cachedAt || !!unresolved || pendingRun.length>0}/>
        <FleetEvidence key={`${identity}:${run.id}`} run={run} account={overview.capabilities.canDrive ? verifiedAccount ?? undefined : undefined} disabled={busy || !!cachedAt || !!unresolved || pendingRun.length>0} onChanged={()=>setRevision(n=>n+1)}/>
        <FleetEta key={`${identity}:${run.id}:${run.version}`} runId={run.id} disabled={busy || !!cachedAt || !!unresolved || pendingRun.length > 0}/>
        <FleetGate key={`${identity}:${run.id}:${run.version}`} run={run} disabled={busy || !!cachedAt || !!unresolved || pendingRun.length > 0} onChanged={() => setRevision(n => n + 1)}/>
        {run.linkedTicketId && <Text style={textStyle}>{copy("Open the linked ticket for its authorized camera attachments and consented ticket location workflow. These remain ticket records; opening the screen does not save Fleet proof or start Fleet tracking.")}</Text>}
        {run.linkedTicketId && <TogglePillButton onPress={() => router.push(`/ticket/${run.linkedTicketId}` as never)}>{copy("Open linked ticket")}</TogglePillButton>}
        <TextInput accessibilityLabel={copy("Fleet action reason")} placeholder={copy("Reason")} value={reason} onChangeText={setReason} style={fieldStyle}/>
        {run.allowedActions.includes("reassign") && <TogglePillButton onPress={() => { setMode("dispatch"); setFleetId(run.fleetId); setDriver(null); setVehicle(""); setTrailer(null); }}>{copy("Choose reassignment resources")}</TogglePillButton>}
        {pendingRun.length > 0 && <Text style={textStyle}>{copy("Pending device sequence, not accepted by the server")}{copy(" · predicted revision ")}{proposed?.expectedVersion ?? "—"}{previewError ? ` · ${copy(previewError)}` : ""}</Text>}
        {actionRun?.allowedActions.map(name => name === "reassign" ? <TogglePillButton key={name} disabled={busy || !!unresolved || !!cachedAt || !driver || !vehicle || queued.some(item => item.runId === run.id)} onPress={() => action(run, name)}>{copy("Reassign using selected dispatch resources")}</TogglePillButton> : <FleetRunAction key={`${run.id}:${actionRun.version}:${name}`} run={formRun!} action={name} tickets={current.resources.tickets?.filter(ticket => run.siteIds.includes(ticket.siteId))} disabled={busy || !!unresolved || !!previewError} onSubmit={fields => action(actionRun, name, fields)}/>)}
      </View>}
      {overview.capabilities.canDispatch && mode === "dispatch" && <View style={{ gap: 12 }}>
        <Text style={[textStyle, { fontWeight: "700" }]}>{copy("Dispatch resources / new run")}</Text>
        <TextInput accessibilityLabel={copy("Fleet run title")} placeholder={copy("Run title")} value={title} onChangeText={setTitle} style={fieldStyle}/>
        {overview.fleets.map(f => <TogglePillButton key={f.id} solid={fleetId === f.id} onPress={() => { setFleetId(f.id); setStopSites([]); setDriver(null); setVehicle(""); setTrailer(null); }}>{f.name}</TogglePillButton>)}
        {current.resources.drivers.filter(d => d.fleetIds.includes(fleetId)).map(d => <TogglePillButton key={d.userId} solid={driver === d.userId} onPress={() => setDriver(d.userId)}>{d.name}</TogglePillButton>)}
        {current.resources.equipment.filter(e => e.dispatchable && fleet?.equipmentAssetIds.includes(e.id)).map(e => <View key={e.id} style={{ gap: 8 }}><Text style={textStyle}>{e.name}{copy(" \u00B7 ")}{copy(e.category)}{copy(" \u00B7 ")}{copy(e.status)}</Text>{["vehicle", "truck"].includes(e.category) && <TogglePillButton solid={vehicle === e.id} onPress={() => setVehicle(e.id)}>{copy("Use as truck")}</TogglePillButton>}{e.category === "trailer" && <TogglePillButton solid={trailer === e.id} onPress={() => setTrailer(e.id)}>{copy("Use as trailer")}</TogglePillButton>}</View>)}
        <TogglePillButton onPress={() => setTrailer(null)}>{copy("No trailer")}</TogglePillButton>
        <Text style={textStyle}>{copy("Ordered stops: ")}{stopSites.map(stop => `${copy(stop.kind)} site ${stop.siteId}`).join(" → ") || "Choose pickup then delivery"}</Text>
        {(["pickup", "delivery", "return"] as const).map(kind => <TogglePillButton key={kind} solid={stopKind === kind} onPress={() => setStopKind(kind)}>{kind}{copy(" stop")}</TogglePillButton>)}
        {fleet?.siteIds.map(siteId => <TogglePillButton key={siteId} onPress={() => setStopSites(s => [...s, { siteId, kind: stopKind }])}>{copy("Add site ")}{siteId}</TogglePillButton>)}
        <TogglePillButton onPress={() => setStopSites([])}>{copy("Clear stops")}</TogglePillButton>
        <TogglePillButton disabled={busy || !!unresolved} onPress={createRun}>{copy("Create draft run")}</TogglePillButton>
      </View>}
      <TogglePillButton onPress={() => router.push("/work-hub" as never)}>{copy("Work Hub")}</TogglePillButton>
      <TogglePillButton onPress={() => router.push("/(tabs)/askv" as never)}>{copy("Ask V")}</TogglePillButton>
    </>}
  </ScrollView></ScreenSafeArea>;
}
