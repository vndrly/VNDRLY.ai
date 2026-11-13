import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MapPin, Users, Package, Settings, Crosshair, Scan, Maximize2, Minimize2, Map as MapIcon, Satellite, X, LocateFixed } from "lucide-react";
import { MapboxMap, type MapboxPoint } from "./mapbox-map";
import { useBrand } from "@/hooks/use-brand";
import { useIsMobile } from "@/hooks/use-mobile";
import type { SiteVisitSummary } from "./ticket-site-visit-summary-card";
import "./gate-dashboard.css";
import "./ticket-visit-map.css";

export type TicketMapLocation = { id: string; name: string; latitude: number; longitude: number; recordedAt: string; source: string };

export function TicketVisitMap({ data }: { data: SiteVisitSummary }) {
  const { i18n } = useTranslation(), brand = useBrand();
  const mobile = useIsMobile();
  const es = i18n.language.startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [panel, setPanel] = useState<"settings" | "people" | "equipment" | null>(null);
  const [peopleVisible, setPeopleVisible] = useState(false), [equipmentVisible, setEquipmentVisible] = useState(false);
  const [satellite, setSatellite] = useState(false), [dark, setDark] = useState(true);
  const [expanded, setExpanded] = useState(false), [fit, setFit] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [me, setMe] = useState<[number, number] | undefined>(), [locationError, setLocationError] = useState("");
  useEffect(() => {
    if (!expanded) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = old; window.removeEventListener("keydown", close); };
  }, [expanded]);
  const locations = [...(peopleVisible ? data.personLocations ?? [] : []), ...(equipmentVisible ? data.equipment ?? [] : [])];
  const points: MapboxPoint[] = locations.map(p => ({ ...p, color: brand.primary, label: (data.equipment ?? []).some(e => e.id === p.id) ? "E" : "P", title: p.name, onClick: () => { setMe(undefined); setSelected(p.id); } }));
  // A recorded work check-in is the work pin; a configured site is an explicitly labelled fallback.
  const performed = data.people.find(p => p.checkInLatitude != null && p.checkInLongitude != null);
  const work = performed ? { latitude: performed.checkInLatitude!, longitude: performed.checkInLongitude! } : data.site;
  if (work) points.unshift({ id: "ticket", latitude: work.latitude, longitude: work.longitude, color: brand.primary, label: "T", imageUrl: brand.logoSquareUrl || undefined, title: data.site?.name ?? data.trackingNumber, onClick: () => { setMe(undefined); setSelected("ticket"); } });
  const origin = data.roadRoute?.origin;
  if (origin) points.push({ id: "origin", latitude: origin.latitude, longitude: origin.longitude, color: brand.primary, label: "Y", title: origin.name, onClick: () => { setMe(undefined); setSelected("origin"); } });
  const selectedLocation = locations.find(p => p.id === selected);
  const fmtDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString(i18n.language) : "—";
  const field = (label: string, value: string | number | null | undefined) => <div className="ticket-map-detail"><dt>{label}</dt><dd>{value || "—"}</dd></div>;
  const flyout = <section className="gate-map-activity-card ticket-map-flyout">
    <header>{brand.logoSquareUrl && <img src={brand.logoSquareUrl} alt="" />}<h3>{selectedLocation?.name ?? data.trackingNumber}</h3></header>
    {selected === "origin" ? <dl>{field(c("Company / yard", "Empresa / patio"), origin?.name)}{field(c("Road miles to ticket site", "Millas por carretera al sitio"), data.roadDistance?.miles == null ? "—" : `${data.roadDistance.miles} mi`)}</dl> : selected === "ticket" ? <dl>
      {field(c("Site", "Sitio"), data.site?.name)}
      {field(c("Location", "Ubicación"), performed ? c("Recorded work check-in", "Entrada de trabajo registrada") : c("Configured ticket site · no work GPS recorded", "Sitio del ticket · sin GPS de trabajo registrado"))}
      {field(c("Vendor", "Proveedor"), data.details?.vendorName)}
      {field(c("Partner", "Cliente"), data.details?.partnerName)}
      {field(c("Service", "Servicio"), data.details?.workType)}
      {field(c("Status", "Estado"), data.status.replaceAll("_", " "))}
      {field(c("Field phase", "Fase de campo"), data.lifecycleState?.replaceAll("_", " "))}
      {field(c("Description", "Descripción"), data.details?.description)}
      {field(c("Notes", "Notas"), data.details?.notes)}
      {field(c("Workers on ticket", "Personas en el ticket"), String(data.totals.peopleCount))}
      {field(c("Combined worker time", "Tiempo combinado"), `${Math.floor(data.totals.totalOnSiteMinutes / 60)}h ${data.totals.totalOnSiteMinutes % 60}m`)}
      {field(c("Road miles", "Millas por carretera"), data.roadDistance?.miles == null ? "—" : `${data.roadDistance.miles} mi · ${data.roadDistance.originName}`)}
      {field(c("Created", "Creado"), fmtDate(data.details?.createdAt))}
      {field(c("Check in", "Entrada"), fmtDate(data.timeline.checkInTime ?? performed?.checkInAt))}
      {field(c("Finished", "Finalizado"), fmtDate(data.finishedAt))}
      {field("GPS", work ? `${work.latitude.toFixed(6)}, ${work.longitude.toFixed(6)}` : null)}
    </dl> : selectedLocation && <dl>
      {field(c("Position", "Posición"), data.finished ? c("Historical recorded location", "Ubicación histórica registrada") : c("Last recorded location", "Última ubicación registrada"))}
      {field(c("Recorded", "Registrado"), fmtDate(selectedLocation.recordedAt))}
      {field(c("Source", "Fuente"), selectedLocation.source.replaceAll("_", " "))}
      {field("GPS", `${selectedLocation.latitude.toFixed(6)}, ${selectedLocation.longitude.toFixed(6)}`)}
    </dl>}
  </section>;
  const control = (label: string, icon: React.ReactNode, action: () => void, pressed?: boolean) => <button type="button" className="gate-map-plain-control" aria-label={label} title={label} aria-pressed={pressed} onClick={action}>{icon}</button>;
  const revealRows = panel === "equipment" ? data.equipment ?? [] : data.personLocations ?? [];
  const visible = panel === "equipment" ? equipmentVisible : peopleVisible;
  const map = <div className={`ticket-visit-map-frame ${expanded ? "is-expanded" : ""}`} style={{ "--brand-primary": brand.primary } as React.CSSProperties} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined} aria-label={c("Ticket map", "Mapa del ticket")}>
    {expanded && <header className="ticket-map-expanded-heading"><strong>{data.trackingNumber} · {data.site?.name}</strong><button autoFocus type="button" className="vendor-mini-card-button" onClick={() => setExpanded(false)} aria-label={c("Close expanded map", "Cerrar mapa ampliado")}><X /></button></header>}
    <MapboxMap key={`${expanded}:${fit}`} className={`gate-map-canvas ticket-visit-map ${dark ? "is-dark-mode" : ""}`} customZoomControls enhancedStreetContrast
      points={points} lines={data.roadRoute?.coordinates.length ? [{ id: "company-to-ticket-road-route", coordinates: data.roadRoute.coordinates.map(([longitude, latitude]): [number, number] => [latitude, longitude]), color: brand.primary, width: 4, opacity: 0.9 }] : []} height={expanded ? "100%" : "clamp(360px, 56vh, 560px)"} styleKind={satellite ? "satellite" : dark ? "dark" : "street"}
      selectedPointId={selected} panToSelectedPoint fitToData={!me && !selected} fitPadding={{top:90,left:40,right:40,bottom:50}} center={me} zoom={15}
      anchoredPopup={!mobile && selected && points.some(p => p.id === selected) ? { pointId: selected, content: flyout, onClose: () => setSelected(null), className: "gate-map-activity-popup ticket-map-popup", maxWidth: "344px" } : undefined}
      bottomControls={<>
        <div className="gate-map-control-group gate-map-settings-control">
          {control(c("Map settings", "Configuración del mapa"), <Settings />, () => setPanel(panel === "settings" ? null : "settings"), panel === "settings")}
          {control(c("Reveal people", "Mostrar personas"), <Users />, () => setPanel(panel === "people" ? null : "people"), panel === "people")}
          {control(c("Reveal equipment", "Mostrar equipos"), <Package />, () => setPanel(panel === "equipment" ? null : "equipment"), panel === "equipment")}
        </div>
        <div className="gate-map-tool-center">
          {control(c("Center on me", "Centrar en mí"), <LocateFixed />, () => { navigator.geolocation?.getCurrentPosition(p => { setMe([p.coords.longitude, p.coords.latitude]); setSelected(null); setLocationError(""); }, () => setLocationError(c("Device location unavailable", "Ubicación del dispositivo no disponible"))); })}
          {control(c("Center ticket", "Centrar ticket"), <Crosshair />, () => { setMe(undefined); setSelected("ticket"); })}
        </div>
        <div className="gate-map-control-group gate-map-view-controls">
          {control(c(expanded ? "Collapse map" : "Expand map", expanded ? "Contraer mapa" : "Ampliar mapa"), expanded ? <Minimize2 /> : <Maximize2 />, () => setExpanded(!expanded), expanded)}
          {control(c("Fit all locations", "Ver todas las ubicaciones"), <Scan />, () => { setMe(undefined); setSelected(null); setFit(fit + 1); })}
        </div>
      </>}
      topControls={panel && <section className="ticket-map-controls-panel">
        <header><strong>{panel === "settings" ? c("Map settings", "Configuración del mapa") : panel === "people" ? c("People on this ticket", "Personas de este ticket") : c("Equipment on this ticket", "Equipos de este ticket")}</strong><button type="button" aria-label={c("Close controls", "Cerrar controles")} onClick={() => setPanel(null)}><X size={18} /></button></header>
        {panel === "settings" ? <>
          <button type="button" className="vendor-mini-card-button" role="switch" aria-label={c("Map / Satellite", "Mapa / Satélite")} aria-checked={satellite} onClick={() => setSatellite(!satellite)}>{satellite ? <Satellite size={16} /> : <MapIcon size={16} />}{satellite ? c("Satellite", "Satélite") : c("Map", "Mapa")}</button>
          <button type="button" className="vendor-mini-card-button" role="switch" aria-checked={dark} onClick={() => setDark(!dark)}>{c("Dark mode", "Modo oscuro")}</button>
        </> : <>
          <button type="button" className="vendor-mini-card-button" aria-pressed={visible} onClick={() => { if (panel === "equipment") setEquipmentVisible(!visible); else setPeopleVisible(!visible); setSelected(null); setFit(fit + 1); }}>{visible ? c("Hide locations", "Ocultar ubicaciones") : c("Show locations", "Mostrar ubicaciones")}</button>
          <p>{data.finished ? c("Historical locations at completion", "Ubicaciones históricas al finalizar") : c("Last recorded positions · timestamps shown", "Últimas posiciones registradas · con fecha")}</p>
          {!revealRows.length && <p>{c("No ticket-associated GPS locations recorded.", "No hay ubicaciones GPS registradas para este ticket.")}</p>}
          {revealRows.map(p => <button key={p.id} type="button" className="ticket-map-person" onClick={() => { if (panel === "equipment") setEquipmentVisible(true); else setPeopleVisible(true); setMe(undefined); setSelected(p.id); setPanel(null); }}><MapPin size={16} /><span>{p.name}<small>{fmtDate(p.recordedAt)}</small></span></button>)}
        </>}
      </section>}
    />
    {mobile && !panel && selected && points.some(p => p.id === selected) && <div className="ticket-map-mobile-flyout"><button type="button" className="ticket-map-flyout-close" aria-label={c("Close ticket map details", "Cerrar detalles del mapa")} onClick={() => setSelected(null)}><X size={20} /></button>{flyout}</div>}
    {locationError && <p role="status">{locationError}</p>}
    {!work && <p role="status">{c("No recorded work GPS or configured site coordinates.", "No hay GPS de trabajo ni coordenadas del sitio.")}</p>}
  </div>;
  return expanded ? createPortal(map, document.body) : map;
}
