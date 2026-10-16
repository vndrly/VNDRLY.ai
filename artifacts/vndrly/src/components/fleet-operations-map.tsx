import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FleetOverview, FleetRun } from "@workspace/api-zod";
import { MapboxMap } from "./mapbox-map";
import { PngPillButton } from "./png-pill-rollover";
import ImagePill from "./image-pill";
import { fleetCopy } from "@/lib/fleet-copy";

export function FleetOperationsMap({ runs, positions, selected, onSelect }: {
  runs: FleetRun[];
  positions: FleetOverview["observations"];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const [style, setStyle] = useState<"satellite" | "street">("street");
  const [includeOld, setIncludeOld] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fit, setFit] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [expanded]);
  const shown = positions.filter(point => includeOld || point.freshness === "recent");
  const oldCount = positions.filter(point => point.freshness !== "recent").length;
  return <section className={`fleet-map-card ${expanded ? "fleet-map-expanded" : ""}`} aria-label={c.map}>
    <div className="fleet-card-heading">
      <div><h2>{c.map}</h2><p>{c.mapSummary}</p></div>
      <ImagePill color="grey">{c.recordedSnapshot}</ImagePill>
    </div>
    <div className="fleet-map-tools" role="group" aria-label={c.mapTools}>
      <PngPillButton aria-pressed={style === "street"} onClick={() => setStyle("street")}>{c.street}</PngPillButton>
      <PngPillButton aria-pressed={style === "satellite"} onClick={() => setStyle("satellite")}>{c.satellite}</PngPillButton>
      <PngPillButton onClick={() => setFit(value => value + 1)}>{c.fitFleet}</PngPillButton>
      <PngPillButton aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? c.collapseMap : c.expandMap}</PngPillButton>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeOld} onChange={event => setIncludeOld(event.target.checked)} />{c.showOld} ({oldCount})</label>
    </div>
    <div className="fleet-map-layout">
      <div className="fleet-map-canvas">
        {shown.length ? <MapboxMap key={fit} height={expanded ? "100%" : 520} styleKind={style} fitToData selectedPointId={selected}
          points={shown.map((point, index) => {
            const run = runs.find(item => item.id === point.runId);
            return { id: point.runId, latitude: point.latitude, longitude: point.longitude,
              label: String(index + 1), color: point.freshness === "recent" ? "#1E5BD0" : "#6b7280",
              title: `${run?.labels?.vehicleName ?? c.vehicle} · ${run?.title ?? ""} · ${point.freshness} · ${new Date(point.recordedAt).toLocaleString(i18n.language)}`,
              onClick: () => { onSelect(point.runId); setExpanded(false); } };
          })} /> : <div className="fleet-map-empty"><h3>{c.noCurrentLocations}</h3><p>{oldCount ? c.oldLocationsHint : c.noLocations}</p></div>}
      </div>
      <div className="fleet-map-roster" aria-label={c.positionRoster}>
        <h3>{c.positionRoster} ({shown.length})</h3>
        <p className="text-xs text-muted-foreground">{c.positionLegend}</p>
        {shown.map((point, index) => {
          const run = runs.find(item => item.id === point.runId);
          return <button key={point.runId} className="fleet-position" aria-pressed={selected === point.runId} onClick={() => { onSelect(point.runId); setExpanded(false); }}>
            <span className="fleet-marker-number">{index + 1}</span><span><strong>{run?.labels?.vehicleName ?? c.vehicle}</strong><span>{run?.labels?.driverName ?? c.driver} · {run?.title}</span><span>{point.freshness === "recent" ? c.recentPosition : c.oldPosition} · {new Date(point.recordedAt).toLocaleString(i18n.language)}</span></span>
          </button>;
        })}
        <p className="text-xs text-muted-foreground">{c.mapHint}</p>
      </div>
    </div>
  </section>;
}
