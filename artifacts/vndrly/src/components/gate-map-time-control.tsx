import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, RotateCcw } from "lucide-react";
import { fleetInstantToWallTime, fleetWallTimeToInstant } from "@workspace/api-zod";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BrandedInput, BrandedSelect } from "@/components/work-hub/chrome";

const CENTRAL = "America/Chicago";
const clockFormat = new Intl.DateTimeFormat("en-US", { timeZone: CENTRAL, month: "2-digit", day: "2-digit", year: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
export const formatGateMapTime = (instant: string | number) => `${clockFormat.format(new Date(instant))} CT`;

/** Keep the ticking clock isolated: it never rerenders the map or changes its query key. */
export function GateMapTimeControl({ instant, onChange, liveConnected, children, es = false }: {
  instant: string | null; onChange: (instant: string | null) => void;
  liveConnected: boolean; children?: ReactNode; es?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<string[]>([]);
  useEffect(() => {
    if (instant) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [instant]);
  function choose(value: string) {
    setDraft(value); setCandidates([]); setError("");
    if (!value) return;
    const parsed = fleetWallTimeToInstant(value, CENTRAL);
    if (parsed.status === "resolved") onChange(parsed.instant);
    else if (parsed.status === "ambiguous") setCandidates(parsed.candidates);
    else setError(parsed.status === "nonexistent"
      ? es ? "Esta hora no existe debido al cambio de horario de verano." : "This Central time does not exist because of the daylight saving change."
      : es ? "Seleccione una fecha y hora válidas." : "Choose a valid date and time.");
  }
  function reset() { setNow(Date.now()); onChange(null); setDraft(""); setError(""); setCandidates([]); setOpen(false); }
  return <div className="gate-map-time-toolbar max-w-full" aria-label="Coverage time controls">
    <div className="gate-map-controls" role="group" aria-label="Map controls">
      <button type="button" className="gate-map-time-link gate-map-live" data-live={!instant && liveConnected} aria-pressed={!instant} onClick={reset} title={!instant && !liveConnected ? es ? "Cobertura en vivo no disponible" : "Live coverage unavailable" : undefined}><span aria-hidden="true" className="gate-map-live-dot" />{es ? "En vivo" : "Live"}</button>
      <Popover open={open} onOpenChange={value => {
        setOpen(value);
        if (value) { setDraft(fleetInstantToWallTime(instant ?? new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(), CENTRAL) ?? ""); setError(""); setCandidates([]); }
      }}>
        <PopoverTrigger asChild><button type="button" className="gate-map-time-link" aria-pressed={Boolean(instant)} aria-label={es ? "Día de" : "Day of"}><CalendarDays aria-hidden="true" />{es ? "Día de" : "Day of"}</button></PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-2">
          <label className="grid gap-1 text-sm">{es ? "Fecha y hora (hora central)" : "Date and time (Central Time)"}<BrandedInput aria-label="Date and time (Central Time)" type="datetime-local" step="1" value={draft} onInput={event => choose(event.currentTarget.value)} onChange={event => choose(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground">America/Chicago · {es ? "Hora central, con horario de verano." : "Central Time, including daylight saving."}</p>
          {!!candidates.length && <label className="grid gap-1 text-sm">{es ? "Esta hora ocurre dos veces. Elija una." : "This time occurs twice. Choose which one."}<BrandedSelect aria-label="Repeated Central time" value={instant && candidates.includes(instant) ? instant : ""} onChange={event => { if (candidates.includes(event.target.value)) onChange(event.target.value); }}><option value="">{es ? "Seleccione" : "Choose"}</option>{candidates.map(value => <option key={value} value={value}>{new Date(value).toLocaleTimeString("en-US", { timeZone: CENTRAL, timeZoneName: "short", hour12: true })}</option>)}</BrandedSelect></label>}
          {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
          <button type="button" className="text-xs underline underline-offset-2" onClick={reset}>{es ? "Restablecer" : "Reset"}</button>
        </PopoverContent>
      </Popover>
      {instant && <button type="button" className="gate-map-time-reset" aria-label={es ? "RESTABLECER" : "RESET"} title={es ? "Restablecer" : "Reset"} onClick={reset}><RotateCcw aria-hidden="true" /></button>}
      {children}
    </div>
    <time aria-label="Coverage clock" dateTime={instant ?? new Date(now).toISOString()} className="gate-map-clock font-medium tabular-nums">{formatGateMapTime(instant ?? now)}</time>
  </div>;
}
