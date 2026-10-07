import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FleetDraftEditSchema, type FleetRun } from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
import {
  FleetScheduleFields,
  fleetScheduleDraft,
  parseFleetSchedule,
} from "./fleet-schedule-fields";
export function FleetDraftEditor({
  run,
  sites,
  onSaved,
}: {
  run: FleetRun;
  sites: number[];
  onSaved: () => Promise<void>;
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
  const locked = busy || !!reviewed || stale;
  function reloadSaved() {
    setTitle(run.title);
    setSchedule(fleetScheduleDraft(run.schedule));
    setStops([...run.stops].sort((a, b) => a.sequence - b.sequence));
    setBaseVersion(run.version);
    setReviewed(null);
    setMessage("");
  }
  function review() {
    if (stale) return;
    const parsedSchedule = parseFleetSchedule(schedule);
    if (!parsedSchedule.valid) return;
    const parsed = FleetDraftEditSchema.safeParse({
      operationId: crypto.randomUUID(),
      expectedVersion: baseVersion,
      title,
      schedule: parsedSchedule.schedule,
      stops: stops.map((stop, sequence) => ({ ...stop, sequence })),
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
      const saved = await fleetClient.editDraft(run.id, reviewed);
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
          {reviewed ? (
            <>
              <p>
                {c.version} {reviewed.expectedVersion} · {reviewed.title} ·{" "}
                {reviewed.stops
                  ?.map(
                    (stop) =>
                      `${stop.sequence + 1}. ${stop.kind} ${stop.siteId}`,
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
