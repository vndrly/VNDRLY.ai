import { MapLayerControls } from "./map-layer-controls";
import { readGateSelection, saveGateSelection, useGateSelection } from "@/lib/gate-selection";
import { GateMovementLocationSummary } from './gate-area-traffic';
import { gateLocationLabel } from "@/lib/warwick-gate-label";
import { EquipmentListResponseSchema, type EquipmentItem } from "@workspace/api-zod";
import { equipmentRequest } from "./equipment/client";
import { GateMapRevealEquipment, EquipmentMapDetails } from "./gate-map-reveal-equipment";
import { Package } from "lucide-react";
import * as Dialog from '@/components/ui/task-dialog-primitives';
import GateCreateCard from './gate-create-card';
import { VendorEditFlyout } from './vendor-edit-flyout';
import { MapViewport } from "./map-viewport";
import { GateMapPinRemoval } from "./gate-map-pin-removal";

import { gateMapLinkLines, gateMapSiteBoundaryCircles } from "@/lib/gate-map-overlays";
import "./workday-controls.css";
import { CardHeading } from "@/components/ui/card-heading";
import { LocateFixed, MapPinned, MapPin, Users, ShieldCheck, Phone, LogIn, Maximize2, Minimize2, Scan, RefreshCw, Settings } from "lucide-react";
import { WorkspacePanel } from "@/components/work-hub/workspace-panel";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
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
import { useCardNextSteps } from "./card-next-steps";
import { useNextSteps } from "./next-steps";
import { useGuidedTarget } from "./guided-target";
import { gateGuideMatches, gateGuideScope } from "@/lib/gate-operational-helpers";

type Coverage = {
  at: string; pins?: GateMapPin[];
  gates: { id: string; name: string; siteId: number; siteName: string; partnerName?: string | null; linkGroupId?:string|null; siteRadiusMeters?:number|null; topology?:{boundaryCenter?:"site";kind:string;area:string;parentGateId:string|null;parallelGateId:string|null}|null; active?: boolean; latitude?: number | null; longitude?: number | null; siteLatitude?: number | null; siteLongitude?: number | null }[];
  staff: (RevealStaffPerson & { email?: string | null; phone?: string | null; onShift?: boolean; onCallStartedAt?: string | null; assignment: string; onWatch?: boolean; onCall?: boolean; locationReason: string })[];
  vehicles?: GateMapVehicle[]; vehicleFeedUnavailable?: boolean; vehiclesTruncated?: boolean;
  duties: { id: string; userId?: number; stationId: string; name: string; startedAt: string; coverage: { status?: string } }[];
};
const gateMapFitPadding = { top: 76, right: 44, bottom: 48, left: 44 };

/** Server-authorized Gate locations and company-shared pins. */
export function GateCoverageMap({ showGateSelector = false, showActivityFooter = true, siteList, expandedHeader, allowedSiteIds, manageableSiteIds }: { siteList?: ReactNode; allowedSiteIds?: number[]; manageableSiteIds?: number[]; showGateSelector?: boolean; showActivityFooter?: boolean; expandedHeader?: (close: () => void) => ReactNode }) {
  const { user } = useAuth();
  const sharedSelection=useGateSelection(user);
  const brand = useBrand();
  const [gateDraft,setGateDraft]=useState<{latitude:number;longitude:number;gateId?:string;siteId?:number}|null>(null);
  const [movingPin, setMovingPin] = useState<GateMapPin | null>(null);
  const [editingPin, setEditingPin] = useState<{pin: GateMapPin; latitude: number; longitude: number} | null>(null);
  const placeMovedPin = (latitude: number, longitude: number) => {
    if (!movingPin) return;
    setEditingPin({pin: movingPin, latitude, longitude}); setMovingPin(null);
  };
  const [movingGate,setMovingGate]=useState<string|null>(null);
  const management=useQuery({queryKey:['gate-station-management-sites',user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId],queryFn:()=>changeOverRequest<{sites:{id:number;name:string}[]}>('/station-management/sites'),enabled:!!user?.userId,retry:false,staleTime:30000});
  const managementSites = (management.data?.sites ?? []).filter(site => !manageableSiteIds || manageableSiteIds.includes(site.id));
  const { i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const c = es ? { live: "En vivo", paused: "Sin conexión en vivo", refresh: "Actualizar", satellite: "Satélite", street: "Calles", fit: "Ver toda la cobertura", expand: "Ampliar mapa", close: "Reducir mapa", all: "Todos", staffed: "Con personal", unstaffed: "Sin turno registrado", gates: "Accesos", staff: "Personal con ubicación actual", missing: "Ubicación pendiente o antigua", details: "Detalles del acceso", select: "Seleccione un acceso en el mapa", noDuty: "No hay turno registrado", noPoints: "No hay ubicaciones disponibles para este filtro" } : { live: "Live", paused: "Not live", refresh: "Refresh", satellite: "Satellite", street: "Street", fit: "Fit to coverage", expand: "Expand map", close: "Collapse map", all: "All", staffed: "Staffed", unstaffed: "No recorded duty", gates: "Gates", staff: "Current staff locations", missing: "Missing or stale locations", details: "Gate details", select: "Select a gate on the map", noDuty: "No duty recorded", noPoints: "No mapped locations for this filter" };
  const [callSort, setCallSort] = useState<StaffSort>("nearest");
  const [origin, setOrigin] = useState<{latitude: number; longitude: number} | null>(null);
  const originRequested = useRef(false);
  const [locationError, setLocationError] = useState("");
  const [pinChanging, setPinChanging] = useState(false), [pinError,setPinError] = useState("");
  const [removedPinId,setRemovedPinId] = useState<string|null>(null);
  const iosMap = new URLSearchParams(window.location.search).get("gateDevice") === "ios";
  const [droppingGate, setDroppingGate] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [draftPin, setDraftPin] = useState<{latitude:number;longitude:number} | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("pinId"));
  const [selectionGateId,setSelectionGateId]=useState<string|null>(() => new URLSearchParams(window.location.search).get("stationId") ?? readGateSelection(user)?.stationId ?? null);
  const navigationSearch = useSearch();
  const [centerOnMe,setCenterOnMe]=useState(false),[centeringMe,setCenteringMe]=useState(false);
  const [centerError,setCenterError]=useState("");
  const centerRequest=useRef(0);
  const cancelCenterRequest=()=>{centerRequest.current++;setCenteringMe(false);setCenterError("");};
  const [styleKind, setStyleKind] = useState<"satellite" | "street">("street");
  const [showSiteLocations, setShowSiteLocations] = useState(true);
  const [showLinks,setShowLinks]=useState(true);
  const [darkMode,setDarkMode]=useState(true);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [revealOpen,setRevealOpen]=useState(false),[revealedStaffIds,setRevealedStaffIds]=useState<number[]|null>(null);
  const [staffVisible,setStaffVisible]=useState(false);
  const [equipmentOpen,setEquipmentOpen]=useState(false),[equipmentVisible,setEquipmentVisible]=useState(()=>!!new URLSearchParams(window.location.search).get("equipmentId")),[equipmentIds,setEquipmentIds]=useState<string[]|null>(()=>{const id=new URLSearchParams(window.location.search).get("equipmentId");return id?[id]:null;}),[selectedEquipmentId,setSelectedEquipmentId]=useState<string|null>(()=>new URLSearchParams(window.location.search).get("equipmentId"));
  const [selectedGate, setSelectedGate] = useState<string | null>(selectionGateId);
  const [focusedGateId, setFocusedGateId] = useState<string | null>(selectionGateId);
  const [focusedStaffId, setFocusedStaffId] = useState<number | null>(null);
  const [cameraRevision, requestCameraRevision] = useState(0);
  const sharedStationId = sharedSelection?.stationId;
  useEffect(() => {
    if (!sharedStationId || sharedStationId === selectionGateId) return;
    setSelectionGateId(sharedStationId);
    setSelectedGate(sharedStationId);
    setFocusedGateId(sharedStationId);
    setFocusedStaffId(null);
    requestCameraRevision(value => value + 1);
  }, [sharedStationId]);
  const requestedStationId = new URLSearchParams(navigationSearch).get("stationId");
  useEffect(() => {
    if (!requestedStationId) return;
    setSelectionGateId(requestedStationId);
    setSelectedGate(requestedStationId);
    setFocusedGateId(requestedStationId);
    setFocusedStaffId(null);
    requestCameraRevision(value => value + 1);
  }, [requestedStationId]);
  const [activityGateId, setActivityGateId] = useState<string | null>(null);
  const [activityVisit, setActivityVisit] = useState(0);
  const pinnedActivity = useRef(false), leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepActivity = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  const closeActivity = () => { keepActivity(); pinnedActivity.current = false; setActivityGateId(null); };
  const selectMapGate = (gateId: string) => { setSelectedEquipmentId(null); setEquipmentIds(null); closeActivity(); cancelCenterRequest(); setCenterOnMe(false); setSelectionGateId(gateId || null); requestCameraRevision(value => value + 1); setSelectedPinId(null); setFocusedGateId(gateId || null); setSelectedGate(gateId || null); setFocusedStaffId(null); };
  useEffect(() => {
    const receiveNativeSelection = (event: Event) => {
      const gateId = (event as CustomEvent<unknown>).detail;
      if (typeof gateId === "string") selectMapGate(gateId);
    };
    window.addEventListener("gate-native-map-selection", receiveNativeSelection);
    return () => window.removeEventListener("gate-native-map-selection", receiveNativeSelection);
  });
  const leaveActivity = () => { keepActivity(); if (!pinnedActivity.current) leaveTimer.current = setTimeout(() => setActivityGateId(null), 250); };
  const openActivity = (gateId: string, pinned: boolean) => {
    keepActivity(); cancelCenterRequest(); setSelectedPinId(null); setCenterOnMe(false);
    if (pinnedActivity.current && !pinned) return;
    pinnedActivity.current = pinned;
    setActivityGateId(gateId); setActivityVisit(value => value + 1);
  };
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  const [expanded, setExpanded] = useState(false);
  const iosView = new URLSearchParams(window.location.search).get("gateDevice") === "ios" || /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const closeExpanded = () => setExpanded(false);
  const toggleExpanded = () => setExpanded(value => !value);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") closeExpanded(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [expanded]);
  const [at, setAt] = useState("");
  const instant = at || null;
  useEffect(() => {
    const setNativeTime = (event: Event) => {
      const value = (event as CustomEvent<string | null>).detail;
      if (value === null || typeof value === "string" && !Number.isNaN(Date.parse(value))) setAt(value ?? "");
    };
    window.addEventListener("gate-native-map-time", setNativeTime);
    return () => window.removeEventListener("gate-native-map-time", setNativeTime);
  }, []);
  const coverage = useQuery({
    queryKey: ["gate-coverage-map", user?.userId, user?.activeMembershipId, instant],
    queryFn: () => changeOverRequest<Coverage>(`/coverage-map${instant ? `?at=${encodeURIComponent(instant)}` : ""}`),
    enabled: !!user?.vendorId,
    retry: false,
    refetchInterval: instant ? false : 30000,
  });
  const gateLocations = useQuery({
    queryKey: ["gate-map-locations", user?.userId, user?.activeMembershipId],
    queryFn: () => changeOverRequest<{ gates: Coverage["gates"] }>("/map"),
    enabled: !!user?.vendorId && !instant,
    retry: false,
    staleTime: 30000,
  });
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; pinId?: string }>).detail;
      if (detail?.action === "close") { setEditingPin(null); setDraftPin(null); }
      if (detail?.action === "saved" && typeof detail.pinId === "string") {
        setEditingPin(null); setDraftPin(null); setSelectedPinId(detail.pinId);
        requestCameraRevision(value => value + 1);
        void coverage.refetch();
      }
    };
    window.addEventListener("gate-native-map-pin-flyout", receive);
    return () => window.removeEventListener("gate-native-map-pin-flyout", receive);
  }, [coverage.refetch]);
  const equipmentQuery=useQuery({queryKey:["equipment",user?.userId,user?.vendorId,user?.activeMembershipId],queryFn:async({signal})=>EquipmentListResponseSchema.parse(await equipmentRequest("",{signal})),enabled:!!user?.vendorId&&!instant,retry:false,refetchInterval:instant?false:30000});
  const equipment=equipmentQuery.data?.equipment??[];
  const trackedEquipment=equipment.filter(item=>item.profile.trackOnMap&&!['retired','merged'].includes(item.status));
  const revealEquipment=(items:EquipmentItem[])=>{if(instant)return;const located=items.filter(item=>item.location&&item.profile.trackOnMap);if(!located.length)return;setEquipmentOpen(false);setEquipmentVisible(true);setEquipmentIds(located.map(item=>item.id));setSelectedEquipmentId(located.length===1?located[0].id:null);setRevealOpen(false);closeActivity();cancelCenterRequest();setCenterOnMe(false);setSelectedPinId(null);setSelectedGate(null);setFocusedGateId(null);setFocusedStaffId(null);requestCameraRevision(value=>value+1);};
  const gates = useMemo(() => (coverage.data?.gates ?? gateLocations.data?.gates ?? []).filter(gate => !allowedSiteIds || allowedSiteIds.includes(gate.siteId)), [coverage.data?.gates, gateLocations.data?.gates, allowedSiteIds]);
  const physicalLines=gates.flatMap(g=>{const parent=gates.find(p=>p.id===g.topology?.parentGateId);return parent&&g.latitude!=null&&g.longitude!=null&&parent.latitude!=null&&parent.longitude!=null?[{id:`physical:${g.id}`,coordinates:[[parent.latitude,parent.longitude],[g.latitude,g.longitude]] as Array<[number,number]>,color:brand.primary,width:3}]:[];});
  const linkedLines=useMemo(()=>gateMapLinkLines(gates,brand.primary),[gates,brand.primary]);
  const sites = [...new Map(gates.map(gate => [gate.siteId, { id: gate.siteId, name: gate.siteName, partnerName: gate.partnerName }])).values()];
  const focusedGate = gates.find(gate => gate.id === focusedGateId);
  const selectionGate = gates.find(gate => gate.id === selectionGateId);
  useEffect(() => {
    // Persist only an authorized gate returned by this account's map endpoint.
    if (selectionGate && !instant) saveGateSelection(user, selectionGate.siteId, selectionGate.id);
  }, [selectionGate?.id, selectionGate?.siteId, instant, user?.userId, user?.activeMembershipId]);
  const duties = coverage.data?.duties ?? [];
  const staff = [...(coverage.data?.staff ?? [])].sort((a,b) => a.name.localeCompare(b.name, es ? "es" : "en", { sensitivity: "base" }) || a.userId-b.userId);
  const onWatch = (person: Coverage["staff"][number]) => person.onWatch || duties.some(duty => duty.userId === person.userId);
  const mapRequest = new URLSearchParams(navigationSearch);
  const requestedStaffId = Number(mapRequest.get("staffUserId")) || null;
  const requestedEquipmentId = mapRequest.get("equipmentId");
  const requestedReveal = mapRequest.get("reveal");
  const appliedMapRequest = useRef("");
  useEffect(() => {
    const key = JSON.stringify([user?.userId, user?.activeMembershipId, navigationSearch]);
    if (appliedMapRequest.current === key) return;
    if (requestedStaffId || requestedReveal === "staff") {
      if (!coverage.isSuccess) return;
      appliedMapRequest.current = key;
      if (requestedStaffId) { const person = staff.find(person => person.userId === requestedStaffId); if (person) focusStaff(person); }
      else revealStaff(staff);
    } else if (requestedEquipmentId || requestedReveal === "equipment") {
      if (!equipmentQuery.isSuccess) return;
      appliedMapRequest.current = key;
      revealEquipment(trackedEquipment.filter(item => !requestedEquipmentId || item.id === requestedEquipmentId));
    } else appliedMapRequest.current = "";
  }, [navigationSearch, coverage.data, equipmentQuery.data, user?.userId, user?.activeMembershipId]);
  const mapTarget = requestedStaffId ? `staff:${requestedStaffId}` : requestedEquipmentId ? `equipment:${requestedEquipmentId}` : requestedReveal ?? "";
  const requestedStaff = requestedStaffId ? staff.filter(person => person.userId === requestedStaffId) : staff;
  const requestedEquipment = requestedEquipmentId ? trackedEquipment.filter(item => item.id === requestedEquipmentId) : trackedEquipment;
  const mapFocusState = requestedStaffId || requestedReveal === "staff"
    ? coverage.isError ? "error" : !coverage.isSuccess ? "loading" : !requestedStaff.some(hasMapLocation) ? "unavailable" : staffVisible && (requestedStaffId ? focusedStaffId === requestedStaffId : revealedStaffIds !== null) ? "displayed" : "loading"
    : requestedEquipmentId || requestedReveal === "equipment"
      ? equipmentQuery.isError ? "error" : !equipmentQuery.isSuccess ? "loading" : instant || !requestedEquipment.some(item => item.location) ? "unavailable" : equipmentVisible && (requestedEquipmentId ? selectedEquipmentId === requestedEquipmentId : equipmentIds !== null) ? "displayed" : "loading"
      : "none";
  const groups = [
    { id: "watch", title: es ? "De guardia" : "On Watch", people: staff.filter(onWatch) },
    { id: "call", title: es ? "Disponible" : "On Call", people: sortGateMapStaff(staff.filter(person => !onWatch(person) && person.onCall), callSort, origin, es ? "es" : "en") },
    { id: "other", title: es ? "Todos los demás" : "Everyone else", people: staff.filter(person => !onWatch(person) && !person.onCall) },
  ];
  const focusStaff = (person: Coverage["staff"][number]) => {
    if (!hasMapLocation(person)) return;
    setSelectedEquipmentId(null);setEquipmentIds(null);setRevealOpen(false);setStaffVisible(true);setRevealedStaffIds([person.userId]);
    closeActivity(); cancelCenterRequest();setCenterOnMe(false); setSelectedPinId(null); setSelectedGate(null); setFocusedGateId(null); setFocusedStaffId(person.userId); requestCameraRevision(value => value + 1);
  };
  const revealStaff=(people:RevealStaffPerson[])=>{
    const current=people.filter(person=>hasMapLocation(person));if(!current.length)return;
    setSelectedEquipmentId(null);setEquipmentIds(null);setRevealOpen(false);setStaffVisible(true);setRevealedStaffIds(current.map(person=>person.userId));
    closeActivity();cancelCenterRequest();setCenterOnMe(false);setSelectedPinId(null);setSelectedGate(null);setFocusedGateId(null);setFocusedStaffId(current.length===1?current[0].userId:null);requestCameraRevision(value=>value+1);
  };
  useEffect(()=>{
    if(callSort!=="nearest"||originRequested.current)return;
    originRequested.current=true;
    if(!navigator.geolocation){setLocationError(es?"GPS no disponible":"Your location is unavailable");return;}
    navigator.geolocation.getCurrentPosition(position=>setOrigin({latitude:position.coords.latitude,longitude:position.coords.longitude}),()=>setLocationError(es?"No se pudo obtener su ubicación; lista por nombre.":"Your location could not be obtained; showing names in order."),{maximumAge:60000,timeout:10000});
  },[callSort,es]);
  const toggleStaffVisibility=()=>{
    setStaffVisible(!staffVisible);
    setFocusedStaffId(null);
    if(!staffVisible)setRevealedStaffIds(null);
  };
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
  useEffect(() => {
    const applyNativeSort = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      if (["name", "nearest", "first", "latest"].includes(value)) sortOnCall(value as StaffSort);
    };
    window.addEventListener("gate-native-map-staff-sort", applyNativeSort);
    return () => window.removeEventListener("gate-native-map-staff-sort", applyNativeSort);
  }, []);
  function recenterMe() {
    setSelectedEquipmentId(null);setEquipmentIds(null);
    if(centeringMe)return;setCenterError("");
    if(!navigator.geolocation){setCenterError(es?"GPS no disponible":"Your location is unavailable");return;}
    setCenteringMe(true);const request=++centerRequest.current;
    navigator.geolocation.getCurrentPosition(position=>{
      if(request!==centerRequest.current)return;
      closeActivity();setOrigin({latitude:position.coords.latitude,longitude:position.coords.longitude});setLocationError("");
      setSelectedPinId(null);setFocusedStaffId(null);setFocusedGateId(null);setSelectedGate(null);setCenterOnMe(true);requestCameraRevision(value=>value+1);setCenteringMe(false);
    },()=>{if(request!==centerRequest.current)return;setCenterError(es?"No se pudo obtener su ubicación.":"Your location could not be obtained.");setCenteringMe(false);},{maximumAge:0,timeout:10000,enableHighAccuracy:true});
  }
  async function changePinRemoval(pinId:string,removed:boolean) {
    if(pinChanging)return; setPinChanging(true);setPinError("");
    try {await changeOverRequest(`/map-pins/${pinId}/removal`,{removed});setSelectedPinId(removed?null:pinId);setRemovedPinId(removed?pinId:null);await coverage.refetch();}
    catch(error){setPinError(error instanceof Error?error.message:"Pin could not be changed");}
    finally{setPinChanging(false);}
  }
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; pinId?: string }>).detail;
      if (!detail || !selectedPin || detail.pinId !== selectedPin.id) return;
      if (detail.action === "close") setSelectedPinId(null);
      else if (!instant && detail.action === "edit") { setEditingPin({pin:selectedPin,latitude:selectedPin.latitude,longitude:selectedPin.longitude}); setMovingPin(null); }
      else if (!instant && detail.action === "move") { setMovingPin(selectedPin); setMovingGate(null); setDropping(false); setSelectedPinId(null); closeActivity(); }
      else if (!instant && detail.action === "remove") void changePinRemoval(selectedPin.id,true);
    };
    window.addEventListener("gate-native-map-pin-detail",receive);
    return () => window.removeEventListener("gate-native-map-pin-detail",receive);
  },[selectedPin,instant,pinChanging]);
  const shownGates = gates;
  const activityGate = gates.find(gate => gate.id === activityGateId);
  const selected = shownGates.find(gate => gate.id === selectedGate);
  const points = [
    ...shownGates.flatMap(gate => {
      const latitude = gate.latitude ?? gate.siteLatitude, longitude = gate.longitude ?? gate.siteLongitude;
      const staffed = duties.some(duty => duty.stationId === gate.id);
      return typeof latitude === "number" && typeof longitude === "number" ? [{ id: `gate:${gate.id}`, latitude, longitude, title: `${gateLocationLabel({ name: gate.siteName, partnerName: gate.partnerName }, gate, gates)} · ${gate.active === false ? es ? "Inactivo" : "Inactive" : !coverage.isSuccess ? es ? "Cargando cobertura" : "Coverage loading" : staffed ? c.staffed : c.unstaffed}`, label: "G", fullLabel: gateLocationLabel({ name: gate.siteName, partnerName: gate.partnerName }, gate, gates), fullLabelMinZoom: 9.9, color: gate.active === false ? "#9ca3af" : brand.primary, onHover: () => openActivity(gate.id, false), onLeave: leaveActivity, onClick: () => { openActivity(gate.id, true); setSelectedEquipmentId(null);setEquipmentIds(null);setSelectedGate(gate.id); setSelectionGateId(gate.id); setFocusedGateId(gate.id); setFocusedStaffId(null); requestCameraRevision(value => value + 1); } }] : [];
    }),
    ...(coverage.data?.staff ?? []).flatMap(person => staffVisible && hasMapLocation(person) && (revealedStaffIds===null||revealedStaffIds.includes(person.userId)) ? [{ id: `staff:${person.userId}`, latitude:person.location!.latitude, longitude:person.location!.longitude, title: `${person.name}${person.demonstration ? " · Sample location" : ""}`, label: "●", fullLabel: person.name, fullLabelMinZoom: 9.9, color: person.onShift ? "#22c55e" : brand.primary, onClick: () => focusStaff(person) }] : []),
  ];
  const vehiclePoints = (coverage.data?.vehicles ?? []).map(vehicle => ({ id: `vehicle:${vehicle.runId}`, latitude: vehicle.latitude, longitude: vehicle.longitude,
    title: `${vehicle.vehicleLabel || "Vehicle"} · ${vehicle.driverName || vehicle.title}`, label: "T", color: brand.primary,
    popupHtml: gateMapVehiclePopup(vehicle, es), popupOnHover: true, popupClassName: "gate-map-vehicle-popup" }));
  const pinPoints = pins.map(pin => ({id:`pin:${pin.id}`,latitude:pin.latitude,longitude:pin.longitude,title:pin.label,label:"P",color:brand.primary,onClick:()=>{closeActivity();cancelCenterRequest();setCenterOnMe(false);setSelectedPinId(pin.id);setSelectedEquipmentId(null);setEquipmentIds(null);setSelectedGate(null);setFocusedGateId(null);setFocusedStaffId(null);requestCameraRevision(value => value + 1);}}));
  const myPoint = centerOnMe && origin ? {id:"my-location",...origin,title:es?"Mi ubicación":"My location",label:"●",color:"#ffffff"} : null;
  const equipmentPoints=!instant&&equipmentVisible?trackedEquipment.flatMap(item=>item.location&&(equipmentIds===null||equipmentIds.includes(item.id))?[{id:`equipment:${item.id}`,latitude:item.location.latitude,longitude:item.location.longitude,title:item.name,label:item.profile.equipmentType==="booth"?"B":item.profile.equipmentType==="trailer"?"T":"E",fullLabel:item.name,fullLabelMinZoom:9.9,color:item.location.freshness==="last_known"?"#9ca3af":brand.primary,onClick:()=>revealEquipment([item])}]:[]):[];
  const selectedEquipment=equipmentVisible&&!instant?trackedEquipment.find(item=>item.id===selectedEquipmentId):undefined;
  const allPoints = [...points, ...equipmentPoints, ...vehiclePoints, ...pinPoints,...(myPoint?[myPoint]:[])];
  const nativeMapPoints = allPoints.map(point => ({ id:point.id, latitude:point.latitude, longitude:point.longitude, title:point.title, label:point.label, color:point.color, fullLabel:"fullLabel" in point ? point.fullLabel : undefined }));
  const nativeMapFitPoints = (equipmentVisible&&equipmentIds!==null&&!instant?equipmentPoints:points.filter(point=>point.id.startsWith(!staffVisible||revealedStaffIds===null?"gate:":"staff:"))).map(point => ({ id:point.id, latitude:point.latitude, longitude:point.longitude, title:point.title, label:point.label, color:point.color }));
  const nativeMapLines = [...(showLinks?linkedLines:[]),...physicalLines];
  const nativeMapCircles = gateMapSiteBoundaryCircles(gates,brand.primary);
  const selectedPointId = selectedEquipment ? `equipment:${selectedEquipment.id}` : myPoint ? myPoint.id : selectedPin ? `pin:${selectedPin.id}` : focusedStaffId != null ? `staff:${focusedStaffId}` : selected ? `gate:${selected.id}` : null;
  const focusedPoint = (selectedEquipment ? equipmentPoints.find(point=>point.id===`equipment:${selectedEquipment.id}`):undefined) ?? myPoint ?? allPoints.find(point => point.id === (selectedPin ? `pin:${selectedPin.id}` : focusedStaffId != null ? `staff:${focusedStaffId}` : `gate:${focusedGateId}`));
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; id?: string; latitude?: number; longitude?: number }>).detail;
      if (!detail || typeof detail.action !== "string") return;
      const latitude = detail.latitude, longitude = detail.longitude;
      const validLocation = typeof latitude === "number" && Number.isFinite(latitude) && Math.abs(latitude) <= 90 && typeof longitude === "number" && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
      if (detail.action === "point" && typeof detail.id === "string") {
        const id = detail.id;
        if (id.startsWith("gate:")) { const gate = gates.find(row => `gate:${row.id}` === id); if (!gate) return; openActivity(gate.id,true); setSelectedEquipmentId(null);setEquipmentIds(null);setSelectedGate(gate.id);setSelectionGateId(gate.id);setFocusedGateId(gate.id);setFocusedStaffId(null);requestCameraRevision(value=>value+1); }
        else if (id.startsWith("staff:")) { const person = staff.find(row => `staff:${row.userId}` === id); if (person && staffVisible && hasMapLocation(person)) focusStaff(person); }
        else if (id.startsWith("equipment:")) { const item = trackedEquipment.find(row => `equipment:${row.id}` === id); if (item && equipmentVisible && !instant) revealEquipment([item]); }
        else if (id.startsWith("pin:")) { const pin = pins.find(row => `pin:${row.id}` === id); if (!pin) return;closeActivity();cancelCenterRequest();setCenterOnMe(false);setSelectedPinId(pin.id);setSelectedEquipmentId(null);setEquipmentIds(null);setSelectedGate(null);setFocusedGateId(null);setFocusedStaffId(null);requestCameraRevision(value=>value+1); }
      } else if (detail.action === "tap" && validLocation) {
        if (droppingGate && managementSites.length && !instant) {setGateDraft({latitude,longitude,siteId:selectionGate?.siteId && managementSites.some(s=>s.id===selectionGate.siteId)?selectionGate.siteId:managementSites[0]?.id});setDroppingGate(false);closeExpanded();}
        else if (movingPin) placeMovedPin(latitude,longitude);
        else if (movingGate) {const gate=gates.find(row=>row.id===movingGate);setGateDraft({latitude,longitude,gateId:movingGate,siteId:gate?.siteId});setMovingGate(null);closeExpanded();}
        else if (dropping && !instant) {setDraftPin({latitude,longitude});setDropping(false);setExpanded(false);}
      } else if (detail.action === "drag" && validLocation && typeof detail.id === "string") {
        if (movingPin && detail.id === `pin:${movingPin.id}`) placeMovedPin(latitude,longitude);
        else if (movingGate && detail.id === `gate:${movingGate}`) {const gate=gates.find(row=>row.id===movingGate);setGateDraft({latitude,longitude,gateId:movingGate,siteId:gate?.siteId});setMovingGate(null);closeExpanded();}
      } else if (detail.action === "longpress" && validLocation && !instant && managementSites.length) {
        setGateDraft({latitude,longitude,siteId:selectionGate?.siteId??managementSites[0]?.id});closeExpanded();
      }
    };
    window.addEventListener("gate-native-map-action",receive);
    return () => window.removeEventListener("gate-native-map-action",receive);
  }, [droppingGate,dropping,movingPin,movingGate,instant,managementSites,selectionGate,gates,staff,staffVisible,equipmentVisible,trackedEquipment,pins]);
  const helper = useNextSteps();
  const guideContext = { siteId: selectionGate?.siteId ?? helper?.selected?.context?.siteId, stationId: selectionGate?.id ?? helper?.selected?.context?.stationId, siteName: selectionGate?.siteName, stationName: selectionGate?.name };
  const scopeId = gateGuideScope("map", guideContext);
  const guided = gateGuideMatches(helper?.selected, "gate-map-and-log", guideContext);
  useGuidedTarget({ scopeId, targetId: showActivityFooter && selectionGate ? "open-log" : "choose-gate", prompt: showActivityFooter && selectionGate ? "Read the last gate-confirmed location separately from intended destination, then open this gate's recorded log. Map positions are not live vehicle GPS." : "Choose the gate to inspect its saved locations and movements." }, guided && coverage.isSuccess && (showActivityFooter || !selectionGate), 25);
  useCardNextSteps({
    choices: [
      { id: "staff", title: "Reveal staff", prepare: () => { setRevealOpen(true); setEquipmentOpen(false); setSettingsOpen(false); } },
      { id: "equipment", title: "Reveal equipment", prepare: () => { setRevealOpen(false); setEquipmentOpen(true); setSettingsOpen(false); } },
      { id: "controls", title: "Use map controls", prepare: () => { setRevealOpen(false); setEquipmentOpen(false); setSettingsOpen(true); } },
    ],
    card: "gate-map", task: revealOpen ? "staff" : equipmentOpen ? "equipment" : "controls", scope: scopeId,
    enabled: Boolean(user?.vendorId) && coverage.isSuccess,
    title: revealOpen ? "Reveal staff" : equipmentOpen ? "Reveal equipment" : "Use the Gate Map",
    steps: revealOpen ? ["Use SHOW to reveal staff locations, or HIDE to hide them.", "Expand a group and use its location control to focus the available people. Use All to include everyone.", "Only current, shared locations can be pinned. On Shift alone does not provide GPS. Staff without a current location remain in the list."] : equipmentOpen ? ["Use SHOW to reveal tracked equipment, or HIDE to hide it.", "Choose a category or item to focus its recorded location. Equipment must be configured for map tracking and have a recorded location.", "Check whether the position is current or last known. A last-known position is not proof that equipment is still there."] : ["Use Site | Gate to select a gate, or All for the full coverage view.", "The people and equipment icons open Reveal Staff and Reveal Equipment. SHOW/HIDE controls their pins.", "Settings controls map layers. Center on Me requests your device GPS. Fit to coverage returns to the full view.", "The expand control enlarges the map. In Live mode staff and equipment refresh every 30 seconds; Day of shows a historical snapshot. Vehicle records are gate-confirmed positions, not continuous vehicle GPS."],
    target: instant || coverage.isError ? null : revealOpen ? "staff-visibility" : equipmentOpen ? "equipment-visibility" : "map-settings",
    prompt: instant ? "Historical view is selected. Return to Live for current equipment and automatic updates." : revealOpen ? (staffVisible ? "Staff locations are shown. A person still needs a current shared location to appear." : "Staff locations are hidden. Use SHOW in Reveal Staff.") : equipmentOpen ? (equipmentQuery.isError ? "Equipment could not load. Use Retry in the equipment menu." : equipmentVisible ? "Tracked equipment locations are shown. Read the freshness before relying on a position." : "Equipment locations are hidden. Use SHOW in Reveal Equipment.") : "Choose the map control for your task. Help follows the staff and equipment menus when you open them.",
  });
  if (!user?.vendorId) return null;
  return <section data-askv-map data-map-target={mapTarget} data-focus-state={mapFocusState} data-guidance-scope={scopeId} data-card-layout aria-label="Gate coverage map" data-gate-workspace-panel className="gate-map-compact space-y-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
    {(!expandedHeader || showGateSelector) && <div id="gate-map-header-native-slot" data-sites={JSON.stringify(sites.map(site => ({ id: site.id, name: site.name })))} data-site-id={selectionGate?.siteId ?? 0} data-gate-id={selectionGate?.id ?? ""} data-gate-name={selectionGate?.name ?? ""} data-show-title={!expanded ? "1" : "0"} data-show-selector={showGateSelector ? "1" : "0"} className="gate-map-selector-row">
    {!expanded && <div className="gate-map-title-row flex items-center gap-3"><CardHeading as="h2" className="flex items-center gap-2 text-lg font-semibold"><MapPin aria-hidden="true" className="h-5 w-5 text-[var(--brand-primary)]" />{es ? "Mapa" : "Map"}</CardHeading></div>}
    {showGateSelector && <GateSiteGateSelect sites={sites} siteId={selectionGate?.siteId ?? 0}
      gate={selectionGate} gateOptions={gates} gpsStatus="unavailable" gpsLabel={es ? "GPS no evaluado en este mapa" : "GPS not evaluated on this map"} allOptionLabel={c.all} testId="select-gate-map-location"
      onChange={(_siteId, gateId) => selectMapGate(gateId)} />}

    </div>}
    <MapViewport expanded={expanded} onExitFullscreen={closeExpanded}><div style={{ "--brand-primary": brand.primary } as React.CSSProperties} className={expanded ? "gate-map-fullscreen" : "space-y-3"}>
      {expanded && expandedHeader?.(closeExpanded)}
      <div id="gate-map-time-native-slot" data-instant={instant ?? ""} data-live-connected={coverage.isSuccess && coverage.fetchStatus !== "paused" ? "1" : "0"}>
        <GateMapTimeControl instant={instant} onChange={value => setAt(value ?? "")} liveConnected={coverage.isSuccess && coverage.fetchStatus !== "paused"} es={Boolean(es)} clockAction={<button type="button" className="gate-map-control gate-map-icon-control gate-map-refresh" aria-label={c.refresh} title={c.refresh} disabled={coverage.isFetching} onClick={() => void coverage.refetch()}><RefreshCw aria-hidden="true" /></button>} />
      </div>
      {centerError && <p data-gate-map-status-native-slot data-native-map-status-id="center-error" role="status">{centerError}</p>}
      {pinError && <p data-gate-map-status-native-slot data-native-map-status-id="pin-error" role="alert">{pinError}</p>}
      {movingPin && <p data-gate-map-status-native-slot data-native-map-status-id="moving-pin" role="status">{es ? "Arrastre el pin o toque su nueva ubicación; después guarde el cambio." : "Drag the dropped pin or click its new location, then save the change."} <button type="button" className="gate-history-filter" onClick={()=>{setSelectedPinId(movingPin.id);setMovingPin(null);}}>{es ? "Cancelar" : "Cancel move"}</button></p>}
      {removedPinId && <p data-gate-map-status-native-slot data-native-map-status-id="removed-pin" role="status" className="gate-map-pin-undo">{es ? "Pin eliminado." : "Pin removed."} <button type="button" disabled={pinChanging} onClick={()=>void changePinRemoval(removedPinId,false)}>{es ? "Deshacer" : "Undo"}</button></p>}
      {droppingGate && <p data-gate-map-status-native-slot data-native-map-status-id="dropping-gate" role="status">{es ? "Toque una vez para colocar el acceso. Puede mover y ampliar el mapa." : "Tap once to place the gate. You can still pan and zoom."} <button type="button" className="gate-history-filter" onClick={() => setDroppingGate(false)}>{es ? "Cancelar" : "Cancel"}</button></p>}
      {dropping && <p data-gate-map-status-native-slot data-native-map-status-id="dropping-pin" role="status" className="text-xs">{es ? "Toque el mapa para ubicar el pin." : "Click or tap the map to place your pin."}</p>}
      {!iosMap&&!instant&&!!managementSites.length&&<p className="text-xs text-muted-foreground">{movingGate?(es?'Arrastre el pin del acceso o toque su nueva ubicación.':'Drag the gate pin or click its new location.'):es?'Clic derecho o pulsación prolongada para crear o administrar un acceso.':'Right-click or long-press the map to create or manage a gate.'}{movingGate&&<button className="ml-3 text-[var(--brand-primary)]" onClick={()=>setMovingGate(null)}>{es?'Cancelar movimiento':'Cancel move'}</button>}</p>}
      {coverage.isPending && <p data-gate-map-status-native-slot data-native-map-status-id="coverage-loading" role="status" className="text-xs">{es ? "Cargando detalles de cobertura…" : "Loading coverage details…"}</p>}
      {coverage.isError && <p data-gate-map-status-native-slot data-native-map-status-id="coverage-error" role="alert" className="text-xs">{es ? "No se pudo cargar la cobertura de accesos. Actualice para volver a intentarlo." : "Gate coverage could not be loaded. Refresh to try again."} <button type="button" className="gate-history-filter" onClick={() => void coverage.refetch()}>{es ? "Reintentar" : "Retry"}</button></p>}
        <div id="gate-map-canvas-native-slot" data-points={JSON.stringify(nativeMapPoints)} data-fit-points={JSON.stringify(nativeMapFitPoints)} data-lines={JSON.stringify(nativeMapLines)} data-circles={JSON.stringify(nativeMapCircles)} data-selected-point-id={selectedPointId ?? ""} data-pin-detail={selectedPin ? JSON.stringify({ id:selectedPin.id,label:selectedPin.label,notes:selectedPin.notes,latitude:selectedPin.latitude,longitude:selectedPin.longitude,createdAt:selectedPin.createdAt,historical:!!instant,pending:pinChanging,error:pinError,es:!!es }) : ""} data-center={JSON.stringify(focusedPoint ? [focusedPoint.longitude,focusedPoint.latitude] : null)} data-style-kind={styleKind === "street" ? darkMode ? "dark" : "street" : "satellite"} data-camera-revision={cameraRevision} data-expanded={expanded ? "1" : "0"} data-instant={instant ?? ""} data-show-links={showLinks ? "1" : "0"} data-show-site-locations={showSiteLocations ? "1" : "0"} data-staff-visible={staffVisible ? "1" : "0"} data-equipment-visible={equipmentVisible ? "1" : "0"} data-settings-open={settingsOpen ? "1" : "0"} data-reveal-open={revealOpen ? "1" : "0"} data-equipment-open={equipmentOpen ? "1" : "0"} data-dropping-gate={droppingGate ? "1" : "0"} data-dropping-pin={dropping ? "1" : "0"} data-moving-point-id={movingPin ? `pin:${movingPin.id}` : movingGate ? `gate:${movingGate}` : ""} data-management-allowed={managementSites.length ? "1" : "0"} data-site-available={sites.length ? "1" : "0"} data-web-detail-open="0" data-es={es ? "1" : "0"} className="gate-map-frame overflow-hidden rounded-xl border-2 border-[color:var(--brand-primary)]">
          <MapboxMap showSiteLocations={showSiteLocations} className={`gate-map-canvas${darkMode ? " is-dark-mode" : ""}${iosView ? " is-ios-map" : ""}`} customZoomControls topControls={<>{settingsOpen && <MapLayerControls id="gate-map-settings" es={Boolean(es)} showLinks={showLinks} onToggleLinks={()=>setShowLinks(value=>!value)} showSiteLocations={showSiteLocations} onToggleSiteLocations={()=>setShowSiteLocations(value=>!value)} satellite={styleKind === "satellite"} onToggleSatellite={()=>setStyleKind(value=>value === "street" ? "satellite" : "street")} dark={darkMode} onToggleDark={()=>setDarkMode(value=>!value)} />}{revealOpen&&<GateMapRevealStaff people={staff} es={Boolean(es)} staffVisible={staffVisible} onToggleVisibility={toggleStaffVisibility} onReveal={revealStaff} onClose={()=>setRevealOpen(false)}/>} {equipmentOpen&&<GateMapRevealEquipment items={trackedEquipment} visible={equipmentVisible} es={Boolean(es)} historical={!!instant} error={equipmentQuery.isError?equipmentQuery.error.message:undefined} onRetry={()=>void equipmentQuery.refetch()} onToggle={()=>{setEquipmentVisible(!equipmentVisible);setEquipmentIds(null);setSelectedEquipmentId(null);}} onReveal={revealEquipment} onClose={()=>setEquipmentOpen(false)}/>}</>} lines={[...(showLinks?linkedLines:[]),...physicalLines]} circles={gateMapSiteBoundaryCircles(gates,brand.primary)} bottomControls={<>
          <div className="gate-map-control-group gate-map-settings-control"><button type="button" className="gate-map-plain-control" aria-label={es?"Configuración del mapa":"Map settings"} title={es?"Configuración del mapa":"Map settings"} data-guidance-id="map-settings" aria-controls="gate-map-settings" aria-expanded={settingsOpen} onClick={()=>{setRevealOpen(false);setEquipmentOpen(false);setSettingsOpen(value=>!value);}}><Settings aria-hidden="true" /></button><button type="button" data-map-reveal-toggle className="gate-map-plain-control" aria-label={es?"Mostrar personal":"Reveal Staff"} title={es?"Mostrar personal":"Reveal Staff"} aria-expanded={revealOpen} onClick={()=>{setEquipmentOpen(false);setSettingsOpen(false);setRevealOpen(value=>!value);}}><Users aria-hidden="true"/></button><button type="button" data-map-equipment-toggle className="gate-map-plain-control" aria-label={es?"Mostrar equipos":"Reveal Equipment"} title={es?"Mostrar equipos":"Reveal Equipment"} aria-expanded={equipmentOpen} onClick={()=>{setSettingsOpen(false);setRevealOpen(false);setEquipmentOpen(value=>!value);}}><Package aria-hidden="true"/></button></div>
          <div className="gate-map-tool-center">{!instant && managementSites.length > 0 && <button type="button" className="gate-map-plain-control" aria-label={es ? "Colocar acceso" : "Drop Gate"} title={es ? "Colocar acceso" : "Drop Gate"} aria-pressed={droppingGate} style={droppingGate ? { color: brand.primary, outline: `2px solid ${brand.primary}`, borderRadius: 6 } : undefined} onClick={() => { closeActivity(); setMovingGate(null); setMovingPin(null); setDropping(false); setDroppingGate(value => !value); }}><MapPin aria-hidden="true" /></button>}<button type="button" className="gate-map-plain-control" aria-label={es?"Centrar en mí":"Center on Me"} title={es?"Centrar en mí":"Center on Me"} disabled={centeringMe} onClick={recenterMe}><LocateFixed aria-hidden="true" /></button>{!instant && sites.length > 0 && <button type="button" className="gate-map-plain-control" aria-label={es ? "Agregar pin" : "Drop Pin"} title={es ? "Agregar pin" : "Drop Pin"} aria-pressed={dropping} onClick={()=>{closeActivity();setSelectedPinId(null);setDroppingGate(false);setDropping(value=>!value);}}><MapPinned aria-hidden="true" /></button>}</div>
          <div className="gate-map-control-group gate-map-view-controls" role="group" aria-label="Map view">
            <button type="button" className="gate-map-plain-control" aria-label={expanded ? c.close : c.expand} title={expanded ? c.close : c.expand} aria-pressed={expanded} onClick={toggleExpanded}>{expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
            <button type="button" className="gate-map-plain-control" aria-label={c.fit} title={c.fit} onClick={() => { setSelectedEquipmentId(null);setEquipmentIds(null);setRevealedStaffIds(null);closeActivity(); cancelCenterRequest();setCenterOnMe(false);setSelectionGateId(null); setFocusedGateId(null); setSelectedGate(null); setFocusedStaffId(null); setSelectedPinId(null); requestCameraRevision(value => value + 1); }}><Scan aria-hidden="true" /></button>
          </div>
          </>} cameraRevision={cameraRevision} points={allPoints} fitPoints={equipmentVisible&&equipmentIds!==null&&!instant?equipmentPoints:points.filter(point=>point.id.startsWith(!staffVisible||revealedStaffIds===null?"gate:":"staff:"))} selectedPointId={selectedPointId} panToSelectedPoint enhancedStreetContrast styleKind={styleKind === "street" ? darkMode ? "dark" : "street" : "satellite"}
            onMapContext={!iosMap&&!instant&&managementSites.length?(latitude,longitude,pointId)=>{const gate=gates.find(g=>`gate:${g.id}`===pointId);if(gate&&!managementSites.some(s=>s.id===gate.siteId))return;setGateDraft({latitude:gate?.latitude??latitude,longitude:gate?.longitude??longitude,gateId:gate?.id,siteId:gate?.siteId??selectionGate?.siteId??managementSites[0]?.id});closeExpanded();}:undefined}
            draggablePointId={movingPin ? `pin:${movingPin.id}` : movingGate?`gate:${movingGate}`:undefined}
            onPointDrag={movingPin ? (id,latitude,longitude)=>{if(id===`pin:${movingPin.id}`)placeMovedPin(latitude,longitude);} : movingGate?(id,latitude,longitude)=>{if(id!==`gate:${movingGate}`)return;const gate=gates.find(g=>g.id===movingGate);setGateDraft({latitude,longitude,gateId:movingGate,siteId:gate?.siteId});setMovingGate(null);closeExpanded();}:undefined}
            onMapClick={droppingGate ? (latitude,longitude)=>{setGateDraft({latitude,longitude,siteId:selectionGate?.siteId && managementSites.some(s=>s.id===selectionGate.siteId) ? selectionGate.siteId : managementSites[0]?.id});setDroppingGate(false);closeExpanded();} : movingPin ? placeMovedPin : movingGate?(latitude,longitude)=>{const gate=gates.find(g=>g.id===movingGate);setGateDraft({latitude,longitude,gateId:movingGate,siteId:gate?.siteId});setMovingGate(null);closeExpanded();}:dropping ? (latitude,longitude)=>{setDraftPin({latitude,longitude});setDropping(false);setExpanded(false);} : undefined}
            anchoredPopup={selectedEquipment ? {pointId:`equipment:${selectedEquipment.id}`,className:"gate-map-activity-popup",maxWidth:"344px",onClose:()=>setSelectedEquipmentId(null),content:<EquipmentMapDetails item={selectedEquipment} items={equipment} es={Boolean(es)}/>} : selectedPin ? {pointId:`pin:${selectedPin.id}`,className:"gate-map-activity-popup",maxWidth:"344px",onClose:()=>setSelectedPinId(null),content:<section data-card-layout className="gate-map-activity-card"><CardHeading as="h3"><MapPin aria-hidden="true" />{selectedPin.label}</CardHeading><p>{selectedPin.latitude.toFixed(6)}, {selectedPin.longitude.toFixed(6)}</p>{selectedPin.notes && <p className="gate-map-pin-notes">{selectedPin.notes}</p>}<p>{new Date(selectedPin.createdAt).toLocaleString()}</p>{!instant && <div className="flex flex-wrap gap-2 my-2"><button type="button" className="gate-history-filter" onClick={()=>{setEditingPin({pin:selectedPin,latitude:selectedPin.latitude,longitude:selectedPin.longitude});setMovingPin(null);}}>{es ? "Editar detalles" : "Edit Details"}</button><button type="button" className="gate-history-filter" onClick={()=>{setMovingPin(selectedPin);setMovingGate(null);setDropping(false);setSelectedPinId(null);closeActivity();}}>{es ? "Recoger y mover" : "Pick-Up & Move"}</button></div>}<GateMapDirections latitude={selectedPin.latitude} longitude={selectedPin.longitude} es={Boolean(es)} />{!instant&&<GateMapPinShare key={selectedPin.id} pinId={selectedPin.id} es={Boolean(es)} />}{!instant && <GateMapPinRemoval key={selectedPin.id} es={Boolean(es)} pending={pinChanging} onRemove={()=>changePinRemoval(selectedPin.id,true)} />}{pinError&&<p role="alert">{pinError}</p>}</section>} : activityGate ? { pointId: `gate:${activityGate.id}`, className: "gate-map-activity-popup", maxWidth: "344px", onClose: closeActivity,
              content: <GateMapActivityPopup key={`${activityGate.id}:${activityVisit}`} stationId={activityGate.id} siteId={activityGate.siteId}
                siteName={activityGate.siteName} gateName={activityGate.name} active={activityGate.active} latitude={activityGate.latitude ?? activityGate.siteLatitude} longitude={activityGate.longitude ?? activityGate.siteLongitude} userId={user.userId} membershipId={user.activeMembershipId}
                historical={Boolean(instant)} visit={activityVisit} es={Boolean(es)} onEnter={keepActivity} onLeave={leaveActivity} action={!instant&&managementSites.some(s=>s.id===activityGate.siteId)&&<button className="gate-history-filter mb-2" onClick={()=>{setGateDraft({latitude:activityGate.latitude??activityGate.siteLatitude??0,longitude:activityGate.longitude??activityGate.siteLongitude??0,gateId:activityGate.id,siteId:activityGate.siteId});closeActivity();}}>{es?'Editar / mover acceso':'Edit / Move Gate'}</button>} /> } : undefined}
            center={focusedPoint ? [focusedPoint.longitude, focusedPoint.latitude] : undefined} zoom={focusedPoint ? 16 : 14} fitToData={!focusedPoint} fitPadding={gateMapFitPadding} height={expanded ? "100%" : "var(--gate-map-height, 420px)"} />
        </div>
        {coverage.isSuccess && !allPoints.length && <p data-gate-map-status-native-slot data-native-map-status-id="no-points" role="status">{c.noPoints}</p>}
    </div></MapViewport>
    <>
      {coverage.data?.vehicleFeedUnavailable && <p data-gate-map-status-native-slot data-native-map-status-id="vehicle-feed-error" role="status" className="text-xs text-amber-500">{es ? "No se pudieron cargar algunas ubicaciones de vehículos." : "Some tracked vehicle locations could not be loaded."}</p>}
      {coverage.data?.vehiclesTruncated && <p data-gate-map-status-native-slot data-native-map-status-id="vehicles-truncated" className="text-xs text-muted-foreground">{es ? "Se muestran los primeros vehículos entrantes disponibles." : "Showing the first available tracked inbound vehicles."}</p>}
      <div className="gate-map-rosters">
        <div id="gate-map-staff-native-slot" data-groups={JSON.stringify(groups)} data-location-error={locationError} data-staff-sort={callSort}>
        <WorkspacePanel title={es ? "Ubicaciones del personal" : "Staff locations"} subtitle="" icon={Users}>
          {coverage.isPending && <p role="status" className="pb-3 text-sm text-muted-foreground">{es ? "Cargando ubicaciones del personal…" : "Loading staff locations…"}</p>}
          {coverage.isError && <p role="alert" className="pb-3 text-sm text-muted-foreground">{es ? "Ubicaciones del personal no disponibles." : "Staff locations unavailable."}</p>}
          {groups.map(group => <details key={group.id} data-group={group.id} className="gate-panel-disclosure gate-map-staff-group" open={group.id === "watch" ? true : undefined}>
            <summary>{group.id === "watch" ? <ShieldCheck aria-hidden="true" /> : group.id === "call" ? <Phone aria-hidden="true" /> : <Users aria-hidden="true" />}<span>{group.title}</span>{group.id === "call" && <select className="gate-map-call-sort" aria-label={es ? "Ordenar disponibles" : "Sort On Call"} value={callSort} onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onChange={event=>sortOnCall(event.target.value as StaffSort)}>
              <option value="name">{es ? "Nombre" : "Name"}</option><option value="nearest">{es ? "Más cercano" : "Nearest"}</option><option value="first">{es ? "Primero disponible" : "First on call"}</option><option value="latest">{es ? "Último disponible" : "Latest on call"}</option>
            </select>}<small>{coverage.isPending ? "…" : coverage.isError ? "—" : group.people.length}</small></summary>
            {group.id === "call" && locationError && <p role="status" className="text-xs">{locationError}</p>}
            <ul>{group.people.map(person => <li key={person.userId} className="gate-map-person" data-user-id={person.userId} data-on-shift={person.onShift === true}>
              <button type="button" className="gate-map-staff-link" disabled={!hasMapLocation(person)}
                title={hasMapLocation(person) ? es ? "Ver ubicación en el mapa" : "Show location on map" : es ? "No hay ubicación compartida actual" : "No current shared location"}
                onClick={() => focusStaff(person)}><strong>{person.name}</strong>{group.id !== "call" && <span>{person.assignment} · {person.locationReason.replaceAll("_", " ")}</span>}</button>
              {group.id === "call" && <><div className="gate-map-person-contact">
                {person.phone ? <a href={`tel:${person.phone.replace(/[^+0-9]/g, "")}`}>{person.phone}</a> : <span>{es ? "Sin teléfono" : "No phone"}</span>}<span aria-hidden="true"> · </span>
                {person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : <span>{es ? "Sin correo" : "No email"}</span>}
              </div><button type="button" className="gate-map-person-assignment" disabled={!hasMapLocation(person)} onClick={()=>focusStaff(person)} title={person.assignment}>{person.assignment} · {person.locationReason.replaceAll("_", " ")}{person.location && ` · ${new Date(person.location.capturedAt).toLocaleString()}`}</button></>}
            </li>)}</ul>
            {coverage.isSuccess && !group.people.length && <p className="pb-3 text-xs text-muted-foreground">{es ? "Ningún empleado" : "No employees"}</p>}
          </details>)}
          {coverage.isSuccess && !staff.length && <p className="pb-3 text-sm text-muted-foreground">{es ? "No se devolvieron empleados con la app." : "No app-enabled employees returned."}</p>}
        </WorkspacePanel>
        </div>
        {coverage.isSuccess ? <GateMapActivityPanel gates={gates} selectedGateId={focusedGateId} userId={user.userId} membershipId={user.activeMembershipId} /> : <div id="gate-map-activity-native-slot" data-native-mode="fallback" data-status={coverage.isPending ? es ? "Cargando actividad…" : "Loading activity…" : es ? "Actividad no disponible." : "Activity unavailable."} data-status-tone={coverage.isError ? "error" : "normal"} data-snapshot="" data-history-base-href="/gate/history?range=24h" data-record-history-hrefs="{}" data-show-all-log-link="0"><WorkspacePanel title={es ? "Actividad del acceso" : "Gate activity"} subtitle="" icon={LogIn}><p role="status" className="text-sm text-muted-foreground">{coverage.isPending ? es ? "Cargando actividad…" : "Loading activity…" : es ? "Actividad no disponible." : "Activity unavailable."}</p></WorkspacePanel></div>}
      </div>
    </>
    {showActivityFooter && selectionGate && <>
      {!instant && <GateMovementLocationSummary siteId={selectionGate.siteId} gateId={selectionGate.id} />}
      <div className="text-sm"><a data-guidance-id="open-log" className="gate-log-text-link" href={`/gate/history?${new URLSearchParams({ siteId: String(selectionGate.siteId), stationId: selectionGate.id, recordType: "all" })}`}>{es ? "Abrir registro de este acceso" : "Open this gate’s recorded log"}</a></div>
    </>}
    {siteList}
    {editingPin && <GateMapPinFlyout pin={editingPin.pin} latitude={editingPin.latitude} longitude={editingPin.longitude} siteId={editingPin.pin.siteId} sites={sites} es={Boolean(es)} onClose={()=>setEditingPin(null)} onSaved={pin=>{setEditingPin(null);setSelectedPinId(pin.id);requestCameraRevision(value => value + 1);void coverage.refetch();}} />}
    {draftPin && <GateMapPinFlyout {...draftPin} siteId={focusedGate?.siteId ?? sites[0]?.id ?? 0} sites={sites} es={Boolean(es)} onClose={()=>setDraftPin(null)} onSaved={pin=>{setDraftPin(null);setSelectedPinId(pin.id);requestCameraRevision(value => value + 1);void coverage.refetch();}} />}
    {gateDraft&&<Dialog.Root open onOpenChange={open=>{if(!open)setGateDraft(null);}}><VendorEditFlyout className="gate-administration-flyout" title={gateDraft.gateId?(es?'Administrar acceso':'Manage Gate'):(es?'Crear acceso aquí':'Create Gate Here')} logoSrc={brand.logoSquareUrl||brand.logoUrl||undefined} logoAlt={`${brand.name} logo`} onClose={()=>setGateDraft(null)}>
      <div id="gate-map-gate-native-slot" data-native-authorized={managementSites.length ? "1" : "0"} data-gate-id={gateDraft.gateId ?? ""}>
        {gateDraft.gateId&&<button className="gate-history-filter mb-3" onClick={()=>{setMovingGate(gateDraft.gateId!);setGateDraft(null);}}>{es?'Mover pin en el mapa':'Move pin on map'}</button>}
        <GateCreateCard allowedSiteIds={manageableSiteIds} initialLocation={{latitude:gateDraft.latitude,longitude:gateDraft.longitude}} initialSiteId={gateDraft.siteId} initialGateId={gateDraft.gateId} onSaved={()=>{setGateDraft(null);void coverage.refetch();}} />
      </div>
    </VendorEditFlyout></Dialog.Root>}
  </section>;
}

