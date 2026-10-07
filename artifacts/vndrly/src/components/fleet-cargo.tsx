import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FleetRunSchema,
  FleetCargoTransferInputSchema,
  FleetCargoTransferActionSchema,
  type FleetRun,
  type FleetCargoTransfer,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
type Pending =
  | {
      kind: "proposal";
      summary: string;
      input: z.infer<typeof FleetCargoTransferInputSchema>;
    }
  | {
      kind: "action";
      id: string;
      input: z.infer<typeof FleetCargoTransferActionSchema>;
    };
export function fleetCargoCandidates(source: FleetRun, runs: FleetRun[]) {
  const stop = source.stops.find((item) => item.id === source.currentStopId);
  return source.status === "in_progress" && source.phase === "paused" && stop
    ? runs.filter(
        (run) =>
          run.id !== source.id &&
          run.companyId === source.companyId &&
          run.status === "in_progress" &&
          run.phase === "paused" &&
          run.stops.some(
            (item) =>
              item.id === run.currentStopId &&
              item.kind === "pickup" &&
              item.siteId === stop.siteId,
          ),
      )
    : [];
}
export function FleetCargoPanel({
  run,
  runs,
  identity,
  canDispatch,
  onSaved,
}: {
  run: FleetRun;
  runs: FleetRun[];
  identity: string;
  canDispatch: boolean;
  onSaved: () => Promise<void>;
}) {
  const { i18n } = useTranslation(),
    c = fleetCopy(i18n.language);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ["fleet", identity, "cargo", run.id, run.version],
    queryFn: () => fleetClient.cargoTransfers(run.id),
    retry: false,
  });
  const records =
    !query.isError && query.data?.runId === run.id
      ? query.data.transfers.filter(
          (item) =>
            item.companyId === run.companyId &&
            (item.sourceRunId === run.id || item.targetRunId === run.id),
        )
      : undefined;
  const [targetId, setTarget] = useState(""),
    [loadId, setLoad] = useState(""),
    [deliveryId, setDelivery] = useState(""),
    [notes, setNotes] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const candidates = fleetCargoCandidates(run, runs),
    target = candidates.find((item) => item.id === targetId),
    targetStop = target?.stops.find((item) => item.id === target.currentStopId);
  const locked = busy || !!pending;
  async function reviewProposal() {
    if (!canDispatch || locked) return;
    setBusy(true);
    try {
      const source = FleetRunSchema.parse(await fleetClient.run(run.id)),
        destination = FleetRunSchema.parse(await fleetClient.run(targetId));
      const valid = fleetCargoCandidates(source, [destination])[0],
        load = source.loads.find(
          (item) =>
            item.id === loadId && !item.deliveredAt && !item.transferOut,
        ),
        stop = source.stops.find((item) => item.id === source.currentStopId),
        pickup = destination.stops.find(
          (item) => item.id === destination.currentStopId,
        ),
        delivery = destination.stops.find(
          (item) =>
            item.id === deliveryId &&
            item.kind === "delivery" &&
            pickup &&
            item.sequence > pickup.sequence,
        );
      if (!valid || !load || !stop || !delivery)
        throw Error("Current cargo unavailable");
      const input = FleetCargoTransferInputSchema.parse({
        operationId: crypto.randomUUID(),
        sourceRunId: source.id,
        targetRunId: destination.id,
        sourceExpectedVersion: source.version,
        targetExpectedVersion: destination.version,
        sourceLoadId: load.id,
        targetLoadId: crypto.randomUUID(),
        quantity: load.quantity,
        siteId: stop.siteId,
        targetDeliveryStopId: delivery.id,
        reason: notes,
      });
      if (alive.current)
        setPending({
          kind: "proposal",
          input,
          summary: `${load.commodity} · ${load.quantity} ${load.unit} · ${load.manifestReference}`,
        });
    } catch {
      if (alive.current) setMessage(c.cargoUnavailable);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function reviewAction(
    record: FleetCargoTransfer,
    action: z.infer<typeof FleetCargoTransferActionSchema>["action"],
  ) {
    if (locked) return;
    setBusy(true);
    try {
      const fresh = await fleetClient.cargoTransfer(record.id);
      if (
        !fresh.allowedActions.includes(action) ||
        fresh.companyId !== run.companyId ||
        (fresh.sourceRunId !== run.id && fresh.targetRunId !== run.id)
      )
        throw Error("Cargo action unavailable");
      let sourceVersion = fresh.sourceRunVersion,
        targetVersion = fresh.targetRunVersion;
      if (action === "cancel") {
        const source = FleetRunSchema.parse(
            await fleetClient.run(fresh.sourceRunId),
          ),
          target = FleetRunSchema.parse(
            await fleetClient.run(fresh.targetRunId),
          );
        if (
          source.id !== fresh.sourceRunId ||
          target.id !== fresh.targetRunId ||
          source.companyId !== run.companyId ||
          target.companyId !== run.companyId
        )
          throw Error("Cargo scope changed");
        sourceVersion = source.version;
        targetVersion = target.version;
      }
      const input = FleetCargoTransferActionSchema.parse({
        operationId: crypto.randomUUID(),
        expectedVersion: fresh.version,
        sourceExpectedVersion: sourceVersion,
        targetExpectedVersion: targetVersion,
        action,
        notes,
      });
      if (alive.current) setPending({ kind: "action", id: fresh.id, input });
    } catch {
      if (alive.current) setMessage(c.cargoUnavailable);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    if (!pending || busy) return;
    const intent = pending;
    setBusy(true);
    setMessage("");
    try {
      let saved: FleetCargoTransfer | undefined;
      if (intent.kind === "proposal") {
        const list = await fleetClient.cargoTransfers(run.id);
        if (!alive.current) return;
        saved = list.transfers.find((item) =>
          item.events.some(
            (event) => event.operationId === intent.input.operationId,
          ),
        );
        if (!saved) saved = await fleetClient.proposeCargo(intent.input);
      } else {
        saved = await fleetClient.cargoTransfer(intent.id);
        if (!alive.current) return;
        if (
          !saved.events.some(
            (event) => event.operationId === intent.input.operationId,
          )
        )
          saved = await fleetClient.cargoAction(intent.id, intent.input);
      }
      if (!alive.current) return;
      if (
        saved.companyId !== run.companyId ||
        !saved.events.some(
          (event) => event.operationId === intent.input.operationId,
        )
      )
        throw Error("Unverified cargo outcome");
      setPending(null);
      setMessage(c.saved);
      await onSaved();
      await query.refetch();
    } catch {
      if (alive.current) {
        setMessage(c.cargoUnknown);
        await onSaved();
        await query.refetch();
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-3">
      <h3>{c.cargoTitle}</h3>
      <p className="text-xs">{c.cargoSource}</p>
      <PngPillButton disabled={busy} onClick={() => void query.refetch()}>
        {c.refresh}
      </PngPillButton>
      {query.isError && <p role="alert">{c.cargoUnavailable}</p>}
      <label>
        {c.notes}
        <textarea
          disabled={locked}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {records?.map((record) => (
        <article className="rounded border p-2" key={record.id}>
          <p>
            {record.commodity} · {record.quantity} {record.unit} ·{" "}
            {record.status} · {c.version} {record.version}
          </p>
          <p>
            {record.sourceRunId} → {record.targetRunId} · {c.site}{" "}
            {record.siteId}
          </p>
          <p>{record.reason}</p>
          <p>
            {c.cargoSourceAck}: {record.sourceAcknowledgedBy ?? c.notRecorded} ·{" "}
            {c.cargoTargetAck}: {record.targetAcknowledgedBy ?? c.notRecorded}
          </p>
          {record.allowedActions.map((action) => (
            <PngPillButton
              key={action}
              disabled={locked || !notes.trim()}
              onClick={() => void reviewAction(record, action)}
            >
              {c[action]}
            </PngPillButton>
          ))}
        </article>
      ))}
      {canDispatch && (
        <div>
          <p>{c.cargoLoadedCandidates}</p>
          <label>
            {c.cargoTarget}
            <select
              disabled={locked}
              value={targetId}
              onChange={(event) => {
                setTarget(event.target.value);
                setDelivery("");
              }}
            >
              <option value="">{c.choose}</option>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {c.version} {item.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.cargoLoad}
            <select
              disabled={locked}
              value={loadId}
              onChange={(event) => setLoad(event.target.value)}
            >
              <option value="">{c.choose}</option>
              {run.loads
                .filter((item) => !item.deliveredAt && !item.transferOut)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.commodity} · {item.quantity} {item.unit} ·{" "}
                    {item.manifestReference}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {c.cargoDestination}
            <select
              disabled={locked}
              value={deliveryId}
              onChange={(event) => setDelivery(event.target.value)}
            >
              <option value="">{c.choose}</option>
              {target?.stops
                .filter(
                  (item) =>
                    item.kind === "delivery" &&
                    targetStop &&
                    item.sequence > targetStop.sequence,
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.sequence + 1}.{" "}
                    {target.labels?.sites.find(
                      (site) => site.siteId === item.siteId,
                    )?.name ?? item.siteId}
                  </option>
                ))}
            </select>
          </label>
          <PngPillButton
            disabled={
              locked || !targetId || !loadId || !deliveryId || !notes.trim()
            }
            onClick={() => void reviewProposal()}
          >
            {c.cargoReview}
          </PngPillButton>
        </div>
      )}
      {pending && (
        <div className="rounded border p-2">
          <p>
            {pending.kind === "proposal"
              ? c.cargoProposal
              : c[pending.input.action]}{" "}
            · {c.version} {pending.input.sourceExpectedVersion} /{" "}
            {pending.input.targetExpectedVersion}
          </p>
          {pending.kind === "proposal" ? (
            <p>
              {pending.input.sourceRunId} → {pending.input.targetRunId} ·{" "}
              {pending.input.sourceLoadId} · {pending.input.quantity} ·{" "}
              {pending.summary} · {c.site} {pending.input.siteId} ·{" "}
              {pending.input.targetDeliveryStopId} · {pending.input.reason}
            </p>
          ) : (
            <p>
              {pending.id} · {pending.input.notes} · {c.version}{" "}
              {pending.input.expectedVersion}
            </p>
          )}
          <PngPillButton disabled={busy} onClick={() => void save()}>
            {c.cargoSave}
          </PngPillButton>
          <PngPillButton disabled={busy} onClick={() => setPending(null)}>
            {c.cancel}
          </PngPillButton>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
