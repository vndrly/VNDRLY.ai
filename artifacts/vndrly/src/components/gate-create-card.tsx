import GateLinkFields, { emptyGateLink, gateLinkPayload, type LinkSite } from "./gate-link-fields";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, MapPin, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";
import { forwardGeocode } from "@/lib/geocoding";
import { BrandedInput, BrandedSelect } from "./work-hub/chrome";
import { WorkspacePanel } from "./work-hub/workspace-panel";
import "./gate-dashboard.css";
import "./work-hub/site-shift-administration.css";

type Method = "gps" | "coordinates" | "address";
type EditableGate = { id: string; siteId: number; name: string; latitude: number | null; longitude: number | null; version: number };
export default function GateCreateCard() {
  const { user } = useAuth(), cache = useQueryClient();
  const { t, i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language?.startsWith("es") ? es : en;
  const [selectedSite, setSelectedSite] = useState("");
  const [link, setLink] = useState(emptyGateLink);
  const [mode, setMode] = useState<"create" | "move" | "edit">("create");
  const [editingGate, setEditingGate] = useState<EditableGate | null>(null);
  const editOperation = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<Method>("gps");
  const [latitude, setLatitude] = useState(""), [longitude, setLongitude] = useState("");
  const [address, setAddress] = useState(""), [resolvedAddress, setResolvedAddress] = useState("");
  const [busy, setBusy] = useState(false), [locating, setLocating] = useState(false);
  const [error, setError] = useState(""), [saved, setSaved] = useState("");
  const requestRevision = useRef(0), saveLock = useRef(false);
  useEffect(() => () => { requestRevision.current += 1; }, []);
  const sites = useQuery({
    queryKey: ["gate-station-management-sites", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId],
    queryFn: () => changeOverRequest<{ sites: LinkSite[] }>("/station-management/sites"),
    enabled: Boolean(user?.userId), retry: false,
  });
  const available = sites.data?.sites ?? [];
  const canManage = sites.isSuccess && available.length > 0;
  const siteId = available.find(site => String(site.id) === selectedSite)?.id ?? available[0]?.id;
  const editableGates = useQuery({
    queryKey: ["gate-station-management-gates", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, siteId],
    queryFn: () => changeOverRequest<{ stations: EditableGate[] }>(`/station-management/stations?siteId=${siteId}`),
    enabled: canManage && Boolean(siteId), retry: false, refetchOnWindowFocus: false,
  });
  const lat = Number(latitude), lng = Number(longitude);
  const validLocation = latitude.trim() !== "" && longitude.trim() !== "" && Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180;
  const editable = mode === "create" || Boolean(editingGate);
  const hasEdits = editingGate && ((mode === "edit" && name.trim() !== editingGate.name) || lat !== editingGate.latitude || lng !== editingGate.longitude);
  function clearLocation() {
    requestRevision.current += 1; setLatitude(""); setLongitude(""); setResolvedAddress(""); setLocating(false); setError(""); setSaved("");
  }
  function loadGate(gateId: string) {
    const gate = editableGates.data?.stations.find(row => row.id === gateId) ?? null;
    clearLocation(); setAddress(""); setEditingGate(gate); setName(gate?.name ?? ""); setMethod("coordinates");
    setLatitude(gate?.latitude == null ? "" : String(gate.latitude));
    setLongitude(gate?.longitude == null ? "" : String(gate.longitude));
  }
  function locate() {
    clearLocation();
    const revision = requestRevision.current;
    if (!navigator.geolocation) { setError(c("GPS is unavailable. Use Coordinates or Address.", "GPS no disponible. Use Coordenadas o Dirección.")); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (revision !== requestRevision.current) return;
      setLatitude(String(position.coords.latitude)); setLongitude(String(position.coords.longitude)); setLocating(false);
    }, () => {
      if (revision !== requestRevision.current) return;
      setLocating(false); setError(c("Could not get GPS. Use Coordinates or Address.", "No se pudo obtener GPS. Use Coordenadas o Dirección."));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }
  async function findAddress() {
    clearLocation();
    const revision = requestRevision.current;
    setLocating(true);
    const result = await forwardGeocode(address);
    if (revision !== requestRevision.current) return;
    setLocating(false);
    if (!result || Math.abs(result.latitude) > 90 || Math.abs(result.longitude) > 180) { setError(c("Address not found. Refine the address or enter coordinates.", "Dirección no encontrada. Precise la dirección o ingrese coordenadas.")); return; }
    setLatitude(String(result.latitude)); setLongitude(String(result.longitude)); setResolvedAddress(result.displayName);
  }
  async function addGate(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !siteId || !name.trim() || !validLocation || !editable || (mode !== "create" && !hasEdits) || saveLock.current || locating || !navigator.onLine || sites.isError) return;
    saveLock.current = true; setBusy(true); setError(""); setSaved("");
    try {
      const values = { siteId, name: name.trim(), location: { latitude: lat, longitude: lng }, ...(mode === "create" && link.mode !== "none" ? {link: gateLinkPayload(link)} : {}) };
      if (mode !== "create" && editingGate) {
        const fingerprint = JSON.stringify({ ...values, id: editingGate.id, expectedVersion: editingGate.version });
        if (editOperation.current?.fingerprint !== fingerprint) editOperation.current = { fingerprint, operationId: crypto.randomUUID() };
        const updated = await changeOverRequest<EditableGate>(`/stations/${editingGate.id}/location`, { ...values, expectedVersion: editingGate.version, operationId: editOperation.current.operationId });
        setEditingGate(updated);
      } else {
        await changeOverRequest("/stations", values);
        setName(""); clearLocation(); setAddress(""); setLink(emptyGateLink);
      }
      await Promise.all(["linked-gates", "gate-station-management-sites", "gate-coverage-map", "change-over-stations", "gate-site-gate-options", "change-over-history-stations", "gate-station-management-gates", "gate-locations"].map(key => cache.invalidateQueries({ queryKey: [key] })));
      setSaved(mode !== "create" ? c("Gate location saved.", "Ubicación del acceso guardada.") : c(`Gate created: ${values.name}`, `Acceso creado: ${values.name}`));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("changeOver.failed")); }
    finally { saveLock.current = false; setBusy(false); }
  }
  async function removeGate() {
    if (!canManage || mode !== "edit" || !editingGate || !siteId || saveLock.current || !navigator.onLine) return;
    saveLock.current = true; setBusy(true); setError(""); setSaved("");
    try {
      const values = { siteId, expectedVersion: editingGate.version };
      const fingerprint = JSON.stringify({ ...values, id: editingGate.id, action: "remove" });
      if (editOperation.current?.fingerprint !== fingerprint) editOperation.current = { fingerprint, operationId: crypto.randomUUID() };
      await changeOverRequest(`/stations/${editingGate.id}/retire`, { ...values, operationId: editOperation.current.operationId });
      setEditingGate(null); setName(""); setAddress(""); clearLocation();
      await Promise.all(["linked-gates", "gate-station-management-sites", "gate-coverage-map", "change-over-stations", "gate-site-gate-options", "change-over-history-stations", "gate-station-management-gates", "gate-locations"].map(key => cache.invalidateQueries({ queryKey: [key] })));
      setSaved(c("Gate removed from active use. Its history is retained.", "Acceso retirado del uso activo. Su historial se conserva."));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("changeOver.failed")); }
    finally { saveLock.current = false; setBusy(false); }
  }
  if (!canManage || !sites.isSuccess || !available.length) return null;
  return <WorkspacePanel title={c("Administrative functions", "Funciones administrativas")} subtitle={c("Create gates and edit gate locations.", "Crear accesos y editar sus ubicaciones.")} icon={Settings2}
    actions={<BrandedSelect aria-label={c("Administrative function", "Función administrativa")} value={mode} disabled={busy} onChange={event => { setMode(event.target.value as "create" | "move" | "edit"); setEditingGate(null); setName(""); setAddress(""); setMethod("gps"); clearLocation(); }}><option value="create">{c("Create Gate", "Crear acceso")}</option><option value="move">{c("Move a Gate", "Mover un acceso")}</option><option value="edit">{c("Edit a Gate", "Editar un acceso")}</option></BrandedSelect>}>
    <form onSubmit={addGate} aria-label={mode === "move" ? c("Move a Gate", "Mover un acceso") : mode === "edit" ? c("Edit a Gate", "Editar un acceso") : t("changeOver.addGate")} className="gate-administration pb-4">
      <details className="gate-panel-disclosure" open>
        <summary><ClipboardList aria-hidden="true" /><span className="flex-1">{c("Gate Details", "Detalles del acceso")}</span></summary>
        <div className="grid gap-3 pb-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm font-medium">{t("changeOver.site")}<BrandedSelect value={siteId} disabled={busy} onChange={event => { setSelectedSite(event.target.value); setLink(emptyGateLink); setEditingGate(null); if (mode !== "create") setName(""); clearLocation(); setAddress(""); }}>{available.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</BrandedSelect></label>
          {mode !== "create" && <label className="grid min-w-0 gap-1 text-sm font-medium">{c("Choose a gate", "Elegir acceso")}<BrandedSelect value={editingGate?.id ?? ""} disabled={busy || editableGates.isFetching} onChange={event => loadGate(event.target.value)}><option value="">{c("Choose a gate", "Elegir acceso")}</option>{editableGates.data?.stations.map(gate => <option key={gate.id} value={gate.id}>{gate.name}</option>)}</BrandedSelect></label>}
          <label className="grid min-w-0 gap-1 text-sm font-medium">{mode !== "create" ? c("Gate name", "Nombre del acceso") : t("changeOver.newGate")}<BrandedInput required value={name} maxLength={80} readOnly={mode === "move"} disabled={busy || !editable} onChange={event => { setName(event.target.value); setSaved(""); }} /></label>
          {mode !== "create" && editableGates.isError && <p role="alert">{c("Gates could not load. Refresh to try again.", "No se pudieron cargar los accesos. Actualice para reintentar.")}</p>}
        </div>
      </details>
      <div className="pb-3">
        <GateLinkFields value={link} onChange={value => setLink(value.mode === "new" && !value.name ? {...value,name:available.find(site => site.id === siteId)?.gateLinkName ?? available.find(site => site.id === siteId)?.name ?? ""} : value)} sites={available} siteId={siteId} partnerId={available.find(site => site.id === siteId)?.partnerId} disabled={busy}/>
        {mode !== "create" && link.mode !== "none" && <button type="button" className="gate-history-filter mt-2" disabled={busy || (link.mode === "new" ? !link.name.trim() : !link.targetSiteId)} onClick={async () => {
          setBusy(true); setError(""); try { await changeOverRequest("/site-link", {siteId,...gateLinkPayload(link)}); setLink(emptyGateLink); await Promise.all(["linked-gates","gate-station-management-sites","change-over-state"].map(key => cache.invalidateQueries({queryKey:[key]}))); setSaved(c("Parallel gates linked.","Accesos paralelos vinculados.")); } catch(e) {setError(e instanceof Error ? e.message : t("changeOver.failed"));} finally {setBusy(false);}
        }}>{c("Save link", "Guardar vínculo")}</button>}
      </div>
      <details className="gate-panel-disclosure" open>
        <summary><MapPin aria-hidden="true" /><span className="flex-1">{c("Gate Location", "Ubicación del acceso")}</span><small>{validLocation ? c("Location set", "Ubicación lista") : c("Not set", "Sin establecer")}</small></summary>
        <div className="grid gap-3 pb-3">
          <label className="grid gap-1 text-sm font-medium">{c("Set location by", "Establecer ubicación con")}<BrandedSelect value={method} disabled={busy || !editable} onChange={event => { setMethod(event.target.value as Method); clearLocation(); }}><option value="gps">{c("Current GPS", "GPS actual")}</option><option value="coordinates">{c("Latitude / Longitude", "Latitud / Longitud")}</option><option value="address">{c("Address", "Dirección")}</option></BrandedSelect></label>
          {method === "gps" && <div><button className="gate-history-filter" type="button" disabled={busy || locating || !editable} onClick={locate}>{locating ? c("Locating…", "Localizando…") : c("Use My Current Location", "Usar mi ubicación actual")}</button></div>}
          {method === "coordinates" && <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">{c("Latitude", "Latitud")}<BrandedInput type="number" step="any" min={-90} max={90} disabled={busy || !editable} value={latitude} onChange={event => { setLatitude(event.target.value); setError(""); }} /></label><label className="grid gap-1 text-sm">{c("Longitude", "Longitud")}<BrandedInput type="number" step="any" min={-180} max={180} disabled={busy || !editable} value={longitude} onChange={event => { setLongitude(event.target.value); setError(""); }} /></label></div>}
          {method === "address" && <><label className="grid gap-1 text-sm">{c("Address", "Dirección")}<BrandedInput value={address} disabled={busy || !editable} maxLength={500} onChange={event => { setAddress(event.target.value); clearLocation(); }} /></label><div><button className="gate-history-filter" type="button" disabled={busy || locating || !editable || !address.trim()} onClick={() => void findAddress()}>{locating ? c("Finding location…", "Buscando ubicación…") : c("Find Location", "Buscar ubicación")}</button></div></>}
          {validLocation && <div role="status" className="rounded-lg border border-white/10 p-2 text-sm"><strong>{c("Gate coordinates", "Coordenadas del acceso")}</strong><p>{lat.toFixed(6)}, {lng.toFixed(6)}</p>{resolvedAddress && <p className="text-xs text-muted-foreground">{resolvedAddress}</p>}</div>}
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
        {mode === "edit" && <button type="button" className="gate-history-filter" disabled={busy || locating || !editingGate || !navigator.onLine} onClick={() => void removeGate()}>{c("Remove Gate", "Retirar acceso")}</button>}
        <button className="gate-history-filter ml-auto" type="submit" disabled={busy || locating || !editable || (mode !== "create" && !hasEdits) || !siteId || !name.trim() || !validLocation || !navigator.onLine}>{busy ? c("Saving…", "Guardando…") : mode === "move" ? c("Save Moved Gate Locations", "Guardar ubicaciones modificadas") : mode === "edit" ? c("Save Gate Changes", "Guardar cambios del acceso") : t("changeOver.addGate")}</button>
      </div>
      {error && <p role="alert" className="pt-2 text-sm text-red-400">{error}</p>}
      {saved && <p role="status" className="pt-2 text-sm text-green-400">{saved}</p>}
    </form>
  </WorkspacePanel>;
}
