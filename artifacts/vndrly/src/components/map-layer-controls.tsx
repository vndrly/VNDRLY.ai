import { Map as MapIcon, Satellite } from "lucide-react";
import WorkdayStatusSwitch from "./workday-status-switch";

type Props = {
  id?: string; es: boolean;
  showLinks: boolean; onToggleLinks: () => void;
  showSiteLocations: boolean; onToggleSiteLocations: () => void;
  satellite: boolean; onToggleSatellite: () => void;
  dark: boolean; onToggleDark: () => void;
};

/** Shared map settings for Mapping and ticket views. */
export function MapLayerControls(p: Props) {
  const street = p.es ? "Calles" : "Street", satellite = p.es ? "Satélite" : "Satellite";
  return <div id={p.id} className="gate-map-layer-controls" role="group" aria-label={p.es ? "Configuración del mapa" : "Map settings"}>
    <div className="gate-map-layer-toggles">
      <WorkdayStatusSwitch active={p.showLinks} label={p.es ? "Vínculos" : "Links"} onClick={p.onToggleLinks} />
      <WorkdayStatusSwitch active={p.showSiteLocations} label={p.es ? "Ubicaciones de sitios" : "Site Locations"} onClick={p.onToggleSiteLocations} />
      <div className="gate-map-control-group" role="group" aria-label="Map style">
        <button type="button" role="switch" className="gate-map-style-toggle" aria-label={`${street} / ${satellite}`} aria-checked={p.satellite} title={`${street} / ${satellite}: ${p.satellite ? satellite : street}`} onClick={p.onToggleSatellite}>
          <MapIcon aria-hidden="true" className={!p.satellite ? "is-selected" : undefined} /><span className="gate-map-style-track" aria-hidden="true"><span /></span><Satellite aria-hidden="true" className={p.satellite ? "is-selected" : undefined} />
        </button>
      </div>
      <WorkdayStatusSwitch active={p.dark} label={p.es ? "Modo oscuro" : "Dark Mode"} onClick={p.onToggleDark} />
    </div>
  </div>;
}
