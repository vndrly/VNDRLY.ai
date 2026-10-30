import { CardHeading } from "@/components/ui/card-heading";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapboxMap } from "./mapbox-map";
import { PngPillButton } from "./png-pill-rollover";
import { BrandedSelect } from "./work-hub/chrome";
import { analyzeRoute, routePositionAt, routeTimecode, type RouteReplayPoint, type RouteReplayEvent } from "@/lib/map-route-replay";
export function FleetRouteReplay({ identity, runs }: { identity: string; runs: { id: string; title: string; status: string }[] }) {
  const [runId, setRunId] = useState(""), [offset, setOffset] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const authorizedRun = runs.some(run => run.id === runId);
  useEffect(() => { if (runId && !authorizedRun) { setRunId(""); setPlaying(false); } }, [runId, authorizedRun]);
  const history = useQuery({ queryKey: ["fleet-route-replay", identity, runId], enabled: !!runId && authorizedRun, queryFn: async () => {
    const response = await fetch(`/api/fleet/runs/${encodeURIComponent(runId)}/location-history`, { credentials: "include", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Recorded history unavailable");
    return response.json() as Promise<{ points: RouteReplayPoint[]; events: RouteReplayEvent[]; truncated: boolean }>;
  } });
  const route = useMemo(() => analyzeRoute(history.data?.points ?? []), [history.data]);
  useEffect(() => { setOffset(0); setPlaying(false); }, [runId, history.data]);
  useEffect(() => {
    if (!playing) return;
    let previous = Date.now();
    const timer = setInterval(() => { const now = Date.now(), elapsed = now - previous; previous = now; setOffset(value => Math.min(route.durationMs, value + elapsed * speed)); }, 250);
    return () => clearInterval(timer);
  }, [playing, speed, route.durationMs]);
  useEffect(() => { if (offset >= route.durationMs) setPlaying(false); }, [offset, route.durationMs]);
  const at = (route.startMs ?? 0) + offset, position = routePositionAt(route.points, at);
  return <section data-card-layout aria-label="Fleet recorded route replay" className="space-y-3 rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-4">
    <CardHeading as="h2" className="font-semibold">History &amp; Replay</CardHeading>
    <BrandedSelect aria-label="Replay run" value={runId} onChange={event => setRunId(event.target.value)}><option value="">Select a run</option>{runs.map(run => <option key={run.id} value={run.id}>Replay: {run.title}</option>)}</BrandedSelect>
    {runId && authorizedRun && (history.isPending ? <p role="status">Loading recorded history…</p> : history.isError ? <p role="alert">Recorded history unavailable.</p> : <>
      {history.data?.truncated && <p>History is truncated; this is a partial route.</p>}
      <MapboxMap height={360} fitToData points={position ? [{ id: "replay", latitude: position.latitude, longitude: position.longitude, title: position.interpolated ? "Estimated between recorded samples" : "Recorded sample" }] : []} lines={route.segments.filter(segment => segment.length > 1).map((segment, index) => ({ id: String(index), coordinates: segment.map(point => [point.longitude, point.latitude] as [number, number]) }))} />
      <p>{route.points.length ? new Date(at).toLocaleString() : "No recorded positions"} · {routeTimecode(offset)} / {routeTimecode(route.durationMs)}</p>
      <p>{route.gapCount} recorded gaps · {(route.distanceMeters / 1609.344).toFixed(2)} sampled miles</p>
      {!position && route.points.length > 0 && <p>Location unknown within this recorded gap.</p>}
      <p className="text-xs">Playback displays recorded observations. Lines stop at long gaps; playback does not change run status.</p>
      <input aria-label="Replay time" type="range" min={0} max={route.durationMs} value={offset} disabled={!route.durationMs} onChange={event => { setPlaying(false); setOffset(Number(event.target.value)); }} className="w-full" />
      <div className="flex gap-3"><PngPillButton color="blue" disabled={!route.durationMs} onClick={() => { if (offset >= route.durationMs) setOffset(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</PngPillButton><BrandedSelect aria-label="Replay speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[1, 4, 16].map(value => <option key={value} value={value}>{value}×</option>)}</BrandedSelect></div>
      <ul>{history.data?.events.map(event => <li key={event.id}><button className="underline" onClick={() => { setPlaying(false); setOffset(Math.max(0, Math.min(route.durationMs, Date.parse(event.recordedAt) - (route.startMs ?? 0)))); }}>{event.label} · {new Date(event.recordedAt).toLocaleString()}</button></li>)}</ul>
    </>)}
  </section>;
}
