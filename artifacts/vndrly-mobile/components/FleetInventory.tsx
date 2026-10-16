import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { FleetAssetCreateSchema, FleetAssetEditSchema, FleetAssetEnrollmentSchema, FleetInventorySchema, FleetInventoryDetailSchema, FleetInventoryReceiptSchema, type FleetInventory as Inventory, type FleetInventoryDetail } from "@workspace/api-zod";
import TogglePillButton from "@/components/TogglePillButton";
import SphereBackButton from "@/components/SphereBackButton";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api";
import { captureAuthScope, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";
import { useFleetInventoryCopy } from "@/lib/fleet-inventory-copy";

/** Remount drafts and protected records when the auth generation changes, even in the same company. */
function useAuthGeneration() {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const clear = () => setGeneration(value => value + 1);
    const user = subscribeUser(clear), token = subscribeToken(clear);
    return () => { user(); token(); };
  }, []);
  return generation;
}
function useRequestScope() {
  const scope = useRef(captureAuthScope()), controller = useRef(new AbortController()), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current.abort(); }; }, []);
  const current = () => alive.current && !controller.current.signal.aborted && isAuthScopeCurrent(scope.current);
  async function request(path: string, init: RequestInit = {}) {
    if (!current()) throw Error("Account changed");
    const result = await apiFetch<unknown>(path, { ...init, signal: controller.current.signal }, scope.current);
    if (!current()) throw Error("Account changed");
    return result;
  }
  return { current, request };
}
type Attempt = { path: string; method: "POST" | "PATCH"; body: { operationId: string }; assetId?: string };
function useMutation(onSaved: (detail: FleetInventoryDetail) => void, onDenied: () => void, freshRevision = 0) {
  const c = useFleetInventoryCopy(), access = useRequestScope();
  const attempt = useRef<Attempt | null>(null), inflight = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [pending, setPending] = useState(false), [refused, setRefused] = useState(false);
  useEffect(() => { setRefused(false); }, [freshRevision]);
  async function save(prepare: () => Attempt) {
    if (inflight.current || refused || !access.current()) return;
    try { attempt.current ??= prepare(); } catch { setMessage(c.required); return; }
    const operation = attempt.current;
    inflight.current = true; setBusy(true); setPending(true); setMessage("");
    try {
      const receipt = FleetInventoryReceiptSchema.parse(await access.request(operation.path, { method: operation.method, body: JSON.stringify(operation.body) }));
      if (receipt.operationId !== operation.body.operationId || operation.assetId && receipt.assetId !== operation.assetId) throw Error("Fleet receipt mismatch");
      const detail = FleetInventoryDetailSchema.parse(await access.request(`/api/fleet/inventory/${receipt.assetId}`));
      if (detail.asset.id !== receipt.assetId || detail.asset.version < receipt.version) throw Error("Fleet readback mismatch");
      attempt.current = null; setPending(false); setMessage(operation.method === "PATCH" ? c.updated : c.saved);
      onSaved(detail);
    } catch (error) {
      if (access.current()) {
        const { status, code } = error as { status?: number; code?: string };
        setMessage(code === "fleet.version_conflict" ? c.conflict : code === "fleet.identifier_in_use" ? c.duplicate : c.unknown);
        if (status && status >= 400 && status < 500 && ![408, 429].includes(status)) {
          attempt.current = null; setPending(false);
          if (code === "fleet.version_conflict" || [401, 403, 404].includes(status)) setRefused(true);
          if ([401, 403, 404].includes(status)) onDenied();
        }
      }
    } finally { inflight.current = false; if (access.current()) setBusy(false); }
  }
  return { busy, message, pending, refused, locked: busy || pending || refused, save };
}
function Field({ label, value, onChange, disabled, maxLength = 200 }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; maxLength?: number }) {
  const colors = useColors();
  return <View style={{ gap: 4 }}><Text style={{ color: colors.mutedForeground }}>{label}</Text><TextInput accessibilityLabel={label} editable={!disabled} value={value} onChangeText={onChange} maxLength={maxLength} style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12 }} /></View>;
}
const openFullInventory = () => router.push("/work-hub/inventory" as never);
type Props = { identity: string; initialAssetId?: string; onSaved?: () => void };
export default function FleetInventory(props: Props) {
  const generation = useAuthGeneration();
  return <InventoryContent key={`${props.identity}:${generation}`} {...props} />;
}
function InventoryContent({ initialAssetId, onSaved }: Props) {
  const c = useFleetInventoryCopy(), colors = useColors(), access = useRequestScope();
  const [list, setList] = useState<Inventory | null>(null), [detail, setDetail] = useState<FleetInventoryDetail | null>(null), [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [search, setSearch] = useState(""), [fleet, setFleet] = useState(""), [adding, setAdding] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [freshRevision, setFreshRevision] = useState(0);
  const readGeneration = useRef(0), loadingRef = useRef(false);
  async function load(after?: string) {
    const generation = ++readGeneration.current;
    loadingRef.current = true; setLoading(true); setError("");
    try {
      if (assetId) {
        const value = FleetInventoryDetailSchema.parse(await access.request(`/api/fleet/inventory/${encodeURIComponent(assetId)}`));
        if (value.asset.id !== assetId) throw Error("Asset scope mismatch");
        if (generation === readGeneration.current) { setDetail(value); setFreshRevision(n => n + 1); }
      } else {
        const params = new URLSearchParams({ ...(after ? { after } : {}), ...(fleet ? { fleetId: fleet } : {}) });
        const value = FleetInventorySchema.parse(await access.request(`/api/fleet/inventory${params.size ? `?${params}` : ""}`));
        if (generation === readGeneration.current) setList(prior => ({ ...value, assets: after ? [...new Map([...(prior?.assets ?? []), ...value.assets].map(a => [a.id, a])).values()] : value.assets }));
      }
    } catch (error) { if (access.current() && generation === readGeneration.current) {
      // A transport failure cannot discard an unresolved write and its exact
      // retry body. Definite access revocation still clears protected content.
      if ([401, 403, 404].includes((error as { status?: number }).status ?? 0)) { setList(null); setDetail(null); setAdding(false); }
      setError(c.unavailable);
    } }
    finally { if (access.current() && generation === readGeneration.current) { loadingRef.current = false; setLoading(false); } }
  }
  useEffect(() => { setList(null); setDetail(null); setAdding(false); void load(); return () => { readGeneration.current++; }; }, [assetId, fleet]);
  const saved = (value: FleetInventoryDetail) => { setError(""); setAdding(false); setAssetId(value.asset.id); setDetail(value); setFreshRevision(n => n + 1); onSaved?.(); };
  const denied = () => { setList(null); setDetail(null); setAdding(false); setError(c.unavailable); };
  const assets = (list?.assets ?? []).filter(a => [a.name, a.manufacturer, a.model, ...a.aliases.map(x => x.value)].join(" ").toLowerCase().includes(search.toLowerCase()));
  return <View style={{ gap: 16 }}>
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>{!!assetId && <SphereBackButton accessibilityLabel={c.back} onPress={() => { setAssetId(""); setDetail(null); }} />}<Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: "700", flex: 1 }}>{detail?.asset.name ?? c.title}</Text><TogglePillButton compactOnTablet disabled={loading} onPress={() => void load()}>{c.refresh}</TogglePillButton></View>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {loading && <ActivityIndicator accessibilityLabel={c.loading} color={colors.primary} />}
    {assetId ? detail && <AssetDetail key={assetId} data={detail} freshRevision={freshRevision} onSaved={saved} onDenied={denied} /> : <>
      <Field label={c.search} value={search} onChange={setSearch} disabled={false} />
      {(list?.fleets.length ?? 0) > 0 && <View style={{ gap: 8 }}><TogglePillButton compactOnTablet solid={!fleet} onPress={() => setFleet("")}>{c.all}</TogglePillButton>{list?.fleets.map(f => <TogglePillButton compactOnTablet key={f.id} solid={fleet === f.id} onPress={() => setFleet(f.id)}>{f.name}</TogglePillButton>)}</View>}
      {list?.canManage && !adding && !error && <TogglePillButton compactOnTablet onPress={() => setAdding(true)}>{c.add}</TogglePillButton>}
      <TogglePillButton compactOnTablet onPress={openFullInventory}>{c.full}</TogglePillButton>
      {adding && list?.canManage && <AssetCreate onSaved={saved} onCancel={() => setAdding(false)} onDenied={denied} />}
      {assets.map(a => <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={a.name} onPress={() => { setAssetId(a.id); setAdding(false); }} style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 }}><Text style={{ color: colors.text, fontSize: 18, fontWeight: "700" }}>{a.name}</Text><Text style={{ color: colors.mutedForeground }}>{[a.manufacturer, a.model].filter(Boolean).join(" · ") || c[a.category as "truck" | "trailer" | "vehicle"] || a.category}</Text><Text style={{ color: colors.text }}>{a.aliases.map(alias => alias.value).join(" · ")}</Text><Text style={{ color: colors.mutedForeground }}>{a.held ? c.held : c[a.status as "available" | "checked_out"] ?? a.status}</Text></Pressable>)}
      {!loading && !error && !assets.length && <Text style={{ color: colors.text }}>{c.empty}</Text>}
      {list?.nextCursor && <TogglePillButton disabled={loading} onPress={() => { if (!loadingRef.current) void load(list.nextCursor!); }}>{c.more}</TogglePillButton>}
    </>}
  </View>;
}
function AssetCreate({ onSaved, onCancel, onDenied }: { onSaved: (detail: FleetInventoryDetail) => void; onCancel: () => void; onDenied: () => void }) {
  const c = useFleetInventoryCopy(), colors = useColors(), mutation = useMutation(onSaved, onDenied);
  const [name, setName] = useState(""), [owner, setOwner] = useState(""), [manufacturer, setManufacturer] = useState(""), [model, setModel] = useState(""), [category, setCategory] = useState("truck"), [kind, setKind] = useState("asset_tag"), [identifier, setIdentifier] = useState(""), [jurisdiction, setJurisdiction] = useState("");
  return <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: 14, gap: 12 }}>
    <Text style={{ color: colors.text }}>{c.createHint}</Text><Text style={{ color: colors.mutedForeground }}>{c.category}</Text>
    {(["truck", "trailer", "vehicle"] as const).map(value => <TogglePillButton key={value} disabled={mutation.locked} solid={category === value} accessibilityState={{ selected: category === value }} onPress={() => setCategory(value)}>{c[value]}</TogglePillButton>)}
    {([[c.name, name, setName], [c.owner, owner, setOwner], [c.manufacturer, manufacturer, setManufacturer], [c.model, model, setModel]] as const).map(([label, value, change]) => <Field key={label} label={label} value={value} onChange={change} disabled={mutation.locked} />)}
    <Text style={{ color: colors.mutedForeground }}>{c.identifierType}</Text>{(["asset_tag", "vin", "plate", "serial"] as const).map(value => <TogglePillButton key={value} disabled={mutation.locked} solid={kind === value} accessibilityState={{ selected: kind === value }} onPress={() => setKind(value)}>{c[value]}</TogglePillButton>)}
    <Field label={c.identifier} value={identifier} onChange={setIdentifier} disabled={mutation.locked} />
    {kind === "plate" && <Field label={c.jurisdiction} value={jurisdiction} onChange={setJurisdiction} disabled={mutation.locked} maxLength={32} />}
    {!!mutation.message && <Text accessibilityRole="alert" style={{ color: colors.text }}>{mutation.message}</Text>}
    <TogglePillButton disabled={mutation.busy || mutation.refused} onPress={() => void mutation.save(() => ({ path: "/api/fleet/inventory", method: "POST", body: FleetAssetCreateSchema.parse({ operationId: Crypto.randomUUID(), name, legalOwner: owner, manufacturer, model, category, identifier: { kind, value: identifier, ...(kind === "plate" && jurisdiction ? { jurisdiction } : {}) } }) }))}>{mutation.pending ? c.retry : c.save}</TogglePillButton>
    {!mutation.pending && <TogglePillButton disabled={mutation.busy} onPress={onCancel}>{c.cancel}</TogglePillButton>}
  </View>;
}
function AssetDetail({ data, freshRevision, onSaved, onDenied }: { data: FleetInventoryDetail; freshRevision: number; onSaved: (detail: FleetInventoryDetail) => void; onDenied: () => void }) {
  const c = useFleetInventoryCopy(), colors = useColors(), a = data.asset;
  const mutation = useMutation(onSaved, onDenied, freshRevision);
  const [tab, setTab] = useState<"details" | "edit" | "history">("details"), [name, setName] = useState(a.name), [manufacturer, setManufacturer] = useState(a.manufacturer), [model, setModel] = useState(a.model);
  const editable = data.canManage && !["retired", "merged"].includes(a.status);
  useEffect(() => { if (!mutation.pending) { setName(a.name); setManufacturer(a.manufacturer); setModel(a.model); } }, [a.id, a.version, freshRevision]);
  const text = { color: colors.text };
  return <View style={{ gap: 14 }}>
    <View style={{ flexDirection: "row", gap: 8 }}>{(["details", ...(editable ? ["edit" as const] : []), "history"] as const).map(value => <TogglePillButton compactOnTablet key={value} solid={tab === value} accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)}>{c[value]}</TogglePillButton>)}</View>
    {tab === "details" && <View style={{ backgroundColor: colors.card, padding: 16, borderRadius: 14, gap: 10 }}>{[[c.category, c[a.category as "truck" | "trailer" | "vehicle"] ?? a.category], [c.status, a.held ? c.held : c[a.status as "available" | "checked_out"] ?? a.status], [c.owner, a.legalOwner], [c.manufacturer, a.manufacturer || "—"], [c.model, a.model || "—"], [c.aliases, a.aliases.map(x => `${x.value}${x.jurisdiction ? ` (${x.jurisdiction})` : ""}`).join(" · ") || "—"]].map(([label, value]) => <View key={label}><Text style={{ color: colors.mutedForeground }}>{label}</Text><Text style={text}>{value}</Text></View>)}{!editable && <Text style={text}>{c.readonly}</Text>}</View>}
    {tab === "edit" && editable && <View style={{ gap: 12 }}>{([[c.name, name, setName], [c.manufacturer, manufacturer, setManufacturer], [c.model, model, setModel]] as const).map(([label, value, change]) => <Field key={label} label={label} value={value} onChange={change} disabled={mutation.locked} />)}<TogglePillButton disabled={mutation.busy || mutation.refused} onPress={() => void mutation.save(() => ({ path: `/api/fleet/inventory/${a.id}`, method: "PATCH", assetId: a.id, body: FleetAssetEditSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: a.version, name, manufacturer, model }) }))}>{mutation.pending ? c.retry : c.changes}</TogglePillButton></View>}
    {!!mutation.message && <Text accessibilityRole="alert" style={text}>{mutation.message}</Text>}
    {tab === "history" && <View style={{ gap: 12 }}>{data.historyLimited && <Text style={text}>{c.limited}</Text>}<Text accessibilityRole="header" style={text}>{c.custody}</Text>{!data.history.length && <Text style={text}>{c.noHistory}</Text>}{data.history.map(event => <View key={event.id} style={{ backgroundColor: colors.card, padding: 12, gap: 4 }}><Text style={text}>{c[event.type as "registered" | "fleet_added" | "details_updated"] ?? event.type.replaceAll("_", " ")}</Text><Text style={{ color: colors.mutedForeground }}>{new Date(event.recordedAt).toLocaleString()}</Text>{event.note && <Text style={text}>{event.note}</Text>}</View>)}<Text accessibilityRole="header" style={text}>{c.runs}</Text>{data.runs.map(run => <View key={run.id}><TogglePillButton onPress={() => router.push(`/fleet-run/${run.id}` as never)}>{run.title}</TogglePillButton><Text style={text}>{run.status.replaceAll("_", " ")}{run.ticketId ? ` · #${run.ticketId}` : ""}</Text></View>)}{!data.runs.length && <Text style={text}>{c.noRuns}</Text>}<Text accessibilityRole="header" style={text}>{c.maintenance}</Text>{data.maintenance.map(item => <View key={item.id}><Text style={text}>{item.notes}</Text><Text style={{ color: colors.mutedForeground }}>{item.status}</Text></View>)}{!data.maintenance.length && <Text style={text}>{c.noMaintenance}</Text>}</View>}
  </View>;
}
type ExistingProps = { identity: string; asset: { id: string; category: string; status: string; version: number }; onSaved: () => unknown | Promise<unknown> };
export function FleetInventoryAddExisting(props: ExistingProps) {
  const generation = useAuthGeneration();
  if (!["vehicle", "truck", "trailer"].includes(props.asset.category) || ["retired", "merged"].includes(props.asset.status)) return null;
  return <Enrollment key={`${props.identity}:${props.asset.id}:${generation}`} {...props} />;
}
function Enrollment({ asset, onSaved }: ExistingProps) {
  const c = useFleetInventoryCopy(), colors = useColors(), access = useRequestScope();
  const [canManage, setCanManage] = useState(false), [added, setAdded] = useState(false);
  const mutation = useMutation(() => { setAdded(true); void Promise.resolve().then(onSaved).catch(() => undefined); }, () => setCanManage(false), asset.version);
  useEffect(() => { void access.request("/api/fleet/inventory").then(value => { if (access.current()) setCanManage(FleetInventorySchema.parse(value).canManage); }).catch(() => { if (access.current()) setCanManage(false); }); }, []);
  if (!canManage) return null;
  return <View style={{ gap: 8 }}><TogglePillButton compactOnTablet disabled={mutation.busy || mutation.refused || added} onPress={() => void mutation.save(() => ({ path: `/api/fleet/inventory/${asset.id}/enroll`, method: "POST", assetId: asset.id, body: FleetAssetEnrollmentSchema.parse({ operationId: Crypto.randomUUID(), expectedVersion: asset.version }) }))}>{mutation.pending ? c.retry : c.enroll}</TogglePillButton>{!!mutation.message && <Text style={{ color: colors.text }}>{mutation.message}</Text>}<TogglePillButton compactOnTablet onPress={() => router.push(`/(tabs)/fleet?view=inventory&assetId=${asset.id}` as never)}>{c.title}</TogglePillButton></View>;
}
