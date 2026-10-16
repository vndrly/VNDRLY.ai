import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Truck, Container, Plus, Search } from "lucide-react";
import { FleetAssetCreateSchema, FleetAssetEditSchema, type FleetInventoryDetail } from "@workspace/api-zod";
import { fleetClient, FleetRequestError } from "@/lib/fleet-client";
import { PngPillButton } from "./png-pill-rollover";
import PageBackButton from "./page-back-button";
import ImagePill from "./image-pill";
import {FleetDetailsLibrary} from "./fleet-details-library";
import "@/pages/fleet.css";

const en = {
  title: "Inventory and Details", subtitle: "Trucks, trailers and service/support vehicles available for ticketed work.", add: "Add Fleet Asset", full: "Full Inventory", back: "Back", refresh: "Refresh", search: "Search fleet assets", fleet: "Detail", all: "All Details", empty: "No fleet assets in this view.",
  name: "Asset name / unit number", type: "Asset type", truck: "Truck / transport rig", trailer: "Trailer", dolly: "Dolly", tank: "Tank", pump: "Pump", accessory: "Accessory", vehicle: "Service / support vehicle", owner: "Legal owner", make: "Manufacturer", model: "Model", identifier: "Identifier", identifierType: "Identifier type", jurisdiction: "Plate state / jurisdiction", save: "Save Fleet Asset", retry: "Retry save", cancel: "Cancel", createHint: "Add this asset to Fleet Inventory.", addExisting: "Add an existing Inventory asset", details: "Details", edit: "Edit", history: "History", hold: "On hold", available: "Available", checkedOut: "Checked out", more: "Load more fleet assets", loading: "Loading Fleet Inventory…", unavailable: "Fleet Inventory could not be loaded. Refresh to check current access.", saveError: "Save was not confirmed. Retry the same save to check its result.", versionError: "This record changed. Refresh before preparing a new save.", identifierError: "That identifier is already registered. Add the existing asset from Full Inventory.", required: "Complete the required fields.", noHistory: "No history has been recorded for this asset.", runs: "Run history", maintenance: "Maintenance history", custody: "Asset history", limited: "Showing the latest 100 records in each history group.", noRuns: "No authorized runs are recorded for this asset.", noMaintenance: "No maintenance records are recorded for this asset.", saveChanges: "Save changes", readonly: "This asset is read-only.", fleetAdded: "Added to Fleet Inventory", fleetRegistered: "Registered in Inventory and Fleet Inventory", updated: "Asset details updated", beforeAfter: "Recorded changes", category: "Type", status: "Status", aliases: "Identifiers", fleetMembership: "Fleet assignment", open: "Open asset", physical: "Holds and custody are shown on the asset record.",
} as const;
const es: Record<keyof typeof en, string> = {
  title: "Inventario y destacamentos", subtitle: "Camiones, remolques y vehículos de apoyo para trabajos con ticket.", add: "Agregar activo de flota", full: "Inventario completo", back: "Atrás", refresh: "Actualizar", search: "Buscar activos de flota", fleet: "Destacamento", all: "Todos los destacamentos", empty: "No hay activos de flota en esta vista.", name: "Nombre del activo / número de unidad", type: "Tipo de activo", truck: "Camión / equipo de transporte", trailer: "Remolque", dolly: "Dolly", tank: "Tanque", pump: "Bomba", accessory: "Accesorio", vehicle: "Vehículo de servicio / apoyo", owner: "Propietario legal", make: "Fabricante", model: "Modelo", identifier: "Identificador", identifierType: "Tipo de identificador", jurisdiction: "Estado / jurisdicción de la placa", save: "Guardar activo de flota", retry: "Reintentar guardado", cancel: "Cancelar", createHint: "Agregue este activo al Inventario de flota.", addExisting: "Agregar un activo del Inventario existente", details: "Detalles", edit: "Editar", history: "Historial", hold: "Retenido", available: "Disponible", checkedOut: "Asignado", more: "Cargar más activos de flota", loading: "Cargando inventario de flota…", unavailable: "No se pudo cargar el inventario de flota. Actualice para comprobar el acceso.", saveError: "No se confirmó el guardado. Reintente el mismo guardado para comprobar el resultado.", versionError: "Este registro cambió. Actualice antes de preparar un nuevo guardado.", identifierError: "Ese identificador ya está registrado. Agregue el activo desde el Inventario completo.", required: "Complete los campos obligatorios.", noHistory: "No hay historial registrado para este activo.", runs: "Historial de recorridos", maintenance: "Historial de mantenimiento", custody: "Historial del activo", limited: "Se muestran los últimos 100 registros de cada grupo.", noRuns: "No hay recorridos autorizados registrados para este activo.", noMaintenance: "No hay mantenimiento registrado para este activo.", saveChanges: "Guardar cambios", readonly: "Este activo es de solo lectura.", fleetAdded: "Agregado al inventario de flota", fleetRegistered: "Registrado en Inventario e Inventario de flota", updated: "Detalles del activo actualizados", beforeAfter: "Cambios registrados", category: "Tipo", status: "Estado", aliases: "Identificadores", fleetMembership: "Asignación de flota", open: "Abrir activo", physical: "Las retenciones y la custodia se muestran en el registro del activo.",
};
function useCopy() { const { i18n } = useTranslation(); return { c: i18n.language.startsWith("es") ? es : en, language: i18n.language }; }
function useAlive() { const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); return alive; }
function failure(error: unknown, c: typeof es) {
  return error instanceof FleetRequestError && error.code === "fleet.version_conflict" ? c.versionError : error instanceof FleetRequestError && error.code === "fleet.identifier_in_use" ? c.identifierError : c.saveError;
}
const inputClass = "w-full px-3 py-2";
export function FleetInventoryPage({ identity, assetId }: { identity: string; assetId?: string }) {
  const { c } = useCopy(), [, navigate] = useLocation(), queryClient = useQueryClient();
  const [fleet, setFleet] = useState(""), [search, setSearch] = useState(""), [adding, setAdding] = useState(false),[showDetails,setShowDetails]=useState(false);
  const list = useInfiniteQuery({ queryKey: ["fleet-inventory", identity, fleet], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => fleetClient.inventory(pageParam, fleet || undefined), getNextPageParam: p => p.nextCursor ?? undefined, retry: false, enabled: !assetId });
  const detail = useQuery({ queryKey: ["fleet-inventory-detail", identity, assetId], queryFn: () => fleetClient.inventoryAsset(assetId!), enabled: Boolean(assetId), retry: false });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["fleet-inventory", identity] }), queryClient.invalidateQueries({ queryKey: ["fleet-inventory-detail", identity] }), queryClient.invalidateQueries({ queryKey: ["fleet", identity] }), queryClient.invalidateQueries({ queryKey: ["fleet-resources", identity] }), queryClient.invalidateQueries({ queryKey: ["implementation-a", "assets"] })]); };
  const current = list.data?.pages[0];
  const assets = [...new Map(list.data?.pages.flatMap(p => p.assets).map(a => [a.id, a]) ?? []).values()].filter(a => [a.name, a.manufacturer, a.model, ...a.aliases.map(x => x.value)].join(" ").toLowerCase().includes(search.toLowerCase()));
  return <main className="fleet-workspace fleet-inventory space-y-5 p-4 md:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><PageBackButton fallbackHref={assetId ? "/fleet/equipment" : "/fleet"} ariaLabel={c.back} /><div><h1 className="text-2xl font-semibold">{assetId && detail.data ? detail.data.asset.name : c.title}</h1><p className="text-sm text-muted-foreground">{c.subtitle}</p></div></div><PngPillButton onClick={() => void refresh()}>{c.refresh}</PngPillButton></header>
    {!assetId&&<div role="group" aria-label="Inventory and Details"><PngPillButton onClick={()=>setShowDetails(false)}>Inventory</PngPillButton><PngPillButton onClick={()=>setShowDetails(true)}>Details</PngPillButton></div>}
    {!assetId&&showDetails?<FleetDetailsLibrary identity={identity}/>:assetId ? <>
      {detail.isPending && <p>{c.loading}</p>}
      {detail.isError && <p role="alert">{c.unavailable}</p>}
      {detail.data && !detail.isError && <FleetAssetDetail key={`${assetId}:${detail.data.asset.version}`} data={detail.data} identity={identity} onSaved={refresh} />}
    </> : <>
      <div className="fleet-filters flex flex-wrap items-center gap-3"><label>{c.fleet}<select aria-label={c.fleet} className={inputClass} value={fleet} onChange={e => { setFleet(e.target.value); setAdding(false); }}><option value="">{c.all}</option>{current?.fleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label className="grow"><span className="flex items-center gap-2"><Search size={15} />{c.search}</span><input className={inputClass} aria-label={c.search} value={search} onChange={e => setSearch(e.target.value)} /></label>{current?.canManage && !list.isError && <PngPillButton onClick={() => setAdding(true)}><Plus size={14} />{c.add}</PngPillButton>}<Link href="/work-hub/inventory">{c.full}</Link></div>
      {adding && current?.canManage && !list.isError && <FleetAssetCreateForm key={identity + fleet} onCancel={() => setAdding(false)} onSaved={async id => { await refresh(); navigate(`/fleet/equipment/${id}`); }} />}
      {list.isPending && <p>{c.loading}</p>}
      {list.isError && <p role="alert">{c.unavailable}</p>}
      {!list.isPending && !list.isError && <div className="fleet-asset-grid">{assets.map(asset => <Link key={asset.id} href={`/fleet/equipment/${asset.id}`} className="fleet-asset-card" aria-label={`${c.open}: ${asset.name}`}><span className="fleet-asset-icon">{asset.category === "trailer" ? <Container size={30} /> : <Truck size={30} />}</span><span className="space-y-2 min-w-0"><strong>{asset.name}</strong><small>{[asset.manufacturer, asset.model].filter(Boolean).join(" · ") || c[asset.category as "truck" | "trailer" | "vehicle"] || asset.category}</small><small>{asset.aliases.map(a => a.value).join(" · ")}</small><small>{current?.fleets.filter(f => asset.fleetIds.includes(f.id)).map(f => f.name).join(", ")}</small><ImagePill color={asset.held ? "amber" : asset.status === "available" ? "green" : "grey"}>{asset.held ? c.hold : asset.status === "available" ? c.available : asset.status === "checked_out" ? c.checkedOut : asset.status}</ImagePill></span><span aria-hidden="true">›</span></Link>)}</div>}
      {!list.isPending && !list.isError && !assets.length && <section><p>{c.empty}</p></section>}
      {list.hasNextPage && <PngPillButton disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{c.more}</PngPillButton>}
    </>}
  </main>;
}
function FleetAssetCreateForm({ onSaved, onCancel }: { onSaved: (id: string) => Promise<void>; onCancel: () => void }) {
  const { c } = useCopy(), alive = useAlive();
  const [name, setName] = useState(""), [category, setCategory] = useState("truck"), [owner, setOwner] = useState(""), [make, setMake] = useState(""), [model, setModel] = useState(""), [kind, setKind] = useState("asset_tag"), [identifier, setIdentifier] = useState(""), [jurisdiction, setJurisdiction] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const attempt = useRef<ReturnType<typeof FleetAssetCreateSchema.parse> | null>(null);
  async function save() {
    if (busy) return;
    try { attempt.current ??= FleetAssetCreateSchema.parse({ operationId: crypto.randomUUID(), name, category, legalOwner: owner, manufacturer: make, model, identifier: { kind, value: identifier, ...(kind === "plate" && jurisdiction ? { jurisdiction } : {}) } }); }
    catch { setMessage(c.required); return; }
    setBusy(true); setMessage("");
    try { const receipt = await fleetClient.createAsset(attempt.current); if (alive.current) await onSaved(receipt.assetId); }
    catch (e) { if (alive.current) { setMessage(failure(e, c)); if (e instanceof FleetRequestError && e.status < 500) attempt.current = null; } }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="space-y-4"><h2>{c.add}</h2><p>{c.createHint}</p><fieldset disabled={busy || Boolean(attempt.current)} className="fleet-asset-fields">
    <label>{c.type}<select className={inputClass} value={category} onChange={e => setCategory(e.target.value)}>{(["truck", "trailer", "vehicle", "dolly", "tank", "pump", "accessory"] as const).map(v => <option key={v} value={v}>{c[v]}</option>)}</select></label>
    {[[c.name, name, setName], [c.owner, owner, setOwner], [c.make, make, setMake], [c.model, model, setModel]].map(([label, value, set]) => <label key={String(label)}>{String(label)}<input className={inputClass} value={String(value)} onChange={e => (set as (v: string) => void)(e.target.value)} /></label>)}
    <label>{c.identifierType}<select className={inputClass} value={kind} onChange={e => setKind(e.target.value)}>{["asset_tag", "vin", "plate", "serial"].map(v => <option key={v} value={v}>{v === "vin" ? "VIN" : v === "asset_tag" ? "Unit / asset tag" : v === "plate" ? "License plate" : "Serial number"}</option>)}</select></label><label>{c.identifier}<input className={inputClass} value={identifier} onChange={e => setIdentifier(e.target.value)} /></label>
    {kind === "plate" && <label>{c.jurisdiction}<input className={inputClass} value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} /></label>}
  </fieldset>{message && <p role="alert">{message}</p>}<div className="flex flex-wrap gap-3"><PngPillButton disabled={busy} onClick={() => void save()}>{attempt.current ? c.retry : c.save}</PngPillButton>{!attempt.current && <PngPillButton disabled={busy} onClick={onCancel}>{c.cancel}</PngPillButton>}<Link href="/work-hub/inventory">{c.addExisting}</Link></div></section>;
}
function FleetAssetDetail({ data, identity, onSaved }: { data: FleetInventoryDetail; identity: string; onSaved: () => Promise<void> }) {
  const { c, language } = useCopy(), alive = useAlive(), a = data.asset;
  const [tab, setTab] = useState<"details" | "edit" | "history">("details"), [name, setName] = useState(a.name), [make, setMake] = useState(a.manufacturer), [model, setModel] = useState(a.model), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const attempt = useRef<ReturnType<typeof FleetAssetEditSchema.parse> | null>(null);
  const editable = data.canManage && !["retired", "merged"].includes(a.status);
  async function save() {
    if (busy) return;
    try { attempt.current ??= FleetAssetEditSchema.parse({ operationId: crypto.randomUUID(), expectedVersion: a.version, name, manufacturer: make, model }); } catch { setMessage(c.required); return; }
    setBusy(true); setMessage("");
    try { await fleetClient.editAsset(a.id, attempt.current); if (alive.current) await onSaved(); }
    catch (e) { if (alive.current) { setMessage(failure(e, c)); if (e instanceof FleetRequestError && e.status < 500) attempt.current = null; } }
    finally { if (alive.current) setBusy(false); }
  }
  const typeName = (value: string) => ({ registered: c.fleetRegistered, fleet_added: c.fleetAdded, details_updated: c.updated }[value] ?? value.replaceAll("_", " "));
  return <section className="space-y-4"><div role="tablist" aria-label={c.title} className="flex gap-4">{(["details", ...(editable ? ["edit" as const] : []), "history"] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t as typeof tab)} className="fleet-asset-tab">{c[t as "details" | "edit" | "history"]}</button>)}</div>
    {tab === "details" && <div className="space-y-3"><dl className="fleet-asset-fields">{[[c.category, c[a.category as "truck" | "trailer" | "vehicle"] || a.category], [c.status, a.held ? c.hold : a.status === "available" ? c.available : a.status === "checked_out" ? c.checkedOut : a.status], [c.owner, a.legalOwner], [c.make, a.manufacturer || "—"], [c.model, a.model || "—"], [c.aliases, a.aliases.map(x => `${x.value}${x.jurisdiction ? ` (${x.jurisdiction})` : ""}`).join(" · ") || "—"]].map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl><p className="text-sm text-muted-foreground">{c.physical}</p>{!editable && <p>{c.readonly}</p>}</div>}
    {tab === "edit" && editable && <div className="space-y-4"><fieldset disabled={busy || Boolean(attempt.current)} className="fleet-asset-fields">{[[c.name, name, setName], [c.make, make, setMake], [c.model, model, setModel]].map(([label, value, set]) => <label key={String(label)}>{String(label)}<input className={inputClass} value={String(value)} onChange={e => (set as (v: string) => void)(e.target.value)} /></label>)}</fieldset>{message && <p role="alert">{message}</p>}<PngPillButton disabled={busy} onClick={() => void save()}>{attempt.current ? c.retry : c.saveChanges}</PngPillButton></div>}
    {tab === "history" && <div className="space-y-5">{data.historyLimited && <p>{c.limited}</p>}<div><h3>{c.custody}</h3>{!data.history.length && <p>{c.noHistory}</p>}<ol className="space-y-3">{data.history.map(e => <li key={e.id} className="fleet-asset-history"><strong>{typeName(e.type)}</strong><small>{new Date(e.recordedAt).toLocaleString(language)}</small>{e.note && <p className="whitespace-pre-wrap break-words">{e.type === "details_updated" ? c.beforeAfter + ": " + e.note : e.note}</p>}</li>)}</ol></div><div><h3>{c.runs}</h3>{data.runs.map(r => <Link className="fleet-asset-history" key={r.id} href={`/fleet/runs/${r.id}`}><strong>{r.title}</strong><span>{r.status.replaceAll("_", " ")}{r.ticketId ? ` · #${r.ticketId}` : ""}</span></Link>)}{!data.runs.length && <p>{c.noRuns}</p>}</div><div><h3>{c.maintenance}</h3>{data.maintenance.map(m => <Link key={m.id} href="/fleet/maintenance" className="fleet-asset-history"><strong>{m.notes}</strong><span>{m.status}</span></Link>)}{!data.maintenance.length && <p>{c.noMaintenance}</p>}</div></div>}
  </section>;
}

/** The full Inventory surface offers the same explicit fleet inclusion action. */
export function FleetInventoryAddExisting({ identity, asset, onSaved }: { identity: string; asset: { id: string; version: number; category: string; status: string }; onSaved: () => Promise<unknown> }) {
  const { c } = useCopy(), alive = useAlive(), queryClient = useQueryClient();
  const current = useQuery({ queryKey: ["fleet-inventory-enrollment", identity], queryFn: () => fleetClient.inventory(), retry: false, staleTime: 30_000 });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const attempt = useRef<{ operationId: string; expectedVersion: number } | null>(null);
  const data = current.data;
  if (!data?.canManage || current.isError || !["vehicle", "truck", "trailer"].includes(asset.category) || ["retired", "merged"].includes(asset.status)) return null;
  async function save() {
    if (!data || busy) return;
    attempt.current ??= { operationId: crypto.randomUUID(), expectedVersion: asset.version };
    setBusy(true); setMessage("");
    try {
      await fleetClient.enrollAsset(asset.id, attempt.current);
      if (!alive.current) return;
      await Promise.all([onSaved(), queryClient.invalidateQueries({ queryKey: ["fleet-inventory-enrollment", identity] }), queryClient.invalidateQueries({ queryKey: ["fleet-inventory", identity] }), queryClient.invalidateQueries({ queryKey: ["fleet", identity] }), queryClient.invalidateQueries({ queryKey: ["fleet-resources", identity] })]);
      if (!alive.current) return;
      attempt.current = null; setMessage(c.fleetAdded);
    } catch (e) { if (alive.current) { setMessage(failure(e, c)); if (e instanceof FleetRequestError && e.status < 500) attempt.current = null; } }
    finally { if (alive.current) setBusy(false); }
  }
  return <div className="space-y-2"><PngPillButton disabled={busy} onClick={() => void save()}>{attempt.current ? c.retry : c.add}</PngPillButton>{message && <p role="status">{message}</p>}<Link href={`/fleet/equipment/${asset.id}`}>{c.title}</Link></div>;
}
