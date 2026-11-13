import { gateLocationLabel, partnerSiteLabel } from "@/lib/warwick-gate-label";
import GateLinkFields, { emptyGateLink, gateLinkPayload, type LinkSite } from "./gate-link-fields";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
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
import { useCardNextSteps } from "./card-next-steps";
import { PngPillButton as TogglePillButton } from "./png-pill-rollover";
import type { PhysicalGate } from './gate-area-traffic';

type Method = "gps" | "coordinates" | "address";
type EditableGate = PhysicalGate;
const independent = {kind:'independent' as const,area:'',parentGateId:null,parallelGateId:null};
export default function GateCreateCard({initialLocation,initialGateId,initialSiteId,onSaved,allowedSiteIds,nextStepsContainer}:{nextStepsContainer?:HTMLElement|null;allowedSiteIds?:number[];initialLocation?:{latitude:number;longitude:number};initialGateId?:string;initialSiteId?:number;onSaved?:()=>void}={}) {
  const { user } = useAuth(), cache = useQueryClient();
  const { t, i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language?.startsWith("es") ? es : en;
  const [selectedSite, setSelectedSite] = useState(initialSiteId?String(initialSiteId):"");
  const [topology,setTopology]=useState<NonNullable<PhysicalGate['topology']>>(independent);
  const [link, setLink] = useState(emptyGateLink);
  const [helpRemoval, setHelpRemoval] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">(initialGateId?'edit':'create');
  const [editingGate, setEditingGate] = useState<EditableGate | null>(null);
  const editOperation = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<Method>("gps");
  const [latitude, setLatitude] = useState(""), [longitude, setLongitude] = useState("");
  const [address, setAddress] = useState(""), [resolvedAddress, setResolvedAddress] = useState("");
  const [busy, setBusy] = useState(false), [locating, setLocating] = useState(false);
  const [removeRequested, setRemoveRequested] = useState(false);
  const [error, setError] = useState(""), [saved, setSaved] = useState("");
  const requestRevision = useRef(0), saveLock = useRef(false);
  useEffect(() => () => { requestRevision.current += 1; }, []);
  const sites = useQuery({
    queryKey: ["gate-station-management-sites", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId],
    queryFn: () => changeOverRequest<{ sites: LinkSite[] }>("/station-management/sites"),
    enabled: Boolean(user?.userId), retry: false,
  });
  const isMidCon = user?.vendorId === 1054;
  const available = (sites.data?.sites ?? []).filter(site => !allowedSiteIds || allowedSiteIds.includes(site.id)).filter(site => !isMidCon || site.id === 411 ||
    /^(?:Warwick )?(?:Cactus 152|Precision 550)$/.test(site.name));
  const siteLabel = (site: LinkSite) => !isMidCon ? partnerSiteLabel(site) : site.id === 411
    ? "Warwick San Roman Completions"
    : site.name.startsWith("Warwick ") ? site.name : `Warwick ${site.name}`;
  const canManage = sites.isSuccess && available.length > 0;
  const siteId = available.find(site => String(site.id) === selectedSite)?.id ?? available[0]?.id;
  const editableGates = useQuery({
    queryKey: ["gate-station-management-gates", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, siteId],
    queryFn: () => changeOverRequest<{ stations: EditableGate[] }>(`/station-management/stations?siteId=${siteId}`),
    enabled: canManage && Boolean(siteId), retry: false, refetchOnWindowFocus: false,
  });
  const stations = editableGates.data?.stations ?? [];
  const gateLabel = (gate: EditableGate) => gateLocationLabel(available.find(site => site.id === siteId) ?? { name: "" }, { ...gate, siteId: siteId! },
    stations.map(station => ({ ...station, siteId: siteId! }))) ?? gate.name;
  useEffect(()=>{if(initialGateId&&editableGates.data&&!editingGate)loadGate(initialGateId);else if(initialLocation&&!initialGateId){setMethod('coordinates');setLatitude(String(initialLocation.latitude));setLongitude(String(initialLocation.longitude));}},[initialGateId,editableGates.data,initialLocation?.latitude,initialLocation?.longitude]);
  const lat = Number(latitude), lng = Number(longitude);
  const validLocation = latitude.trim() !== "" && longitude.trim() !== "" && Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180;
  const editable = mode === "create" || Boolean(editingGate);
  const hasEdits = editingGate && ((mode === "edit" && name.trim() !== editingGate.name) || lat !== editingGate.latitude || lng !== editingGate.longitude);
  function clearLocation() {
    requestRevision.current += 1; setLatitude(""); setLongitude(""); setResolvedAddress(""); setLocating(false); setError(""); setSaved("");
  }
  function loadGate(gateId: string) {
    const gate = stations.find(row => row.id === gateId) ?? null;
    setRemoveRequested(false); clearLocation(); setAddress(""); setEditingGate(gate); setName(gate?.name ?? ""); setMethod("coordinates");
    setTopology(gate?.topology??independent);
    setLatitude(initialLocation?String(initialLocation.latitude):gate?.latitude == null ? "" : String(gate.latitude));
    setLongitude(initialLocation?String(initialLocation.longitude):gate?.longitude == null ? "" : String(gate.longitude));
  }
  type Destination = NonNullable<NonNullable<PhysicalGate['topology']>['destinations']>[number];
  const [destinationDraft, setDestinationDraft] = useState<Destination | null>(null);
  const [openDestinationId, setOpenDestinationId] = useState<string | null>(null);
  useEffect(() => { setDestinationDraft(null); setOpenDestinationId(null); }, [siteId, mode, editingGate?.id]);
  const [locatingDestination, setLocatingDestination] = useState<string | null>(null);
  function locateDestination(id: string) {
    if (!navigator.geolocation) { setError(c("GPS is unavailable.", "GPS no disponible.")); return; }
    const revision = requestRevision.current;
    setLocatingDestination(id); setError("");
    navigator.geolocation.getCurrentPosition(position => {
      setLocatingDestination(null);
      if (revision !== requestRevision.current) return;
      setDestinationDraft(current => current?.id === id ? {...current, latitude: position.coords.latitude, longitude: position.coords.longitude} : current);
      setTopology(current => ({...current, destinations: current.destinations?.map(destination => destination.id === id ? {...destination, gateId: null, latitude: position.coords.latitude, longitude: position.coords.longitude} : destination)}));
      setSaved("");
    }, () => {
      setLocatingDestination(null);
      if (revision === requestRevision.current) setError(c("Could not get destination GPS. Try again.", "No se pudo obtener la ubicación del destino. Intente de nuevo."));
    }, {enableHighAccuracy: true, timeout: 15000, maximumAge: 0});
  }
  function locate() {
    clearLocation();
    const revision = requestRevision.current;
    if (!navigator.geolocation) { setError(c("GPS is unavailable. Use Coordinates or Address.", "GPS no disponible. Use Coordenadas o Dirección.")); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (revision !== requestRevision.current) return;
      setLatitude(String(position.coords.latitude)); setLongitude(String(position.coords.longitude)); setMethod("coordinates"); setLocating(false);
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
    if (!canManage || !siteId || !name.trim() || !validLocation || !editable || (mode !== "create" && !hasEdits) || saveLock.current || locating || locatingDestination !== null || !navigator.onLine || sites.isError) return;
    saveLock.current = true; setBusy(true); setError(""); setSaved("");
    try {
      const values = { siteId, name: name.trim(), location: { latitude: lat, longitude: lng }, ...(mode === "create" ? {topology}:{}), ...(mode === "create" && link.mode !== "none" ? {link: gateLinkPayload(link)} : {}) };
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
      onSaved?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("changeOver.failed")); }
    finally { saveLock.current = false; setBusy(false); }
  }
  async function saveGateName() {
    if (!editingGate || !name.trim() || name.trim() === editingGate.name || saveLock.current || !navigator.onLine) return;
    saveLock.current = true; setBusy(true); setError(""); setSaved("");
    try {
      const values = {siteId, name:name.trim(), expectedVersion:editingGate.version};
      const fingerprint = JSON.stringify({...values, id:editingGate.id, action:"rename"});
      if (editOperation.current?.fingerprint !== fingerprint) editOperation.current = {fingerprint, operationId:crypto.randomUUID()};
      const updated = await changeOverRequest<EditableGate>(`/stations/${editingGate.id}/name`, {...values, operationId:editOperation.current.operationId});
      setEditingGate(current => current ? {...current, name:updated.name, version:updated.version} : current);
      await Promise.all(["gate-station-management-gates", "gate-coverage-map", "change-over-stations", "gate-site-gate-options", "change-over-history-stations", "gate-locations", "gate-area-traffic"].map(key => cache.invalidateQueries({queryKey:[key]})));
      setSaved(c("Gate name saved.", "Nombre del acceso guardado."));
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
      setRemoveRequested(false); setEditingGate(null); setName(""); setAddress(""); clearLocation();
      await Promise.all(["linked-gates", "gate-station-management-sites", "gate-coverage-map", "change-over-stations", "gate-site-gate-options", "change-over-history-stations", "gate-station-management-gates", "gate-locations"].map(key => cache.invalidateQueries({ queryKey: [key] })));
      onSaved?.();
      setSaved(c("Gate removed from active use. Its history is retained.", "Acceso retirado del uso activo. Su historial se conserva."));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("changeOver.failed")); }
    finally { saveLock.current = false; setBusy(false); }
  }
  const guide = useCardNextSteps({
    choices: [
      { id: "create", title: c("Create a gate", "Crear un acceso"), prepare: () => { if (busy || locating) return; setHelpRemoval(false); if (mode !== "create") { setEditingGate(null); setName(""); setAddress(""); clearLocation(); } setMode("create"); setRemoveRequested(false); } },
      { id: "edit", title: c("Edit or move a gate", "Editar o mover un acceso"), prepare: () => { if (busy || locating) return; setHelpRemoval(false); setMode("edit"); setRemoveRequested(false); } },
      { id: "remove", title: c("Remove a gate", "Retirar un acceso"), prepare: () => { if (busy || locating) return; setHelpRemoval(true); setMode("edit"); setRemoveRequested(false); } },
    ],
    card: "gate-administration", task: removeRequested || helpRemoval ? "remove" : mode, enabled: canManage,
    title: removeRequested || helpRemoval ? c("Remove a gate", "Retirar un acceso") : mode === "create" ? c("Create a gate", "Crear un acceso") : c("Edit or move a gate", "Editar o mover un acceso"),
    steps: removeRequested || helpRemoval ? [c("Choose the authorized site and existing gate. Use Remove Gate to open its confirmation; selecting help does not remove anything.", "Elija sitio y acceso. Retirar acceso abre su confirmación; la ayuda no retira nada."),c("Check the selected gate name before confirming removal.", "Revise el nombre del acceso antes de confirmar."), c("Confirm Remove Gate retires it from active use; existing history is retained. Cancel leaves it unchanged.", "Confirmar retira el acceso del uso activo y conserva su historial. Cancelar no lo cambia.")] : [
      c("Choose the authorized site. For Edit Gate, choose the existing gate to load its saved details.", "Elija el sitio autorizado. Para editar, elija el acceso existente para cargar sus datos."),
      c("Use the exact gate name. To move it, change Gate Location using GPS, coordinates, or a resolved address.", "Use el nombre exacto. Para moverlo, cambie Ubicación con GPS, coordenadas o una dirección resuelta."),
      c("Relationship and destinations use Save relationship when editing. Traffic-sharing links use Save link. These are separate saves.", "Al editar, relaciones y destinos usan Guardar relación; los vínculos usan Guardar vínculo. Son guardados separados."),
      c("Review the name and coordinates, then save. Selecting a gate alone is not a change. Wait for the saved result; errors do not mean success.", "Revise nombre y coordenadas y guarde. Elegir un acceso no es un cambio. Espere la confirmación; un error no significa éxito."),
      c("To remove a selected gate, use Remove Gate and review the confirmation. This retains history.", "Para retirar un acceso elegido, use Retirar acceso y revise la confirmación. Se conserva el historial."),
    ],
    target: busy || locating || error || saved ? null : removeRequested ? "confirm-remove" : mode === "edit" && !editingGate ? "choose-gate" : helpRemoval ? "remove-gate" : !name.trim() ? "gate-name" : !validLocation ? "location-method" : mode === "create" || hasEdits ? "save-gate" : "gate-name",
    prompt: error || (busy ? c("Saving. Wait for the server result.", "Guardando. Espere el resultado del servidor.") : saved) || (removeRequested ? c(`Review removal of ${editingGate?.name ?? ""}. Nothing changes until you confirm.`, `Revise el retiro de ${editingGate?.name ?? ""}. Nada cambia hasta confirmar.`) : mode === "edit" && !editingGate ? c("Choose the gate you want to edit.", "Elija el acceso que desea editar.") : helpRemoval && editingGate ? c("Use Remove Gate to review the confirmation. Nothing is removed until you confirm.", "Use Retirar acceso para revisar la confirmación. Nada se retira hasta confirmar.") : !name.trim() ? c("Enter the exact gate name.", "Ingrese el nombre exacto del acceso.") : !validLocation ? c("Set a valid location. GPS uses your device’s current position; Address requires Find Location.", "Establezca una ubicación válida. GPS usa su posición actual; Dirección requiere Buscar ubicación.") : mode === "edit" && !hasEdits ? c("Gate loaded. Change the name or location to enable Save Gate Changes. Relationship and link changes have their own save buttons.", "Acceso cargado. Cambie nombre o ubicación para habilitar Guardar. Relaciones y vínculos tienen sus propios botones.") : c("Review the name and location, then use the save button.", "Revise nombre y ubicación y use el botón Guardar.")),
  });
  if (!canManage || !sites.isSuccess || !available.length) return null;
  return <WorkspacePanel className="gate-administration-card" title={c("Administrative functions", "Funciones administrativas")} subtitle={c("Create gates and edit gate locations.", "Crear accesos y editar sus ubicaciones.")} icon={Settings2}
    actions={<div className="flex items-center gap-2">{nextStepsContainer ? createPortal(<button type="button" className="gate-history-filter" onClick={() => guide.begin(true)}>Next Steps</button>, nextStepsContainer) : <button type="button" className="gate-history-filter" onClick={() => guide.begin(true)}>Next Steps</button>}<BrandedSelect aria-label={c("Administrative function", "Función administrativa")} value={mode} disabled={busy} onChange={event => { setHelpRemoval(false); setRemoveRequested(false); setMode(event.target.value as "create" | "edit"); setEditingGate(null); setName(""); setAddress(""); setMethod("gps"); clearLocation(); }}><option value="create">{c("Create Gate", "Crear acceso")}</option><option value="edit">{c("Edit a Gate", "Editar un acceso")}</option></BrandedSelect></div>}>
    <form data-guidance-scope={guide.scopeId} onFocusCapture={() => guide.begin()} onSubmit={addGate} aria-label={mode === "edit" ? c("Edit a Gate", "Editar un acceso") : t("changeOver.addGate")} className="gate-administration pb-4">
      <section className="gate-panel-disclosure">
        <h3 className="gate-administration-section-title"><ClipboardList aria-hidden="true" /><span>{c("Gate Details", "Detalles del acceso")}</span></h3>
        <div className="grid gap-3 pb-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm font-medium">{t("changeOver.site")}<BrandedSelect value={siteId} disabled={busy} onChange={event => { setRemoveRequested(false); setSelectedSite(event.target.value); setLink(emptyGateLink); setEditingGate(null); if (mode !== "create") setName(""); clearLocation(); setAddress(""); }}>{available.map(site => <option key={site.id} value={site.id}>{siteLabel(site)}</option>)}</BrandedSelect></label>
          {mode !== "create" && <label className="grid min-w-0 gap-1 text-sm font-medium">{c("Choose a gate", "Elegir acceso")}<BrandedSelect data-guidance-id="choose-gate" value={editingGate?.id ?? ""} disabled={busy || editableGates.isFetching} onChange={event => loadGate(event.target.value)}><option value="">{c("Choose a gate", "Elegir acceso")}</option>{stations.map(gate => <option key={gate.id} value={gate.id}>{gate.name}</option>)}</BrandedSelect></label>}
          <label className="grid min-w-0 gap-1 text-sm font-medium">{mode !== "create" ? c("Gate name", "Nombre del acceso") : t("changeOver.newGate")}<BrandedInput data-guidance-id="gate-name" required value={name} maxLength={80} disabled={busy || !editable} onChange={event => { setName(event.target.value); setSaved(""); }} /></label>
          {mode === "edit" && <button type="button" className="gate-history-filter self-end justify-self-end" disabled={busy || !editingGate || !name.trim() || name.trim() === editingGate.name || !navigator.onLine} onClick={() => void saveGateName()}>{c("Save", "Guardar")}</button>}
          {mode !== "create" && editableGates.isError && <p role="alert">{c("Gates could not load. Refresh to try again.", "No se pudieron cargar los accesos. Actualice para reintentar.")}</p>}
        </div>
      </section>
      <div className="pb-3">
        <div className="grid gap-3 pb-3">
          <label className="grid gap-1 text-sm">{c('Gate relationship','Relación del acceso')}<BrandedSelect value={topology.kind} disabled={busy} onChange={e=>setTopology({...independent,kind:e.target.value as typeof topology.kind})}><option value="independent">{c('Independent — site entrance','Independiente — entrada al sitio')}</option><option value="parallel">{c('Parallel — another entrance to the same area','Paralelo — otra entrada a la misma área')}</option><option value="series">{c('Series — secure area beyond another gate','En serie — área segura después de otro acceso')}</option></BrandedSelect></label>
          {topology.kind==='series'&&<><label className="grid gap-1 text-sm">{c('Secure area name','Nombre del área segura')}<BrandedInput value={topology.area} maxLength={100} onChange={e=>setTopology({...topology,area:e.target.value})}/></label><label className="grid gap-1 text-sm">{c('Gate people pass through first','Acceso por el que pasan primero')}<BrandedSelect value={topology.parentGateId??''} onChange={e=>setTopology({...topology,parentGateId:e.target.value||null})}><option value="">{c('Choose upstream gate','Elegir acceso anterior')}</option>{stations.filter(g=>g.id!==editingGate?.id).map(g=><option key={g.id} value={g.id}>{gateLabel(g)}</option>)}</BrandedSelect></label></>}
          {topology.kind==='parallel'&&<label className="grid gap-1 text-sm">{c('Share the controlled area of','Compartir el área controlada de')}<BrandedSelect value={topology.parallelGateId??''} onChange={e=>setTopology({...topology,parallelGateId:e.target.value||null})}><option value="">{c('Choose another entrance','Elegir otra entrada')}</option>{stations.filter(g=>g.id!==editingGate?.id).map(g=><option key={g.id} value={g.id}>{gateLabel(g)}{g.topology?.area?` · ${g.topology.area}`:''}</option>)}</BrandedSelect></label>}

          {editingGate&&<button type="button" className="gate-history-filter justify-self-start" disabled={busy || locatingDestination !== null} onClick={async()=>{setBusy(true);setError('');try{const result=await changeOverRequest<EditableGate>(`/stations/${editingGate.id}/topology`,{siteId,topology,expectedVersion:editingGate.version});setEditingGate({...editingGate,version:result.version,topology:result.topology});await cache.invalidateQueries({queryKey:['gate-area-traffic']});await cache.invalidateQueries({queryKey:['gate-coverage-map']});setSaved(c('Gate relationship saved.','Relación guardada.'));}catch(e){setError(e instanceof Error?e.message:'Save failed');}finally{setBusy(false);}}}>{c('Save relationship','Guardar relación')}</button>}
        </div>
        <section><h3 className="text-sm mb-2">{c('Site/Spur','Sitio/Ramal')}</h3>
        <GateLinkFields value={link} onChange={value => setLink(value.mode === "new" && !value.name ? {...value,name:available.find(site => site.id === siteId)?.gateLinkName ?? available.find(site => site.id === siteId)?.name ?? ""} : value)} sites={available.map(site => ({ ...site, name: siteLabel(site) }))} siteId={siteId} partnerId={available.find(site => site.id === siteId)?.partnerId} disabled={busy}/>
        {mode !== "create" && link.mode !== "none" && <button type="button" className="gate-history-filter mt-2" disabled={busy || (link.mode === "new" ? !link.name.trim() : !link.targetSiteId)} onClick={async () => {
          setBusy(true); setError(""); try { await changeOverRequest("/site-link", {siteId,...gateLinkPayload(link)}); setLink(emptyGateLink); await Promise.all(["linked-gates","gate-station-management-sites","change-over-state"].map(key => cache.invalidateQueries({queryKey:[key]}))); setSaved(c("Parallel gates linked.","Accesos paralelos vinculados.")); } catch(e) {setError(e instanceof Error ? e.message : t("changeOver.failed"));} finally {setBusy(false);}
        }}>{c("Save link", "Guardar vínculo")}</button>}
        </section>
      </div>
      <section className="gate-panel-disclosure">
        <h3 className="gate-administration-section-title"><MapPin aria-hidden="true" /><span className="flex-1">{c("Gate Location", "Ubicación del acceso")}</span><small>{validLocation ? c("Location set", "Ubicación lista") : c("Not set", "Sin establecer")}</small></h3>
        <div className="grid gap-3 pb-3">
          <label className="grid gap-1 text-sm font-medium">{c("Set location by", "Establecer ubicación con")}<BrandedSelect data-guidance-id="location-method" value={method} disabled={busy || !editable} onChange={event => { setMethod(event.target.value as Method); clearLocation(); }}><option value="gps">{c("Current GPS", "GPS actual")}</option><option value="coordinates">{c("Latitude / Longitude", "Latitud / Longitud")}</option><option value="address">{c("Address", "Dirección")}</option></BrandedSelect></label>
          {method === "coordinates" && <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">{c("Latitude", "Latitud")}<BrandedInput type="number" step="any" min={-90} max={90} disabled={busy || !editable} value={latitude} onChange={event => { setLatitude(event.target.value); setError(""); setSaved(""); }} /></label><label className="grid gap-1 text-sm">{c("Longitude", "Longitud")}<BrandedInput type="number" step="any" min={-180} max={180} disabled={busy || !editable} value={longitude} onChange={event => { setLongitude(event.target.value); setError(""); setSaved(""); }} /></label></div>}
          {method === "address" && <><label className="grid gap-1 text-sm">{c("Address", "Dirección")}<BrandedInput value={address} disabled={busy || !editable} maxLength={500} onChange={event => { setAddress(event.target.value); clearLocation(); }} /></label><div><button className="gate-history-filter" type="button" disabled={busy || locating || !editable || !address.trim()} onClick={() => void findAddress()}>{locating ? c("Finding location…", "Buscando ubicación…") : c("Find Location", "Buscar ubicación")}</button></div></>}
          <div className="flex items-center justify-between gap-3"><button className="gate-history-filter" type="button" disabled={busy || locating || !editable} onClick={locate}>{locating ? c("Locating…", "Localizando…") : c("Use my location", "Usar mi ubicación")}</button>
        <button data-guidance-id="save-gate" className="gate-history-filter ml-auto" type="submit" disabled={busy || locating || locatingDestination !== null || !editable || (mode !== "create" && !hasEdits) || !siteId || !name.trim() || !validLocation || !navigator.onLine}>{busy ? c("Saving…", "Guardando…") : mode === "edit" ? c("Save Gate Changes", "Guardar cambios del acceso") : t("changeOver.addGate")}</button>
          </div>
      {mode === "edit" && <div className="flex items-center justify-between gap-3">
        {mode === "edit" && <><button type="button" className="gate-history-filter" disabled={busy || locating || !editingGate || !navigator.onLine} onClick={() => setRemoveRequested(true)}>{c("Mark Inactive", "Marcar inactivo")}</button><button type="button" className="gate-history-filter ml-auto" disabled={busy || locating || !editingGate || !navigator.onLine} data-guidance-id="remove-gate" onClick={() => setRemoveRequested(true)}>{c("Remove Gate", "Retirar acceso")}</button></>}
      </div>}
          {resolvedAddress && <p className="text-xs text-muted-foreground">{resolvedAddress}</p>}
        </div>
      </section>
          {topology.kind==='independent'&&<fieldset className="grid gap-3 rounded border border-white/20 p-3">
            <legend className="text-sm">{c('Configured destinations','Destinos configurados')}</legend>
            <p className="text-xs text-muted-foreground">{c('Leave empty to use the secure-area gates beyond this entrance. Add other destinations only after the customer confirms them.','Deje vacío para usar las áreas seguras después de esta entrada. Agregue otros destinos solo después de la confirmación del cliente.')}</p>
            {(topology.destinations ?? []).map(destination => <div key={destination.id} className="grid gap-2">
              <button type="button" className="gate-history-filter text-left" aria-expanded={openDestinationId === destination.id} disabled={busy} onClick={() => setOpenDestinationId(openDestinationId === destination.id ? null : destination.id)}>{destination.name}</button>
              {openDestinationId === destination.id && <div className="grid gap-2">
                <label className="grid gap-1 text-sm">{c('Destination name','Nombre del destino')}<BrandedInput value={destination.name} maxLength={100} disabled={busy} onChange={event => setTopology(current => ({...current, destinations: current.destinations?.map(d => d.id === destination.id ? {...d, name:event.target.value} : d)}))}/></label>
                {destination.latitude != null && destination.longitude != null && <p className="text-xs text-muted-foreground">{destination.latitude.toFixed(6)}, {destination.longitude.toFixed(6)}</p>}
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="gate-history-filter" disabled={busy || locatingDestination !== null} onClick={() => locateDestination(destination.id)}>{locatingDestination === destination.id ? c('Locating…','Localizando…') : c('Use my Location','Usar mi ubicación')}</button>
                  <button type="button" className="gate-history-filter" disabled={busy} onClick={() => { setTopology(current => ({...current, destinations: current.destinations?.filter(d => d.id !== destination.id), defaultDestinationId: current.defaultDestinationId === destination.id ? null : current.defaultDestinationId})); setOpenDestinationId(null); }}>{c('Remove destination','Retirar destino')}</button>
                </div>
              </div>}
            </div>)}
            {destinationDraft ? <div className="grid gap-2">
              <label className="grid gap-1 text-sm">{c('Destination name','Nombre del destino')}<BrandedInput value={destinationDraft.name} maxLength={100} disabled={busy} onChange={event => setDestinationDraft({...destinationDraft, name:event.target.value})}/></label>
              {destinationDraft.latitude != null && destinationDraft.longitude != null && <p className="text-xs text-muted-foreground">{destinationDraft.latitude.toFixed(6)}, {destinationDraft.longitude.toFixed(6)}</p>}
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="gate-history-filter" disabled={busy || locatingDestination !== null} onClick={() => locateDestination(destinationDraft.id)}>{locatingDestination === destinationDraft.id ? c('Locating…','Localizando…') : c('Use my Location','Usar mi ubicación')}</button>
                <div className="ml-auto flex items-center gap-2">
                <button type="button" className="gate-history-filter" disabled={busy || locatingDestination !== null || !destinationDraft.name.trim()} onClick={() => { setTopology(current => ({...current, destinations:[...(current.destinations ?? []), {...destinationDraft, name:destinationDraft.name.trim()}]})); setDestinationDraft(null); }}>{c('Add destination','Agregar destino')}</button>
                  <button type="button" className="gate-history-filter" disabled={busy} onClick={() => { setDestinationDraft(null); setOpenDestinationId(null); }}>{c("Cancel", "Cancelar")}</button>
                </div>
              </div>
            </div> : <button type="button" className="gate-history-filter justify-self-start" disabled={busy} onClick={() => { setOpenDestinationId(null); setDestinationDraft({id:crypto.randomUUID(),name:'',gateId:null}); }}>{c('Add destination','Agregar destino')}</button>}
          </fieldset>}
      {removeRequested && editingGate && <section aria-label={c("Confirm gate removal", "Confirmar retiro del acceso")} className="rounded border border-white/20 p-3">
        <p>{c(`Remove ${editingGate.name} from active use? Its history will be retained.`, `¿Retirar ${editingGate.name} del uso activo? Se conservará su historial.`)}</p>
        <TogglePillButton type="button" color="red" data-guidance-id="confirm-remove" disabled={busy || !navigator.onLine} onClick={() => void removeGate()}>{c("Confirm Remove Gate", "Confirmar retiro")}</TogglePillButton>
        <TogglePillButton type="button" color="blue" disabled={busy} onClick={() => setRemoveRequested(false)}>{c("Cancel", "Cancelar")}</TogglePillButton>
      </section>}
      {error && <p role="alert" className="pt-2 text-sm text-red-400">{error}</p>}
      {saved && <p role="status" className="pt-2 text-sm text-green-400">{saved}</p>}
    </form>
  </WorkspacePanel>;
}
