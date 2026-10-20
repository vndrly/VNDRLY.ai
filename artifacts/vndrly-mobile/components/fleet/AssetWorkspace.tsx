import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { FleetInventorySchema, FleetInventoryDetailSchema, FleetYardSchema, FleetCustodyObservationSchema, FleetCustodyObservationInputSchema, FleetDetailPageSchema, type FleetYard, type FleetCustodyObservation, type FleetInventory as Inventory, type FleetDetail } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { useColors } from "@/hooks/useColors";
import { useFleetCopy } from "@/lib/fleet-copy";
import TogglePillButton from "@/components/TogglePillButton";
import FleetChoiceField from "@/components/FleetChoiceField";
import FleetInventory from "@/components/FleetInventory";
import FleetDetailsLibrary from "@/components/FleetDetailsLibrary";
import { readFleetYardActor, yardScope, type FleetYardActor } from "./yard-client";

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
  const [actor, setActor] = useState<FleetYardActor | null>(null), [inventory, setInventory] = useState<Inventory | null>(null);
  const [yards, setYards] = useState<FleetYard[]>([]), [custody, setCustody] = useState<Custody[]>([]), [details, setDetails] = useState<FleetDetail[]>([]);
  const [selectedId, setSelectedId] = useState(initialAssetId ?? ""), [yardId, setYardId] = useState(""), [detailId, setDetailId] = useState(""), [note, setNote] = useState("");
  const [operation, setOperation] = useState<"intake" | "at_yard" | "attached" | "returned" | "transferred" | null>(null);
  const [advanced, setAdvanced] = useState<"intake" | "details" | "history" | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const read = async <T,>(path: string): Promise<T> => {
    const value = await apiFetch<T>(path, {}, scope.current);
    if (!current()) throw Error("Fleet account changed. Refresh this workspace.");
    return value;
  };
  async function load() {
    try {
      const nextActor = await readFleetYardActor(identity, scope.current);
      const [inventoryRaw, yardsRaw, custodyRaw, detailRaw] = await Promise.all([
        read<unknown>("/api/fleet/inventory"), read<{ yards: unknown[] }>("/api/fleet/yards"),
        read<{ custody: { version: number; observation: unknown; location: unknown }[] }>("/api/fleet/custody"),
        read<unknown>("/api/fleet/details").catch(() => null),
      ]);
      const nextInventory = FleetInventorySchema.parse(inventoryRaw);
      if (initialAssetId && !nextInventory.assets.some(asset => asset.id === initialAssetId)) {
        const exact = FleetInventoryDetailSchema.parse(await read(`/api/fleet/inventory/${encodeURIComponent(initialAssetId)}`));
        if (exact.asset.id !== initialAssetId) throw Error("Asset scope mismatch.");
        nextInventory.assets.unshift(exact.asset);
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
      setDetails(detailRaw ? FleetDetailPageSchema.parse(detailRaw).details : []);
      setYardId(value => value || nextYards.find(yard => yard.isHomeBase)?.id || nextYards[0]?.id || "");
      setError("");
    } catch (cause) { if (current()) {
      if ([401, 403, 404].includes((cause as { status?: number }).status ?? 0)) { setActor(null); setInventory(null); setYards([]); setCustody([]); setDetails([]); setOperation(null); setAdvanced(null); pending.current = null; }
      setError(cause instanceof Error ? cause.message : "Assets unavailable.");
    } }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, []);
  const asset = inventory?.assets.find(item => item.id === selectedId);
  const currentCustody = custody.find(item => item.observation.assetId === selectedId);
  const actualYard = currentCustody?.location?.yardId ?? currentCustody?.observation.yardId;
  const locationLabel = actualYard ? yards.find(yard => yard.id === actualYard)?.name ?? "Unknown Yard" : "No Yard location";
  const canManage = actor?.capabilities.some(value => ["admin", "dispatch", "yard"].includes(value));
  const canSelfCheckIn = actor?.capabilities.includes("driver") && !!initialRunId;
  function begin(next: typeof operation) { pending.current = null; setOperation(next); setNote(""); setError(""); setYardId(next === "transferred" ? yards.find(yard => yard.id !== actualYard && yard.active)?.id ?? "" : actualYard ?? yards[0]?.id ?? ""); }
  async function save() {
    if (!actor || !asset || !operation || lock.current) return;
    const driverOnly = !canManage;
    if (driverOnly && !canSelfCheckIn) { setError("An active assigned Run is required for self-check-in."); return; }
    if (!yardId && operation !== "attached") { setError("Choose a Yard."); return; }
    if (operation === "attached" && !detailId) { setError("Choose the current Detail for rigging."); return; }
    try {
      pending.current ??= FleetCustodyObservationInputSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: currentCustody?.version ?? 0, scope: yardScope(actor), observation: {
        companyId: actor.companyId, assetId: asset.id, state: operation, method: driverOnly ? "driver_app" : "manual", observedAt: new Date().toISOString(), observedByUserId: actor.userId,
        yardId: operation === "attached" ? null : yardId, runId: initialRunId ?? null, detailId: operation === "attached" ? detailId : null,
        latitude: null, longitude: null, notes: note,
      } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Custody request is incomplete."); return; }
    const exact = pending.current;
    lock.current = true; setBusy(true); setError("");
    try {
      const receipt = await apiFetch<{ operationId: string; version: number; observation: unknown }>("/api/fleet/custody/operations", { method: "POST", body: JSON.stringify(exact) }, scope.current);
      const recorded = FleetCustodyObservationSchema.parse(receipt.observation);
      if (receipt.operationId !== exact.operationId || recorded.assetId !== asset.id || receipt.version <= exact.expectedVersion) throw Error("Custody receipt mismatch.");
      const readback = await read<{ custody: { version: number; observation: unknown; location: unknown }[] }>("/api/fleet/custody");
      const verified = readback.custody.find(item => (item.observation as FleetCustodyObservation).assetId === asset.id);
      if (!verified || verified.version < receipt.version) throw Error("Custody readback mismatch. Retry the exact request.");
      const observation = FleetCustodyObservationSchema.parse(verified.observation);
      if (!current() || observation.companyId !== actor.companyId) throw Error("Custody account changed.");
      setCustody(readback.custody.map(item => ({ version: item.version, observation: FleetCustodyObservationSchema.parse(item.observation), location: item.location as Custody["location"] })));
      pending.current = null; setOperation(null); setNotice("Custody recorded. Current location refreshed.");
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Custody result unknown. Retry the exact request."); }
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
      {asset && <TogglePillButton color="blue" onPress={() => setAdvanced(advanced === "history" ? null : "history")}>{copy("Inventory history")}</TogglePillButton>}
    </View>
    {advanced === "intake" && <View style={card}><FleetInventory embedded identity={`${identity.companyId}:${identity.userId}:${identity.membershipId}`} onSaved={() => void load()} /></View>}
    {advanced === "history" && asset && <View style={card}><FleetInventory embedded identity={`${identity.companyId}:${identity.userId}:${identity.membershipId}`} initialAssetId={asset.id} onSaved={() => void load()} /></View>}
    {advanced === "details" && <View style={card}><FleetDetailsLibrary /></View>}
    {!selectedId && inventory?.assets.map(item => <View key={item.id} style={card}><Text style={{ color: colors.text, fontWeight: "700" }}>{item.name}</Text><Text style={{ color: colors.mutedForeground }}>{custody.find(row => row.observation.assetId === item.id)?.observation.state.replaceAll("_", " ") ?? "No custody recorded"}</Text><TogglePillButton color="blue" accessibilityLabel={`Open asset ${item.name}`} onPress={() => setSelectedId(item.id)}>{copy("Open asset")}</TogglePillButton></View>)}
    {selectedId && asset && <View style={card}>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{asset.name}</Text>
      <Text style={{ color: colors.mutedForeground }}>{asset.category} · {currentCustody?.observation.state.replaceAll("_", " ") ?? "No custody recorded"}</Text>
      <Text style={{ color: colors.text }}>{locationLabel}</Text>
      {!!currentCustody?.location?.inheritedFromAssetId && <Text style={{ color: colors.mutedForeground }}>{`Location inherited from attached truck ${currentCustody.location.inheritedFromAssetId}`}</Text>}
      {!!currentCustody && <View style={{ gap: 4 }}><Text style={{ color: colors.text, fontWeight: "700" }}>{copy("Latest custody observation")}</Text><Text style={{ color: colors.mutedForeground }}>{currentCustody.observation.method.replaceAll("_", " ")} · {new Date(currentCustody.observation.observedAt).toLocaleString()}</Text><Text style={{ color: colors.text }}>{currentCustody.observation.notes}</Text></View>}
      {!operation && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {canManage && !currentCustody && <TogglePillButton color="blue" onPress={() => begin("intake")}>{copy("Record intake")}</TogglePillButton>}
        {canManage && <TogglePillButton color="blue" onPress={() => begin("at_yard")}>{copy("Assign Yard")}</TogglePillButton>}
        {canManage && <TogglePillButton color="blue" onPress={() => begin("attached")}>{copy("Attach rigging")}</TogglePillButton>}
        {canManage && currentCustody?.observation.state === "attached" && <TogglePillButton color="blue" onPress={() => begin("at_yard")}>{copy("Detach rigging")}</TogglePillButton>}
        {canManage && <TogglePillButton color="blue" onPress={() => begin("transferred")}>{copy("Transfer asset")}</TogglePillButton>}
        {(canManage || canSelfCheckIn) && <TogglePillButton color="blue" onPress={() => begin("returned")}>{copy(canManage ? "Record return" : "Self-check-in")}</TogglePillButton>}
      </View>}
      {operation && <View style={{ gap: 10 }}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{operation.replaceAll("_", " ")}</Text>
        {operation === "attached" ? <FleetChoiceField label="Current Detail" value={detailId} options={details.map(item => ({ id: item.id, label: item.name }))} onChange={setDetailId} disabled={busy} /> : <View style={{ gap: 8 }}><Text style={{ color: colors.mutedForeground }}>{copy("Select Yard")}</Text>{yards.filter(yard => yard.active).map(yard => <TogglePillButton key={yard.id} color="blue" solid={yardId === yard.id} accessibilityLabel={yard.name} onPress={() => setYardId(yard.id)} disabled={busy}>{yard.name}</TogglePillButton>)}</View>}
        <TextInput accessibilityLabel="Custody reason" placeholder="Condition, transfer, or return reason" value={note} onChangeText={setNote} editable={!busy} multiline style={{ color: colors.text, borderColor: colors.border, borderWidth: 1, padding: 12 }} />
        <TogglePillButton color="blue" disabled={busy} onPress={() => void save()}>{operation === "transferred" ? copy("Confirm transfer") : operation === "returned" ? copy("Confirm check-in") : copy("Record custody")}</TogglePillButton>
        {!pending.current && <TogglePillButton disabled={busy} onPress={() => setOperation(null)}>{copy("Cancel")}</TogglePillButton>}
      </View>}
      {!initialAssetId && <TogglePillButton onPress={() => { setSelectedId(""); setOperation(null); }}>{copy("All assets")}</TogglePillButton>}
    </View>}
    {selectedId && inventory && !asset && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{copy("Asset is unavailable in this company.")}</Text>}
  </View>;
}
