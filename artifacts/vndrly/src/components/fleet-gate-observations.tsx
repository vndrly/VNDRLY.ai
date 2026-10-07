import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FleetGateLinkInputSchema, type FleetRun } from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";

export function FleetGateObservationsPanel({
  run,
  identity,
  onSaved,
}: {
  run: FleetRun;
  identity: string;
  onSaved: () => Promise<void>;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const query = useQuery({
    queryKey: ["fleet", identity, "gate", run.id, run.version],
    queryFn: () => fleetClient.gateObservations(run.id),
    retry: false,
  });
  const [visitId, setVisitId] = useState("");
  const [stopId, setStopId] = useState("");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState<z.infer<
    typeof FleetGateLinkInputSchema
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const data =
    !query.isError &&
    query.data?.runId === run.id &&
    query.data.automaticAdmissionCreated === false
      ? query.data
      : undefined;
  const selected = data?.observations.find(
    (item) => item.visitId === Number(visitId),
  );
  const stops = run.stops.filter((stop) => stop.siteId === selected?.siteId);
  function siteName(id: number) {
    return (
      run.labels?.sites.find((site) => site.siteId === id)?.name ??
      `${c.site} ${id}`
    );
  }
  function date(value: string | null) {
    return value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString(i18n.language)
      : c.notRecorded;
  }
  function review() {
    if (
      !data?.canLink ||
      !selected ||
      !stops.some((stop) => stop.id === stopId)
    )
      return;
    const result = FleetGateLinkInputSchema.safeParse({
      operationId: crypto.randomUUID(),
      expectedVersion: data.version,
      stopId,
      visitId: selected.visitId,
      reason,
    });
    if (result.success) {
      setReviewed(result.data);
      setMessage("");
    }
  }
  async function save() {
    if (!reviewed || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await fleetClient.linkGateVisit(run.id, reviewed);
      if (
        saved.operationId !== reviewed.operationId ||
        saved.runId !== run.id ||
        saved.visitId !== reviewed.visitId ||
        saved.stopId !== reviewed.stopId ||
        saved.automaticAdmissionCreated !== false
      )
        throw new Error("Gate link outcome unavailable");
      setReviewed(null);
      setVisitId("");
      setStopId("");
      setReason("");
      setMessage(c.gateLinkSaved);
      await onSaved();
      await query.refetch();
    } catch {
      setMessage(c.gateLinkFailed);
      await onSaved();
      await query.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-3">
      <h3 className="font-semibold">{c.gateObservations}</h3>
      <p className="text-xs text-muted-foreground">{c.gateBasis}</p>
      <PngPillButton disabled={busy} onClick={() => void query.refetch()}>
        {c.refresh}
      </PngPillButton>
      {query.isPending ? (
        <p>{c.loading}</p>
      ) : !data ? (
        <p role="alert">{c.gateUnavailable}</p>
      ) : (
        <>
          {data.ambiguous && <p role="status">{c.gateAmbiguous}</p>}
          {!data.observations.length && <p>{c.noGateObservations}</p>}
          {data.observations.map((observation) => (
            <article
              className="space-y-1 border-t py-2 text-sm"
              key={observation.visitId}
            >
              <strong>
                {c.gateVisit} #{observation.visitId} ·{" "}
                {siteName(observation.siteId)}
              </strong>
              <p>
                {c.gateCheckIn}: {date(observation.checkInAt)} ·{" "}
                {c.gateCheckOut}: {date(observation.checkOutAt)}
              </p>
              <p>
                {c.observedArrival}: {date(observation.observedArrivalAt)} ·{" "}
                {c.observedDeparture}: {date(observation.observedDepartureAt)}
              </p>
              <p>
                {c.source}: {observation.source ?? c.unknownSource} · {c.status}
                : {observation.reconciliationState}
              </p>
              {data.links.some(
                (link) => link.visitId === observation.visitId,
              ) && <p>{c.alreadyLinked}</p>}
            </article>
          ))}
          {data.canLink && (
            <div className="space-y-2" onChange={() => setReviewed(null)}>
              <label className="block">
                {c.gateVisit}
                <select
                  disabled={busy}
                  value={visitId}
                  onChange={(event) => {
                    setVisitId(event.target.value);
                    setStopId("");
                  }}
                >
                  <option value="">{c.selectGateVisit}</option>
                  {data.observations
                    .filter(
                      (observation) =>
                        !data.links.some(
                          (link) => link.visitId === observation.visitId,
                        ),
                    )
                    .map((observation) => (
                      <option
                        key={observation.visitId}
                        value={observation.visitId}
                      >
                        #{observation.visitId} · {siteName(observation.siteId)}{" "}
                        · {date(observation.checkInAt)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block">
                {c.gateStop}
                <select
                  disabled={busy}
                  value={stopId}
                  onChange={(event) => setStopId(event.target.value)}
                >
                  <option value="">{c.gateStop}</option>
                  {stops.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      {stop.sequence + 1}. {stop.kind} · {siteName(stop.siteId)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                {c.reason}
                <textarea
                  disabled={busy}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <PngPillButton
                disabled={busy || !selected || !stopId || !reason.trim()}
                onClick={review}
              >
                {c.reviewGateLink}
              </PngPillButton>
            </div>
          )}
          {reviewed && (
            <div className="rounded border p-3">
              <p>
                {c.gateVisit} #{reviewed.visitId} · {c.stops}:{" "}
                {(run.stops.find((stop) => stop.id === reviewed.stopId)
                  ?.sequence ?? -1) + 1}{" "}
                · {c.version} {reviewed.expectedVersion}
              </p>
              <p>{reviewed.reason}</p>
              <PngPillButton disabled={busy} onClick={() => void save()}>
                {c.saveGateLink}
              </PngPillButton>
            </div>
          )}
          <h4 className="font-semibold">{c.savedGateLinks}</h4>
          {data.links.length ? (
            data.links.map((link) => (
              <p className="text-sm" key={`${link.visitId}:${link.stopId}`}>
                {c.gateVisit} #{link.visitId} ·{" "}
                {siteName(link.observation.siteId)} · {c.stops}:{" "}
                {(run.stops.find((stop) => stop.id === link.stopId)?.sequence ??
                  -1) + 1}{" "}
                · {c.observed}: {date(link.recordedAt)} · {c.source}:{" "}
                {link.observation.source ?? c.unknownSource}
              </p>
            ))
          ) : (
            <p>{c.noGateLinks}</p>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
