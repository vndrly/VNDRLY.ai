import { GateMapPinRemoval } from "./gate-map-pin-removal";
import WorkdayStatusSwitch from "./workday-status-switch";
import { gateMapLinkLines, gateMapCoverageCircles } from "@/lib/gate-map-overlays";
import "./workday-controls.css";
import { CardHeading } from "@/components/ui/card-heading";
import { LocateFixed, Crosshair, MapPinned, MapPin, Users, ShieldCheck, Phone, Satellite, Map as MapIcon, Maximize2, Minimize2, Scan, RefreshCw, Settings } from "lucide-react";
import { WorkspacePanel } from "@/components/work-hub/workspace-panel";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { GateMapVehicle } from "@workspace/api-zod";
import { gateMapVehiclePopup } from "@/lib/gate-map-vehicle-popup";
import "./gate-dashboard.css";
import { MapboxMap } from "@/components/mapbox-map";
import { GateMapActivityPanel } from "./gate-map-activity-panel";
import { GateMapActivityPopup } from "./gate-map-activity-popup";
import { GateMapTimeControl } from "./gate-map-time-control";
import { changeOverRequest } from "@/lib/change-over-api";
import { useBrand } from "@/hooks/use-brand";
import { GateMapPinFlyout, type GateMapPin } from "./gate-map-pin-flyout";
import { GateMapPinShare } from "./gate-map-pin-share";
import { GateMapDirections } from "./gate-map-directions";
import { sortGateMapStaff, type StaffSort } from "@/lib/gate-map-staff-sort";
import GateSiteGateSelect from "./gate-site-gate-select";
import { GateMapRevealStaff, hasMapLocation, type RevealStaffPerson } from "./gate-map-reveal-staff";

type Coverage = {
  at: string; pins?: GateMapPin[];
  gates: { id: string; name: string; siteId: number; siteName: string; linkGroupId?:string|null; active?: boolean; latitude?: number | null; longitude?: number | null; siteLatitude?: number | null; siteLongitude?: number | null }[];
  staff: (RevealStaffPerson & { email?: string | null; phone?: string | null; onShift?: boolean; onCallStartedAt?: string | null; assignment: string; onWatch?: boolean; onCall?: boolean; locationReason: string })[];
  vehicles?: GateMapVehicle[]; vehicleFeedUnavailable?: boolean; vehiclesTruncated?: boolean;
  duties: { id: string; userId?: number; stationId: string; name: string; startedAt: string; coverage: { status?: string } }[];
};

/** Server-authorized Gate locations and company-shared pins. */
export function GateCoverageMap({ showGateSelector = false, expandedHeader }: { showGateSelector?: boolean; expandedHeader?: (close: () => void) => ReactNode }) {
  const { user } = useAuth();
  const brand = useBrand();
  const { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const c = es ? { live: "En vivo", paused: "Sin conexión en vivo", refresh: "Actualizar", satellite: "Satélite", street: "Calles", fit: "Ver toda la cobertura", expand: "Ampliar mapa", close: "Reducir mapa", all: "Todos", staffed: "Con personal", unstaffed: "Sin turno registrado", gates: "Accesos", staff: "Personal con ubicación actual", missing: "Ubicación pendiente o antigua", details: "Detalles del acceso", select: "Seleccione un acceso en el mapa", noDuty: "No hay turno registrado", noPoints: "No hay ubicaciones disponibles para este filtro" } : { live: "Live", paused: "Not live", refresh: "Refresh", satellite: "Satellite", street: "Street", fit: "Fit to coverage", expand: "Expand map", close: "Collapse map", all: "All", staffed: "Staffed", unstaffed: "No recorded duty", gates: "Gates", staff: "Current staff locations", missing: "Missing or stale locations", details: "Gate details", select: "Select a gate on the map", noDuty: "No duty recorded", noPoints: "No mapped locations for this filter" };
  const [callSort, setCallSort] = useState<StaffSort>("nearest");
  const [origin, setOrigin] = useState<{latitude: number; longitude: number} | null>(null);
  const originRequested = useRef(false);
  const [locationError, setLocationError] = useState("");
  const [pinChanging, setPinChanging] = useState(false), [pinError,setPinError] = useState("");
  const [removedPinId,setRemovedPinId] = useState<string|null>(null);
  const [dropping, setDropping] = useState(false);
  const [draftPin, setDraftPin] = useState<{latitude:number;longitude:number} | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("pinId"));
  const [selectionGateId,setSelectionGateId]=useState<string|null>(null);
  const [centerOnMe,setCenterOnMe]=useState(false),[centeringMe,setCenteringMe]=useState(false);
  const [centerError,setCenterError]=useState("");
  const centerRequest=useRef(0);
  const cancelCenterRequest=()=>{centerRequest.current++;setCenteringMe(false);setCenterError("");};
  const [styleKind, setStyleKind] = useState<"satellite" | "street">("street");
  const [showLinks,setShowLinks]=useState(true),[showCoverage,setShowCoverage]=useState(true);
  const [darkMode,setDarkMode]=useState(true);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [revealOpen,setRevealOpen]=useState(false),[revealedStaffIds,setRevealedStaffIds]=useState<number[]|null>(null);
  const [selectedGate, setSelectedGate] = useState<string | null>(null);
  const [focusedGateId, setFocusedGateId] = useState<string | null>(null);
  const [focusedStaffId, setFocusedStaffId] = useState<number | null>(null);
  const [activityGateId, setActivityGateId] = useState<string | null>(null);
  const [activityVisit, setActivityVisit] = useState(0);
  const pinnedActivity = useRef(false), leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepActivity = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  const closeActivity = () => { keepActivity(); pinnedActivity.current = false; setActivityGateId(null); };
  const leaveActivity = () => { keepActivity(); if (!pinnedActivity.current) leaveTimer.current = setTimeout(() => setActivityGateId(null), 250); };
  const openActivity = (gateId: string, pinned: boolean) => {
    keepActivity(); cancelCenterRequest(); setSelectedPinId(null); setCenterOnMe(false);
    if (pinnedActivity.current && !pinned) return;
    pinnedActivity.current = pinned;
    setActivityGateId(gateId); setActivityVisit(value => value + 1);
  };
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  const [expanded, setExpanded] = useState(false);
  const [fitRevision, setFitRevision] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [expanded]);
  const [at, setAt] = useState("");
  const instant = at || null;
  const coverage = useQuery({
    queryKey: ["gate-coverage-map", user?.userId, user?.activeMembershipId, instant],
    queryFn: () => changeOverRequest<Coverage>(`/coverage-map${instant ? `?at=${encodeURIComponent(instant)}` : ""}`),
    enabled: !!user?.vendorId,
    refetchInterval: instant ? false : 30000,
  });
  const gates = coverage.data?.gates ?? [];
  const linkedLines=useMemo(()=>gateMapLinkLines(coverage.data?.gates??[],brand.primary),[coverage.data?.gates,brand.primary]);
  const coverageCircles=useMemo(()=>gateMapCoverageCircles(coverage.data?.gates??[],brand.primary),[coverage.data?.gates,brand.primary]);
  const sites = [...new Map(gates.map(gate => [gate.siteId, { id: gate.siteId, name: gate.siteName }])).values()];
  const focusedGate = gates.find(gate => gate.id === focusedGateId);
  const selectionGate = gates.find(gate => gate.id === selectionGateId);
  const duties = coverage.data?.duties ?? [];
  const staff = [...(coverage.data?.staff ?? [])].sort((a,b) => a.name.localeCompare(b.name, es ? "es" : "en", { sensitivity: "base" }) || a.userId-b.userId);
  const onWatch = (person: Coverage["staff"][number]) => person.onWatch || duties.some(duty => duty.userId === person.userId);
  const groups = [
    { id: "watch", title: es ? "De guardia" : "On Watch", people: staff.filter(onWatch) },
    { id: "call", title: es ? "Disponible" : "On Call", people: sortGateMapStaff(staff.filter(person => !onWatch(person) && person.onCall), callSort, origin, es ? "es" : "en") },
    { id: "other", title: es ? "Todos los demás" : "Everyone else", people: staff.filter(person => !onWatch(person) && !person.onCall) },
  ];
  const focusStaff = (person: Coverage["staff"][number]) => {
    if (!hasMapLocation(person)) return;
    setRevealOpen(false);setRevealedStaffIds([person.userId]);
    closeActivity(); cancelCenterRequest();setCenterOnMe(false); setSelectedPinId(null); setSelectedGate(null); setFocusedGateId(null); setFocusedStaffId(person.userId);
  };
  const revealStaff=(people:RevealStaffPerson[])=>{
    const current=people.filter(person=>hasMapLocation(person));if(!current.length)return;
    setRevealOpen(false);setRevealedStaffIds(current.map(person=>person.userId));
    closeActivity();cancelCenterRequest();setCenterOnMe(false);setSelectedPinId(null);setSelectedGate(null);setFocusedGateId(null);setFocusedStaffId(current.length===1?current[0].userId:null);setFitRevision(value=>value+1);
  };
  useEffect(()=>{
    if(callSort!=="nearest"||originRequested.current)return;
    originRequested.current=true;
    if(!navigator.geolocation){setLocationError(es?"GPS no disponible":"Your location is unavailable");return;}
    navigator.geolocation.getCurrentPosition(position=>setOrigin({latitude:position.coords.latitude,longitude:position.coords.longitude}),()=>setLocationError(es?"No se pudo obtener su ubicación; lista por nombre.":"Your location could not be obtained; showing names in order."),{maximumAge:60000,timeout:10000});
  },[callSort,es]);
  const pins = coverage.data?.pins ?? [];
  const selectedPin = pins.find(pin => pin.id === selectedPinId);
  function sortOnCall(value: StaffSort) {
    setCallSort(value); setLocationError("");
    if (value === "nearest") {
      if (!navigator.geolocation) { setLocationError(es ? "GPS no disponible" : "Your location is unavailable"); return; }
      originRequested.current=true;
      navigator.geolocation.getCurrentPosition(position => setOrigin({latitude:position.coords.latitude,longitude:position.coords.longitude}), () => {setOrigin(null);setLocationError(es ? "No se pudo obtener su ubicación; lista por nombre." : "Your location could not be obtained; showing names in order.");}, {maximumAge:60000,timeout:10000});
    }
  }
  function recenterSelection() {
    setRevealedStaffIds(null);
    closeActivity();cancelCenterRequest();setCenterOnMe(false);setSelectedPinId(null);setFocusedStaffId(null);
    setFocusedGateId(selectionGateId);setSelectedGate(selectionGateId);setFitRevision(value=>value+1);
  }
  function recenterMe() {
    if(centeringMe)return;setCenterError("");
    if(!navigator.geolocation){setCenterError(es?"GPS no disponible":"Your location is unavailable");return;}
    setCenteringMe(true);const request=++centerRequest.current;
    navigator.geolocation.getCurrentPosition(position=>{
      if(request!==centerRequest.current)return;
      closeActivity();setOrigin({latitude:position.coords.latitude,longitude:position.coords.longitude});setLocationError("");
      setSelectedPinId(null);setFocusedStaffId(null);setFocusedGateId(null);setSelectedGate(null);setCenterOnMe(true);setFitRevision(value=>value+1);setCenteringMe(false);
    },()=>{if(request!==centerRequest.current)return;setCenterError(es?"No se pudo obtener su ubicación.":"Your location could not be obtained.");setCenteringMe(false);},{maximumAge:0,timeout:10000,enableHighAccuracy:true});
  }
  async function changePinRemoval(pinId:string,removed:boolean) {
    if(pinChanging)return; setPinChanging(true);setPinError("");
    try {await changeOverRequest(`/map-pins/${pinId}/removal`,{removed});setSelectedPinId(removed?null:pinId);setRemovedPinId(removed?pinId:null);await coverage.refetch();}
    catch(error){setPinError(error instanceof Error?error.message:"Pin could not be changed");}
    finally{setPinChanging(false);}
  }
  const shownGates = gates;
  const activityGate = gates.find(gate => gate.id === activityGateId);
  const selected = shownGates.find(gate => gate.id === selectedGate);
  const points = [
    ...shownGates.flatMap(gate => {
      const latitude = gate.latitude ?? gate.siteLatitude, longitude = gate.longitude ?? gate.siteLongitude;
      const staffed = duties.some(duty => duty.stationId === gate.id);
      return typeof latitude === "number" && typeof longitude === "number" ? [{ id: `gate:${gate.id}`, latitude, longitude, title: `${gate.siteName} · ${gate.name} · ${gate.active === false ? es ? "Inactivo" : "Inactive" : staffed ? c.staffed : c.unstaffed}`, label: "G", fullLabel: `${gate.siteName} | ${gate.name}`, fullLabelMinZoom: 9.9, color: gate.active === false ? "#9ca3af" : brand.primary, onHover: () => openActivity(gate.id, false), onLeave: leaveActivity, onClick: () => { openActivity(gate.id, true); setSelectedGate(gate.id); setSelectionGateId(gate.id); setFocusedGateId(gate.id); setFocusedStaffId(null); } }] : [];
    }),
    ...(coverage.data?.staff ?? []).flatMap(person => hasMapLocation(person) && (revealedStaffIds===null||revealedStaffIds.includes(person.userId)) ? [{ id: `staff:${person.userId}`, latitude:person.location!.latitude, longitude:person.location!.longitude, title: `${person.name}${person.demonstration ? " · Sample location" : ""}`, label: "●", fullLabel: person.name, fullLabelMinZoom: 9.9, color: person.onShift ? "#22c55e" : brand.primary, onClick: () => focusStaff(person) }] : []),
  ];
  const vehiclePoints = (coverage.data?.vehicles ?? []).map(vehicle => ({ id: `vehicle:${vehicle.runId}`, latitude: vehicle.latitude, longitude: vehicle.longitude,
    title: `${vehicle.vehicleLabel || "Vehicle"} · ${vehicle.driverName || vehicle.title}`, label: "T", color: brand.primary,
    popupHtml: gateMapVehiclePopup(vehicle, es), popupOnHover: true, popupClassName: "gate-map-vehicle-popup" }));
  const pinPoints = pins.map(pin => ({id:`pin:${pin.id}`,latitude:pin.latitude,longitude:pin.longitude,title:pin.label,label:"P",color:brand.primary,onClick:()=>{closeActivity();cancelCenterRequest();setCenterOnMe(false);setSelectedPinId(pin.id);setSelectedGate(null);setFocusedGateId(null);setFocusedStaffId(null);}}));
  const myPoint = centerOnMe && origin ? {id:"my-location",...origin,title:es?"Mi ubicación":"My location",label:"●",color:"#ffffff"} : null;
  const allPoints = [...points, ...vehiclePoints, ...pinPoints,...(myPoint?[myPoint]:[])];
  const selectedPointId = myPoint ? myPoint.id : selectedPin ? `pin:${selectedPin.id}` : focusedStaffId != null ? `staff:${focusedStaffId}` : selected ? `gate:${selected.id}` : null;
  const focusedPoint = myPoint ?? allPoints.find(point => point.id === (selectedPin ? `pin:${selectedPin.id}` : focusedStaffId != null ? `staff:${focusedStaffId}` : `gate:${focusedGateId}`));
  if (!user?.vendorId) return null;
  return <section data-card-layout aria-label="Gate coverage map" data-gate-workspace-panel className="gate-map-compact space-y-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
    <div className="gate-map-selector-row">
    <CardHeading as="h2" className="flex items-center gap-2 text-lg font-semibold"><MapPin aria-hidden="true" className="h-5 w-5 text-[var(--brand-primary)]" />{es ? "Mapa de accesos" : "Gate Map"}</CardHeading>
    {showGateSelector && coverage.isSuccess && <GateSiteGateSelect sites={sites} siteId={selectionGate?.siteId ?? 0}
      gate={selectionGate} gateOptions={gates} gpsStatus="unavailable" gpsLabel={es ? "GPS no evaluado en este mapa" : "GPS not evaluated on this map"} allOptionLabel={c.all} testId="select-gate-map-location"
      onChange={(_siteId, gateId) => { closeActivity(); cancelCenterRequest();setCenterOnMe(false);setSelectionGateId(gateId || null);setFitRevision(value=>value+1); setSelectedPinId(null); setFocusedGateId(gateId || null); setSelectedGate(gateId || null); setFocusedStaffId(null); }} />}
      <button type="button" className="gate-map-control gate-map-icon-control gate-map-refresh" aria-label={c.refresh} title={c.refresh} disabled={coverage.isFetching} onClick={() => void coverage.refetch()}><RefreshCw aria-hidden="true" /></button>
    </div>
    <div className={expanded ? "gate-map-expanded fixed inset-0 z-50 flex flex-col gap-3 p-4" : "space-y-3"}>
      {expanded && expandedHeader?.(() => setExpanded(false))}
      <GateMapTimeControl instant={instant} onChange={value => setAt(value ?? "")} liveConnected={coverage.isSuccess && coverage.fetchStatus !== "paused"} es={Boolean(es)} />
      {centerError && <p role="status">{centerError}</p>}
      {pinError && <p role="alert">{pinError}</p>}
      {removedPinId && <p role="status" className="gate-map-pin-undo">{es ? "Pin eliminado." : "Pin removed."} <button type="button" disabled={pinChanging} onClick={()=>void changePinRemoval(removedPinId,false)}>{es ? "Deshacer" : "Undo"}</button></p>}
      {dropping && <p role="status" className="text-xs">{es ? "Toque el mapa para ubicar el pin." : "Click or tap the map to place your pin."}</p>}
      {coverage.isPending ? <p role="status">Loading authorized coverage…</p> : coverage.isError ? <p role="alert">Gate coverage is unavailable. No coverage status can be inferred.</p> : <>
        <div className="overflow-hidden rounded-xl border-2 border-[color:var(--brand-primary)]" style={expanded ? { flex: 1, minHeight: 0 } : undefined}>
          <MapboxMap className={`gate-map-canvas${darkMode ? " is-dark-mode" : ""}`} customZoomControls topControls={<>{settingsOpen && <div id="gate-map-settings" className="gate-map-layer-controls" role="group" aria-label={es?"Configuración del mapa":"Map settings"}>
            <div className="gate-map-layer-toggles">
              <WorkdayStatusSwitch active={showLinks} label={es?"Vínculos":"Links"} onClick={()=>setShowLinks(value=>!value)} />
              <WorkdayStatusSwitch active={showCoverage} label={es?"Cobertura":"Coverage"} onClick={()=>setShowCoverage(value=>!value)} />
          <div className="gate-map-control-group" role="group" aria-label="Map style">
            <button type="button" role="switch" className="gate-map-style-toggle" aria-label={`${c.street} / ${c.satellite}`} aria-checked={styleKind === "satellite"} title={`${c.street} / ${c.satellite}: ${styleKind === "street" ? c.street : c.satellite}`} onClick={() => setStyleKind(value => value === "street" ? "satellite" : "street")}>
              <MapIcon aria-hidden="true" className={styleKind === "street" ? "is-selected" : undefined} /><span className="gate-map-style-track" aria-hidden="true"><span /></span><Satellite aria-hidden="true" className={styleKind === "satellite" ? "is-selected" : undefined} />
            </button>
          </div>
              <WorkdayStatusSwitch active={darkMode} label={es?"Modo oscuro":"Dark Mode"} onClick={()=>setDarkMode(value=>!value)} />
            </div>
          </div>}{revealOpen&&<GateMapRevealStaff people={staff} es={Boolean(es)} onReveal={revealStaff} onClose={()=>setRevealOpen(false)}/>}</>} lines={showLinks?linkedLines:[]} circles={showCoverage?coverageCircles:[]} bottomControls={<>
          <div className="gate-map-control-group gate-map-settings-control"><button type="button" className="gate-map-plain-control" aria-label={es?"Configuración del mapa":"Map settings"} title={es?"Configuración del mapa":"Map settings"} aria-controls="gate-map-settings" aria-expanded={settingsOpen} onClick={()=>{setRevealOpen(false);setSettingsOpen(value=>!value);}}><Settings aria-hidden="true" /></button><button type="button" data-map-reveal-toggle className="gate-map-plain-control" aria-label={es?"Mostrar personal":"Reveal Staff"} title={es?"Mostrar personal":"Reveal Staff"} aria-expanded={revealOpen} onClick={()=>{setSettingsOpen(false);setRevealOpen(value=>!value);}}><Users aria-hidden="true"/></button></div>
          <div className="gate-map-tool-center"><button type="button" className="gate-map-plain-control" aria-label={es?"Centrar en mí":"Center on Me"} title={es?"Centrar en mí":"Center on Me"} disabled={centeringMe} onClick={recenterMe}><LocateFixed aria-hidden="true" /></button><button type="button" className="gate-map-plain-control" aria-label={es?"Centrar selección":"Center on Selection"} title={selectionGate?`${es?"Centrar en":"Center on"} ${selectionGate.siteName} | ${selectionGate.name}`:es?"Ver todos mis sitios":"Fit all my sites"} onClick={recenterSelection}><Crosshair aria-hidden="true" /></button>{!instant && sites.length > 0 && <button type="button" className="gate-map-plain-control" aria-label={es ? "Agregar pin" : "Drop Pin"} title={es ? "Agregar pin" : "Drop Pin"} aria-pressed={dropping} onClick={()=>{closeActivity();setSelectedPinId(null);setDropping(value=>!value);}}><MapPinned aria-hidden="true" /></button>}</div>
          <div className="gate-map-control-group gate-map-view-controls" role="group" aria-label="Map view">
            <button type="button" className="gate-map-plain-control" aria-label={expanded ? c.close : c.expand} title={expanded ? c.close : c.expand} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
            <button type="button" className="gate-map-plain-control" aria-label={c.fit} title={c.fit} onClick={() => { setRevealedStaffIds(null);closeActivity(); cancelCenterRequest();setCenterOnMe(false);setSelectionGateId(null); setFocusedGateId(null); setSelectedGate(null); setFocusedStaffId(null); setSelectedPinId(null); setFitRevision(value => value + 1); }}><Scan aria-hidden="true" /></button>
          </div>
          </>} key={`${fitRevision}:${expanded}`} points={allPoints} fitPoints={points.filter(point=>point.id.startsWith(revealedStaffIds===null?"gate:":"staff:"))} selectedPointId={selectedPointId} panToSelectedPoint enhancedStreetContrast styleKind={styleKind === "street" ? darkMode ? "dark" : "street" : "satellite"}
            onMapClick={dropping ? (latitude,longitude)=>{setDraftPin({latitude,longitude});setDropping(false);setExpanded(false);} : undefined}
            anchoredPopup={selectedPin ? {pointId:`pin:${selectedPin.id}`,className:"gate-map-activity-popup",maxWidth:"344px",onClose:()=>setSelectedPinId(null),content:<section data-card-layout className="gate-map-activity-card"><CardHeading as="h3"><MapPin aria-hidden="true" />{selectedPin.label}</CardHeading><p>{selectedPin.latitude.toFixed(6)}, {selectedPin.longitude.toFixed(6)}</p>{selectedPin.notes && <p className="gate-map-pin-notes">{selectedPin.notes}</p>}<p>{new Date(selectedPin.createdAt).toLocaleString()}</p><GateMapDirections latitude={selectedPin.latitude} longitude={selectedPin.longitude} es={Boolean(es)} />{!instant&&<GateMapPinShare key={selectedPin.id} pinId={selectedPin.id} es={Boolean(es)} />}{!instant && <GateMapPinRemoval key={selectedPin.id} es={Boolean(es)} pending={pinChanging} onRemove={()=>changePinRemoval(selectedPin.id,true)} />}{pinError&&<p role="alert">{pinError}</p>}</section>} : activityGate ? { pointId: `gate:${activityGate.id}`, className: "gate-map-activity-popup", maxWidth: "344px", onClose: closeActivity,
              content: <GateMapActivityPopup key={`${activityGate.id}:${activityVisit}`} stationId={activityGate.id} siteId={activityGate.siteId}
                siteName={activityGate.siteName} gateName={activityGate.name} active={activityGate.active} latitude={activityGate.latitude ?? activityGate.siteLatitude} longitude={activityGate.longitude ?? activityGate.siteLongitude} userId={user.userId} membershipId={user.activeMembershipId}
                historical={Boolean(instant)} visit={activityVisit} es={Boolean(es)} onEnter={keepActivity} onLeave={leaveActivity} /> } : undefined}
            center={focusedPoint ? [focusedPoint.longitude, focusedPoint.latitude] : undefined} zoom={focusedPoint ? 16 : 14} fitToData={!focusedPoint} height={expanded ? "100%" : 420} />
        </div>
        {!allPoints.length && <p role="status">{c.noPoints}</p>}
      </>}
    </div>
    {coverage.isSuccess && <>
      <p className="text-xs text-muted-foreground">Only current, shared app locations appear on the map. Employees without a current location remain listed below.{staff.some(person=>person.demonstration)&&" GateGo sample staff positions are static demonstration locations."}</p>
      {coverage.data.vehicleFeedUnavailable && <p role="status" className="text-xs text-amber-500">{es ? "No se pudieron cargar algunas ubicaciones de vehículos." : "Some tracked vehicle locations could not be loaded."}</p>}
      {coverage.data.vehiclesTruncated && <p className="text-xs text-muted-foreground">{es ? "Se muestran los primeros vehículos entrantes disponibles." : "Showing the first available tracked inbound vehicles."}</p>}
      <div className="gate-map-rosters">
        <WorkspacePanel title={es ? "Ubicaciones del personal" : "Staff locations"} subtitle={es ? "Observaciones de ubicación registradas" : "Recorded location observations"} icon={Users}>
          {groups.map(group => <details key={group.id} className="gate-panel-disclosure gate-map-staff-group" open={group.id === "watch" ? true : undefined}>
            <summary>{group.id === "watch" ? <ShieldCheck aria-hidden="true" /> : group.id === "call" ? <Phone aria-hidden="true" /> : <Users aria-hidden="true" />}<span>{group.title}</span>{group.id === "call" && <select className="gate-map-call-sort" aria-label={es ? "Ordenar disponibles" : "Sort On Call"} value={callSort} onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onChange={event=>sortOnCall(event.target.value as StaffSort)}>
              <option value="name">{es ? "Nombre" : "Name"}</option><option value="nearest">{es ? "Más cercano" : "Nearest"}</option><option value="first">{es ? "Primero disponible" : "First on call"}</option><option value="latest">{es ? "Último disponible" : "Latest on call"}</option>
            </select>}<small>{group.people.length}</small></summary>
            {group.id === "call" && locationError && <p role="status" className="text-xs">{locationError}</p>}
            <ul>{group.people.map(person => <li key={person.userId} className="gate-map-person" data-on-shift={person.onShift === true}>
              <button type="button" className="gate-map-staff-link" disabled={!hasMapLocation(person)}
                title={hasMapLocation(person) ? es ? "Ver ubicación en el mapa" : "Show location on map" : es ? "No hay ubicación compartida actual" : "No current shared location"}
                onClick={() => focusStaff(person)}><strong>{person.name}</strong>{group.id !== "call" && <span>{person.assignment} · {person.locationReason.replaceAll("_", " ")}</span>}</button>
              {group.id === "call" && <><div className="gate-map-person-contact">
                {person.phone ? <a href={`tel:${person.phone.replace(/[^+0-9]/g, "")}`}>{person.phone}</a> : <span>{es ? "Sin teléfono" : "No phone"}</span>}<span aria-hidden="true"> · </span>
                {person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : <span>{es ? "Sin correo" : "No email"}</span>}
              </div><button type="button" className="gate-map-person-assignment" disabled={!hasMapLocation(person)} onClick={()=>focusStaff(person)} title={person.assignment}>{person.assignment} · {person.locationReason.replaceAll("_", " ")}{person.location && ` · ${new Date(person.location.capturedAt).toLocaleString()}`}</button></>}
            </li>)}</ul>
            {!group.people.length && <p className="pb-3 text-xs text-muted-foreground">{es ? "Ningún empleado" : "No employees"}</p>}
          </details>)}
          {!staff.length && <p className="pb-3 text-sm text-muted-foreground">{es ? "No se devolvieron empleados con la app." : "No app-enabled employees returned."}</p>}
        </WorkspacePanel>
        <GateMapActivityPanel gates={gates} selectedGateId={focusedGateId} userId={user.userId} membershipId={user.activeMembershipId} />
      </div>
    </>}
    {draftPin && <GateMapPinFlyout {...draftPin} siteId={focusedGate?.siteId ?? sites[0]?.id ?? 0} sites={sites} es={Boolean(es)} onClose={()=>setDraftPin(null)} onSaved={pin=>{setDraftPin(null);setSelectedPinId(pin.id);void coverage.refetch();}} />}
  </section>;
}
