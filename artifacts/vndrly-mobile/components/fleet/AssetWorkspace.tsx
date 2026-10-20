import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetInventorySchema, FleetAssetCreateSchema, FleetYardSchema, FleetCustodyObservationSchema, FleetCustodyObservationInputSchema, FleetDetailPageSchema, type FleetYard, type FleetCustodyObservation, type FleetInventory as Inventory, type FleetDetail } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
import FleetChoiceField from "@/components/FleetChoiceField";
import FleetInventory from "@/components/FleetInventory";
import FleetDetailsLibrary from "@/components/FleetDetailsLibrary";
import { readFleetYardActor, yardFeedback, yardScope, type FleetYardActor } from "./yard-client";

type Custody = { version: number; observation: FleetCustodyObservation; location: FleetCustodyObservation & { inheritedFromAssetId?: string | null } };
type Attempt = ReturnType<typeof FleetCustodyObservationInputSchema.parse>;

export default function AssetWorkspace({ initialAssetId, initialRunId }: { initialAssetId?: string; initialRunId?: string }) {
  const { user, activeMembership, activeMembershipId } = useAuth();
  const identity = { companyId: activeMembership?.orgId ?? user?.vendorId ?? 0, userId: user?.id ?? 0, membershipId: activeMembershipId ?? user?.activeMembershipId ?? 0 };
  return <AssetWorkspaceContent key={`${identity.companyId}:${identity.userId}:${identity.membershipId}`} identity={identity} initialAssetId={initialAssetId} initialRunId={initialRunId} />;
}

function AssetWorkspaceContent({ identity, initialAssetId, initialRunId }: { identity: { companyId: number; userId: number; membershipId: number }; initialAssetId?: string; initialRunId?: string }) {
  const colors = useColors(), copy = useFleetCopy();
  const scope = useRef(captureAuthScope()), alive = useRef(true), lock = useRef(false), pending = useRef<Attempt | null>(null);
  const attemptedOperationId = useRef<string | null>(null);
  const selectedAssetRef = useRef(initialAssetId ?? ""), custodyRead = useRef(0);
  const [actor, setActor] = useState<FleetYardActor | null>(null), [inventory, setInventory] = useState<Inventory | null>(null);
  const [yards, setYards] = useState<FleetYard[]>([]), [custody, setCustody] = useState<Custody[]>([]), [details, setDetails] = useState<FleetDetail[]>([]);
  const [selectedId, setSelectedId] = useState(initialAssetId ?? ""), [yardId, setYardId] = useState(""), [detailId, setDetailId] = useState(""), [note, setNote] = useState("");
  const [selectedCustody, setSelectedCustody] = useState<Custody | null>(null), [custodyReady, setCustodyReady] = useState(false);
  const [search, setSearch] = useState(""), [intakeFleetId, setIntakeFleetId] = useState(""), [newName, setNewName] = useState(""), [newOwner, setNewOwner] = useState(""), [newCategory, setNewCategory] = useState("truck"), [newIdentifier, setNewIdentifier] = useState("");
  const intakePending = useRef<{ scope: ReturnType<typeof yardScope>; fleetId: string; asset: ReturnType<typeof FleetAssetCreateSchema.parse> } | null>(null);
  const [operation, setOperation] = useState<"intake" | "at_yard" | "attached" | "returned" | "transferred" | null>(null);
  const [advanced, setAdvanced] = useState<"intake" | "details" | "history" | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const read = async <T,>(path: string): Promise<T> => {
    const value = await apiFetch<T>(path, {}, scope.current);
    if (!current()) throw Error("Fleet account changed. Refresh this workspace.");
    return value;
  };
  async function loadExactCustody(id: string) {
    const request = ++custodyRead.current;
    if (selectedAssetRef.current === id) setCustodyReady(false);
    const value = await read<{ custody: { version: number; observation: unknown; location: unknown }[] }>(`/api/fleet/custody?assetId=${encodeURIComponent(id)}`);
    const item = value.custody.find(row => (row.observation as FleetCustodyObservation).assetId === id);
    const observation = item ? FleetCustodyObservationSchema.parse(item.observation) : null;
    if (observation && observation.companyId !== identity.companyId) throw Error("Custody company scope mismatch.");
    const exact = item && observation ? { version: item.version, observation, location: item.location as Custody["location"] } : null;
    if (current() && selectedAssetRef.current === id && custodyRead.current === request) { setSelectedCustody(exact); setCustodyReady(true); }
    return exact;
  }
  async function loadAssemblyTargets(id: string) {
    const value = FleetDetailPageSchema.parse(await read(`/api/fleet/yard-assembly-targets?assetId=${encodeURIComponent(id)}`));
    if (current() && selectedAssetRef.current === id) setDetails(value.details);
  }
  async function openAsset(id: string) { if (pending.current) { setError(copy("Recover the pending asset action before changing assets.")); return; } selectedAssetRef.current = id; setSelectedId(id); setOperation(null); setDetails([]); try { await loadExactCustody(id); if (canManage && selectedAssetRef.current === id) await loadAssemblyTargets(id); } catch (cause) { if (current() && selectedAssetRef.current === id) setError(yardFeedback(cause, copy, "Custody unavailable.", "custody")); } }
  async function loadMore() {
    if (!inventory?.nextCursor) return;
    try { const page = FleetInventorySchema.parse(await read(`/api/fleet/yard-assets?after=${encodeURIComponent(inventory.nextCursor)}`));
      if (current()) setInventory(prior => prior ? { ...page, assets: [...new Map([...prior.assets, ...page.assets].map(asset => [asset.id, asset])).values()] } : page);
    } catch (cause) { if (current()) setError(yardFeedback(cause, copy, "Assets unavailable.", "asset")); }
  }
  async function load() {
    try {
      const nextActor = await readFleetYardActor(identity, scope.current);
      const [inventoryRaw, yardsRaw, custodyRaw] = await Promise.all([
        read<unknown>("/api/fleet/yard-assets"), read<{ yards: unknown[] }>("/api/fleet/yards"),
        read<{ custody: { version: number; observation: unknown; location: unknown }[] }>("/api/fleet/custody"),
      ]);
      const nextInventory = FleetInventorySchema.parse(inventoryRaw);
      const selectedAssetId = selectedAssetRef.current;
      if (selectedAssetId && !nextInventory.assets.some(asset => asset.id === selectedAssetId)) {
        const exact = FleetInventorySchema.parse(await read(`/api/fleet/yard-assets?assetId=${encodeURIComponent(selectedAssetId)}`));
        if (exact.assets[0]?.id !== selectedAssetId) throw Error("Asset scope mismatch.");
        nextInventory.assets.unshift(exact.assets[0]);
      }
      const nextYards = yardsRaw.yards.map(value => FleetYardSchema.parse(value));
      if (nextYards.some(yard => yard.companyId !== identity.companyId)) throw Error("Yard company scope mismatch.");
      const nextCustody = custodyRaw.custody.map(value => {
        const observation = FleetCustodyObservationSchema.parse(value.observation);
        if (observation.companyId !== identity.companyId) throw Error("Custody company scope mismatch.");
        return { version: value.version, observation, location: value.location as Custody["location"] };
      });
      if (!current()) return;
      setActor(nextActor); setInventory(nextInventory); setYards(nextYards); setCustody(nextCustody);
      setIntakeFleetId(value => value || nextInventory.fleets[0]?.id || "");
      setDetails([]);
      setYardId(value => value || nextYards.find(yard => yard.isHomeBase)?.id || nextYards[0]?.id || "");
      if (selectedAssetId && selectedAssetRef.current === selectedAssetId) { await loadExactCustody(selectedAssetId); if (selectedAssetRef.current === selectedAssetId && nextActor.capabilities.some(value => ["admin", "dispatch", "yard"].includes(value))) await loadAssemblyTargets(selectedAssetId); }
      setError("");
    } catch (cause) { if (current()) {
      if ([401, 403, 404].includes((cause as { status?: number }).status ?? 0)) { setActor(null); setInventory(null); setYards([]); setCustody([]); setDetails([]); setOperation(null); setAdvanced(null); pending.current = null; }
      setError(yardFeedback(cause, copy, "Assets unavailable.", "asset"));
    } }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  const asset = inventory?.assets.find(item => item.id === selectedId);
  const currentCustody = custodyReady ? selectedCustody : null;
  const actualYard = currentCustody?.location?.yardId ?? currentCustody?.observation.yardId;
  const locationLabel = actualYard ? yards.find(yard => yard.id === actualYard)?.name ?? copy("Unknown Yard") : copy("No Yard location");
  const canManage = actor?.capabilities.some(value => ["admin", "dispatch", "yard"].includes(value));
  const canSelfCheckIn = actor?.capabilities.includes("driver") && !!initialRunId;
  function begin(next: typeof operation) { if (pending.current || !custodyReady) return; setOperation(next); setNote(""); setError(""); setYardId(next === "transferred" ? yards.find(yard => yard.id !== actualYard && yard.active)?.id ?? "" : actualYard ?? yards[0]?.id ?? ""); }
  async function receiveAsset() {
    if (!actor || lock.current) return;
    let posting = false;
    try {
      const retry = !!intakePending.current;
      if (!intakeFleetId) throw Error(copy("Choose a Fleet group."));
      intakePending.current ??= { scope: yardScope(actor), fleetId: intakeFleetId, asset: FleetAssetCreateSchema.parse({ operationId: Crypto.randomUUID(), name: newName, legalOwner: newOwner, category: newCategory, identifier: { kind: "asset_tag", value: newIdentifier } }) };
      lock.current = true; setBusy(true); setError("");
      const exact = intakePending.current;
      let receipt: { assetId: string } | null = null;
      if (retry) try { receipt = await read<{ assetId: string }>(`/api/fleet/yard-assets/operations/${exact.asset.operationId}`); }
      catch (cause) { if ((cause as { status?: number }).status !== 404) throw cause; }
      if (!receipt) posting = true;
      const saved = receipt ?? await apiFetch<{ assetId: string }>("/api/fleet/yard-assets", { method: "POST", body: JSON.stringify(exact) }, scope.current);
      posting = false;
      const page = FleetInventorySchema.parse(await read(`/api/fleet/yard-assets?assetId=${encodeURIComponent(saved.assetId)}`));
      if (page.assets[0]?.id !== saved.assetId) throw Error(copy("Asset readback mismatch. Retry the same request."));
      intakePending.current = null; setAdvanced(null); setInventory(prior => prior ? { ...prior, assets: [page.assets[0], ...prior.assets] } : page);
      await openAsset(saved.assetId); setNotice(copy("Asset received in the selected Fleet group."));
    } catch (cause) { if (current()) { const status = (cause as { status?: number }).status; if (posting && status && status >= 400 && status < 500 && ![408, 429].includes(status)) intakePending.current = null; setError(yardFeedback(cause, copy, "Asset intake needs recovery.", "asset")); } }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  async function save() {
    if (!actor || !asset || !operation || lock.current || (!custodyReady && !pending.current)) return;
    const driverOnly = !canManage;
    if (driverOnly && !canSelfCheckIn) { setError(copy("An active assigned Run is required for self-check-in.")); return; }
    if (!yardId && operation !== "attached") { setError(copy("Choose a Yard.")); return; }
    if (operation === "attached" && !detailId) { setError(copy("Choose the current Detail for rigging.")); return; }
    try {
      pending.current ??= FleetCustodyObservationInputSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: currentCustody?.version ?? 0, scope: yardScope(actor), observation: {
        companyId: actor.companyId, assetId: asset.id, state: operation, method: driverOnly ? "driver_app" : "manual", observedAt: new Date().toISOString(), observedByUserId: actor.userId,
        yardId: operation === "attached" ? null : yardId, runId: initialRunId ?? null, detailId: operation === "attached" ? detailId : null,
        latitude: null, longitude: null, notes: note,
      } });
    } catch (cause) { setError(yardFeedback(cause, copy, "Custody request is incomplete.", "custody")); return; }
    const exact = pending.current;
    lock.current = true; setBusy(true); setError("");
    let posting = false;
    try {
      let receipt: { operationId: string; version: number; observation: unknown } | null = null;
      if (attemptedOperationId.current === exact.operationId) {
        try { const found = await read<{ operationId: string; result: { operationId: string; version: number; observation: unknown } }>(`/api/fleet/custody/operations/${exact.operationId}`); receipt = found.result; }
        catch (cause) { if ((cause as { status?: number }).status !== 404) throw cause; }
      }
      attemptedOperationId.current = exact.operationId;
      if (!receipt) posting = true;
      receipt ??= await apiFetch<{ operationId: string; version: number; observation: unknown }>("/api/fleet/custody/operations", { method: "POST", body: JSON.stringify(exact) }, scope.current);
      posting = false;
      const recorded = FleetCustodyObservationSchema.parse(receipt.observation);
      if (receipt.operationId !== exact.operationId || recorded.assetId !== asset.id || receipt.version <= exact.expectedVersion) throw Error("Custody receipt mismatch.");
      const verified = await loadExactCustody(asset.id);
      if (!verified || verified.version < receipt.version) throw Error("Custody readback mismatch. Retry the exact request.");
      const observation = verified.observation;
      if (!current() || observation.companyId !== actor.companyId) throw Error("Custody account changed.");
      setCustody(prior => [verified, ...prior.filter(row => row.observation.assetId !== asset.id)]);
      pending.current = null; attemptedOperationId.current = null; setOperation(null); setNotice(copy("Custody recorded. Current location refreshed."));
    } catch (cause) { if (current()) { const status = (cause as { status?: number }).status; if (posting && status && status >= 400 && status < 500 && ![408, 429].includes(status)) { pending.current = null; attemptedOperationId.current = null; if (status === 409) { try { await loadExactCustody(asset.id); } catch { /* Retain form for review. */ } setError(copy("Custody changed. Review the current observation and reapply.")); } else setError(yardFeedback(cause, copy, "Custody action was rejected.", "custody")); } else setError(yardFeedback(cause, copy, "Custody result unknown. Retry the exact request.", "custody")); } }
    finally { lock.current = false; if (current()) setBusy(false); }
  }
  const card = { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2, borderRadius: 16, padding: 16, gap: 10 } as const;
  return <View style={{ gap: 16 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>{copy("Assets and Details")}</Text>
    <Text style={{ color: colors.mutedForeground }}>{copy("Receive assets, track custody, and build reusable driver-free Details.")}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {!!notice && <Text style={{ color: colors.text }}>{notice}</Text>}
    <TogglePillButton color="blue" disabled={busy} onPress={() => void load()}>{copy("Refresh assets")}</TogglePillButton>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {inventory?.canManage && <TogglePillButton color="blue" onPress={() => setAdvanced(advanced === "intake" ? null : "intake")}>{copy("Receive new asset")}</TogglePillButton>}
      <TogglePillButton color="blue" onPress={() => setAdvanced(advanced === "details" ? null : "details")}>{copy("Build Details and rigging")}</TogglePillButton>
      {asset && actor?.capabilities.includes("admin") && <TogglePillButton color="blue" onPress={() => setAdvanced(advanced === "history" ? null : "history")}>{copy("Inventory history")}</TogglePillButton>}
    </View>
    {advanced === "intake" && inventory?.canManage && <View style={card}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>{copy("Receive new asset")}</Text>
      <FleetChoiceField label={copy("Fleet group")} value={intakeFleetId} options={inventory.fleets.map(fleet => ({ id: fleet.id, label: fleet.name }))} onChange={setIntakeFleetId} disabled={busy || !!intakePending.current} />
      <FleetChoiceField label={copy("Category")} value={newCategory} options={(["truck", "trailer", "vehicle", "dolly", "tank", "pump", "accessory"] as const).map(value => ({ id: value, label: copy(value) }))} onChange={setNewCategory} disabled={busy || !!intakePending.current} />
      <TextInput accessibilityLabel={copy("Asset name")} placeholder={copy("Asset name")} value={newName} onChangeText={setNewName} editable={!busy && !intakePending.current} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TextInput accessibilityLabel={copy("Legal owner")} placeholder={copy("Legal owner")} value={newOwner} onChangeText={setNewOwner} editable={!busy && !intakePending.current} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TextInput accessibilityLabel={copy("Asset tag")} placeholder={copy("Asset tag")} value={newIdentifier} onChangeText={setNewIdentifier} editable={!busy && !intakePending.current} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
      <TogglePillButton color="blue" disabled={busy} onPress={() => void receiveAsset()}>{intakePending.current ? copy("Recover asset intake") : copy("Save asset intake")}</TogglePillButton>
      {!intakePending.current && <TogglePillButton disabled={busy} onPress={() => setAdvanced(null)}>{copy("Cancel")}</TogglePillButton>}
    </View>}
    {advanced === "history" && asset && <View style={card}><FleetInventory embedded identity={`${identity.companyId}:${identity.userId}:${identity.membershipId}`} initialAssetId={asset.id} onSaved={() => void load()} /></View>}
    {advanced === "details" && <View style={card}><FleetDetailsLibrary /></View>}
    {!selectedId && <TextInput accessibilityLabel={copy("Search assets")} placeholder={copy("Search assets by name or tag")} value={search} onChangeText={setSearch} style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />}
    {!selectedId && inventory?.assets.filter(item => [item.name, item.category, ...item.aliases.map(alias => alias.value)].join(" ").toLowerCase().includes(search.toLowerCase())).map(item => <View key={item.id} style={card}><Text style={{ color: colors.text, fontWeight: "700" }}>{item.name}</Text><Text style={{ color: colors.mutedForeground }}>{item.aliases[0]?.value ?? item.category} · {copy(custody.find(row => row.observation.assetId === item.id)?.observation.state.replaceAll("_", " ") ?? "No custody recorded")}</Text><TogglePillButton color="blue" accessibilityLabel={`${copy("Open asset")} ${item.name}`} onPress={() => void openAsset(item.id)}>{copy("Open asset")}</TogglePillButton></View>)}
    {!selectedId && inventory?.nextCursor && <TogglePillButton color="blue" disabled={busy} onPress={() => void loadMore()}>{copy("Load more assets")}</TogglePillButton>}
    {selectedId && asset && <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{asset.name}</Text>
      <Text style={{ color: colors.mutedForeground }}>{copy(asset.category)} · {custodyReady ? copy(currentCustody?.observation.state.replaceAll("_", " ") ?? "No custody recorded") : copy("Loading custody")}</Text>
      <Text style={{ color: colors.text }}>{locationLabel}</Text>
      {!!currentCustody?.location?.inheritedFromAssetId && <Text style={{ color: colors.mutedForeground }}>{copy("Location inherited from attached truck")} {currentCustody.location.inheritedFromAssetId}</Text>}
      {!!currentCustody && <View style={{ gap: 4 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{copy(({ gate_scan: "Gate scan", gps_geofence: "GPS geofence", manual: "Manual entry", driver_app: "Driver app" })[currentCustody.observation.method])} · {new Date(currentCustody.observation.observedAt).toLocaleString()}</Text><Text style={{ color: colors.text }}>{currentCustody.observation.notes}</Text></View>}
      {!operation && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {canManage && custodyReady && !currentCustody && <TogglePillButton color="blue" onPress={() => begin("intake")}>{copy("Record intake")}</TogglePillButton>}
        {canManage && <TogglePillButton color="blue" onPress={() => begin("at_yard")}>{copy("Assign Yard")}</TogglePillButton>}
        {canManage && <TogglePillButton color="blue" onPress={() => begin("attached")}>{copy("Attach rigging")}</TogglePillButton>}
        {canManage && currentCustody?.observation.state === "attached" && <TogglePillButton color="blue" onPress={() => begin("at_yard")}>{copy("Detach rigging")}</TogglePillButton>}
        {canManage && <TogglePillButton color="blue" onPress={() => begin("transferred")}>{copy("Transfer asset")}</TogglePillButton>}
        {(canManage || canSelfCheckIn) && <TogglePillButton color="blue" onPress={() => begin("returned")}>{copy(canManage ? "Record return" : "Self-check-in")}</TogglePillButton>}
      </View>}
      {operation && <View style={{ gap: 10 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{copy(operation.replaceAll("_", " "))}</Text>
        {operation === "attached" ? <FleetChoiceField label={copy("Current Detail")} value={detailId} options={details.map(item => ({ id: item.id, label: item.name }))} onChange={setDetailId} disabled={busy || !!pending.current} /> : <View style={{ gap: 8 }}><Text style={{ color: colors.mutedForeground }}>{copy("Select Yard")}</Text>{yards.filter(yard => yard.active).map(yard => <TogglePillButton key={yard.id} color="blue" solid={yardId === yard.id} accessibilityLabel={yard.name} onPress={() => setYardId(yard.id)} disabled={busy || !!pending.current}>{yard.name}</TogglePillButton>)}</View>}
        <TextInput accessibilityLabel={copy("Custody reason")} placeholder={copy("Condition, transfer, or return reason")} value={note} onChangeText={setNote} editable={!busy && !pending.current} multiline style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
        <TogglePillButton color="blue" disabled={busy} onPress={() => void save()}>{operation === "transferred" ? copy("Confirm transfer") : operation === "returned" ? copy("Confirm check-in") : copy("Record custody")}</TogglePillButton>
        {!pending.current && <TogglePillButton disabled={busy} onPress={() => setOperation(null)}>{copy("Cancel")}</TogglePillButton>}
      </View>}
      {!initialAssetId && <TogglePillButton disabled={busy || !!pending.current} onPress={() => { selectedAssetRef.current = ""; custodyRead.current++; setSelectedId(""); setOperation(null); setCustodyReady(false); }}>{copy("All assets")}</TogglePillButton>}
    </View>}
    {selectedId && inventory && !asset && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy("Asset is unavailable in this company.")}</Text>}
  </View>;
}
