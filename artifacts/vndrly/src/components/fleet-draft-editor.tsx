import { useState,useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FleetDraftEditSchema,FleetDestinationDirectorySchema,fleetRouteOperationalStops, type FleetRun,type FleetRoutePlan,type FleetDestination,type FleetWorkSession } from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
import {
  FleetScheduleFields,
  fleetScheduleDraft,
  parseFleetSchedule,
} from "./fleet-schedule-fields";
import {FleetRouteFields} from "./fleet-route-fields";
export function FleetDraftEditor({
  run,
  sites,
  onSaved,
  workSession,
}: {
  run: FleetRun;
  sites: number[];
  onSaved: () => Promise<void>;
  workSession?:FleetWorkSession|null;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const [open, setOpen] = useState(false),
    [baseVersion, setBaseVersion] = useState(run.version),
    [title, setTitle] = useState(run.title),
    [schedule, setSchedule] = useState(() => fleetScheduleDraft(run.schedule)),
    [stops, setStops] = useState(() =>
      [...run.stops].sort((a, b) => a.sequence - b.sequence),
    );
  const [reviewed, setReviewed] = useState<z.infer<
      typeof FleetDraftEditSchema
    > | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const stale = baseVersion !== run.version;
  const [route,setRoute]=useState<FleetRoutePlan|null>(run.routePlan??null),[routeDirty,setRouteDirty]=useState(false),[destinations,setDestinations]=useState<FleetDestination[]|null>(null),[directoryError,setDirectoryError]=useState(false);
  useEffect(()=>{let current=true;setDestinations(null);setDirectoryError(false);if(open&&run.routePlan&&!run.runOrder)void fleetClient.commercial(run.stops[0].siteId).then(raw=>{if(current)setDestinations(FleetDestinationDirectorySchema.parse(raw).destinations);}).catch(()=>{if(current)setDirectoryError(true);});return()=>{current=false;};},[open,run.id,run.companyId,run.runOrder?.id]);
  const locked = busy || !!reviewed || stale;
  function reloadSaved() {
    setTitle(run.title);
    setSchedule(fleetScheduleDraft(run.schedule));
    setStops([...run.stops].sort((a, b) => a.sequence - b.sequence));
    setRoute(run.routePlan??null);setRouteDirty(false);
    setBaseVersion(run.version);
    setReviewed(null);
    setMessage("");
  }
  function review() {
    if (stale) return;
    const parsedSchedule = parseFleetSchedule(schedule);
    if (!parsedSchedule.valid) return;
    if(routeDirty&&!route)return;
    const nextRoute=routeDirty&&route?{...route,plannedWindow:parsedSchedule.schedule?{startAt:parsedSchedule.schedule.plannedStartAt,endAt:parsedSchedule.schedule.plannedEndAt,timeZone:parsedSchedule.schedule.timezone}:null}:null;
    const parsed = FleetDraftEditSchema.safeParse({
      operationId: crypto.randomUUID(),
      expectedVersion: baseVersion,
      title,
      schedule: parsedSchedule.schedule,
      ...(nextRoute?{routePlan:nextRoute,stops:fleetRouteOperationalStops(nextRoute,run.stops[0].siteId,run.stops[0].id)}:{stops:stops.map((stop, sequence) => ({ ...stop, sequence }))}),
    });
    if (
      parsed.success &&
      parsed.data.stops?.every((stop) => sites.includes(stop.siteId))
    )
      setReviewed(parsed.data);
  }
  async function save() {
    if (!reviewed || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const modern=!!workSession&&!!run.ticketReference;
      if(modern){const outcome=await workSession!.captureDraft(run,reviewed);if(!outcome.canonicalApplied){setMessage(i18n.language.startsWith("es")?"Guardado en el dispositivo; pendiente de sincronización.":"Saved on this device; awaiting sync.");await onSaved();return;}}
      const saved = modern?await fleetClient.run(run.id):await fleetClient.editDraft(run.id, reviewed);
      if (
        saved.id !== run.id ||
        !saved.events.some(
          (event) => event.operationId === reviewed.operationId,
        )
      )
        throw new Error("Draft save needs verification");
      setReviewed(null);
      setOpen(false);
      setMessage(c.saved);
      await onSaved();
    } catch {
      setMessage(c.blocked);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-2 rounded border p-3">
      <PngPillButton disabled={busy} onClick={() => setOpen(!open)}>
        {c.editDraft}
      </PngPillButton>
      {open && (
        <>
          {stale && <p role="alert">{c.draftChanged}</p>}
          {stale && !reviewed && (
            <PngPillButton disabled={busy} onClick={reloadSaved}>
              {c.reloadDraft}
            </PngPillButton>
          )}
          <label>
            {c.title}
            <input
              className="block rounded border p-2"
              disabled={locked}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <FleetScheduleFields
            value={schedule}
            onChange={setSchedule}
            disabled={locked}
          />
          {run.routePlan?<>
            {run.runOrder?<p>{i18n.language.startsWith("es")?"Recorrido guardado":"Saved Run"} · {run.runOrder.name} · {run.runOrder.origin.name} → {run.runOrder.destination.name}</p>:<fieldset disabled={locked||!destinations}><FleetRouteFields value={route} destinations={destinations??[]} onChange={value=>{setRouteDirty(true);setRoute(value);}}/></fieldset>}
            {directoryError&&<p role="alert">{i18n.language.startsWith("es")?"Ubicaciones no disponibles. Puede cambiar el título y el horario; recargue antes de modificar la ruta física.":"Locations unavailable. Title and schedule changes remain available; reload before changing the physical route."}</p>}
          </>:<>
          <ol>
            {stops.map((stop, index) => (
              <li className="flex flex-wrap gap-2 py-2" key={stop.id}>
                <span>{index + 1}.</span>
                <select
                  disabled={locked}
                  aria-label={`${c.stops} ${index + 1}`}
                  value={stop.siteId}
                  onChange={(event) =>
                    setStops(
                      stops.map((item, i) =>
                        i === index
                          ? { ...item, siteId: Number(event.target.value) }
                          : item,
                      ),
                    )
                  }
                >
                  {sites.map((siteId) => (
                    <option key={siteId} value={siteId}>
                      {run.labels?.sites.find((site) => site.siteId === siteId)
                        ?.name ?? `${c.site} ${siteId}`}
                    </option>
                  ))}
                </select>
                <select
                  disabled={locked}
                  aria-label={`${c.kind} ${index + 1}`}
                  value={stop.kind}
                  onChange={(event) =>
                    setStops(
                      stops.map((item, i) =>
                        i === index
                          ? {
                              ...item,
                              kind: event.target.value as
                                | "pickup"
                                | "delivery"
                                | "return",
                            }
                          : item,
                      ),
                    )
                  }
                >
                  {["pickup", "delivery", "return"].map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
                <PngPillButton
                  disabled={locked || index === 0}
                  onClick={() => {
                    const next = [...stops];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    setStops(next);
                  }}
                >
                  {c.moveUp}
                </PngPillButton>
                <PngPillButton
                  disabled={locked || stops.length === 1}
                  onClick={() => setStops(stops.filter((_, i) => i !== index))}
                >
                  {c.removeStop}
                </PngPillButton>
              </li>
            ))}
          </ol>
          <PngPillButton
            disabled={locked || !sites.length || stops.length >= 50}
            onClick={() =>
              setStops([
                ...stops,
                {
                  id: crypto.randomUUID(),
                  siteId: sites[0],
                  kind: "delivery",
                  sequence: stops.length,
                },
              ])
            }
          >
            {c.addStop}
          </PngPillButton>
          </>}
          {reviewed ? (
            <>
              <p>
                {c.version} {reviewed.expectedVersion} · {reviewed.title} ·{" "}
                {reviewed.stops
                  ?.map(
                    (stop) =>
                      `${stop.sequence + 1}. ${stop.kind} ${stop.destination?.name??stop.siteId}`,
                  )
                  .join(" → ")}
              </p>
              <p>
                {reviewed.schedule
                  ? `${reviewed.schedule.plannedStartAt} – ${reviewed.schedule.plannedEndAt} · ${reviewed.schedule.timezone}`
                  : c.noSchedule}
              </p>
              <PngPillButton disabled={busy} onClick={() => void save()}>
                {c.saveDraft}
              </PngPillButton>
              <PngPillButton disabled={busy} onClick={() => setReviewed(null)}>
                {c.cancel}
              </PngPillButton>
            </>
          ) : (
            <PngPillButton
              disabled={
                stale || !parseFleetSchedule(schedule).valid || !title.trim()
              }
              onClick={review}
            >
              {c.reviewDraft}
            </PngPillButton>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
