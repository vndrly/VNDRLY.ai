import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FleetRunSchema,
  FleetReplacementInputSchema,
  FleetReplacementActionSchema,
  fleetReplacementReady,
  type FleetRun,
  type FleetReplacement,
  type FleetResources,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
type Pending =
  | { kind: "proposal"; input: z.infer<typeof FleetReplacementInputSchema> }
  | {
      kind: "action";
      id: string;
      input: z.infer<typeof FleetReplacementActionSchema>;
    };
export function FleetReplacementPanel({
  run,
  identity,
  canDispatch,
  equipment,
  onSaved,
}: {
  run: FleetRun;
  identity: string;
  canDispatch: boolean;
  equipment: FleetResources["equipment"];
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
    queryKey: ["fleet", identity, "replacements", run.id, run.version],
    queryFn: () => fleetClient.replacements(run.id),
    retry: false,
  });
  const records =
    !query.isError && query.data?.runId === run.id
      ? query.data.replacements.filter(
          (item) => item.companyId === run.companyId && item.runId === run.id,
        )
      : undefined;
  const [vehicle, setVehicle] = useState(run.vehicleAssetId),
    [trailer, setTrailer] = useState(run.trailerAssetId ?? ""),
    [notes, setNotes] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const locked = busy || !!pending;
  async function reviewProposal() {
    if (!canDispatch || locked) return;
    setBusy(true);
    try {
      const fresh = FleetRunSchema.parse(await fleetClient.run(run.id));
      if (
        fresh.id !== run.id ||
        fresh.companyId !== run.companyId ||
        fresh.status !== "in_progress" ||
        fresh.phase !== "paused" ||
        fresh.driverUserId !== run.driverUserId
      )
        throw Error("Run changed");
      const input = FleetReplacementInputSchema.parse({
        operationId: crypto.randomUUID(),
        expectedVersion: fresh.version,
        vehicleAssetId: vehicle,
        trailerAssetId: trailer || null,
        reason: notes,
      });
      if (alive.current) setPending({ kind: "proposal", input });
    } catch {
      if (alive.current) setMessage(c.replacementUnavailable);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function reviewAction(
    record: FleetReplacement,
    action: "accept" | "cancel",
  ) {
    if (locked) return;
    setBusy(true);
    try {
      const list = await fleetClient.replacements(run.id),
        fresh = list.replacements.find((item) => item.id === record.id);
      if (
        list.runId !== run.id ||
        !fresh ||
        fresh.companyId !== run.companyId ||
        fresh.runId !== run.id ||
        !fresh.allowedActions.includes(action)
      )
        throw Error("Current replacement unavailable");
      let runVersion = fresh.runVersion;
      if (action === "cancel") {
        const current = FleetRunSchema.parse(await fleetClient.run(run.id));
        if (current.id !== run.id || current.companyId !== run.companyId)
          throw Error("Replacement scope changed");
        runVersion = current.version;
      }
      const input = FleetReplacementActionSchema.parse({
        operationId: crypto.randomUUID(),
        expectedVersion: fresh.version,
        runExpectedVersion: runVersion,
        action,
        notes,
      });
      if (alive.current) setPending({ kind: "action", id: fresh.id, input });
    } catch {
      if (alive.current) setMessage(c.replacementUnavailable);
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
      const list = await fleetClient.replacements(run.id);
      if (!alive.current) return;
      if (list.runId !== run.id) throw Error("Run scope mismatch");
      let saved = list.replacements.find((item) =>
        item.events.some(
          (event) => event.operationId === intent.input.operationId,
        ),
      );
      if (!saved)
        saved =
          intent.kind === "proposal"
            ? await fleetClient.proposeReplacement(run.id, intent.input)
            : await fleetClient.replacementAction(
                run.id,
                intent.id,
                intent.input,
              );
      if (!alive.current) return;
      if (
        saved.companyId !== run.companyId ||
        saved.runId !== run.id ||
        !saved.events.some(
          (event) => event.operationId === intent.input.operationId,
        ) ||
        (intent.kind === "action" && saved.id !== intent.id)
      )
        throw Error("Unverified replacement");
      setPending(null);
      setMessage(c.saved);
      await onSaved();
      await query.refetch();
    } catch {
      if (alive.current) {
        setMessage(c.replacementUnknown);
        await onSaved();
        await query.refetch();
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-3">
      <h3>{c.replacementTitle}</h3>
      <p className="text-xs">{c.replacementSource}</p>
      {run.activeReplacement && (
        <p>
          {fleetReplacementReady(run)
            ? c.replacementRecordedReady
            : c.replacementNeedsChecks}
        </p>
      )}
      <PngPillButton disabled={busy} onClick={() => void query.refetch()}>
        {c.refresh}
      </PngPillButton>
      {query.isError && <p role="alert">{c.replacementUnavailable}</p>}
      <label>
        {c.notes}
        <textarea
          disabled={locked}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {records?.map((record) => (
        <article key={record.id} className="rounded border p-2">
          <p>
            {record.status} · {c.version} {record.version} · {c.driver}{" "}
            {record.driverUserId}
          </p>
          <p>
            {record.priorVehicleAssetId} → {record.vehicleAssetId} · {c.trailer}
            : {record.priorTrailerAssetId ?? c.none} →{" "}
            {record.trailerAssetId ?? c.none}
          </p>
          <p>
            {record.reason} · {c.accepted} {record.acceptedAt ?? c.notRecorded}{" "}
            · {c.actor} {record.acceptedByUserId ?? c.notRecorded}
          </p>
          {record.allowedActions.map((action) => (
            <PngPillButton
              key={action}
              disabled={locked || !notes.trim()}
              onClick={() => void reviewAction(record, action)}
            >
              {action === "accept" ? c.replacementAccept : c.cancel}
            </PngPillButton>
          ))}
        </article>
      ))}
      {canDispatch &&
        run.status === "in_progress" &&
        run.phase === "paused" && (
          <>
            <label>
              {c.replacementVehicle}
              <select
                disabled={locked}
                value={vehicle}
                onChange={(event) => setVehicle(event.target.value)}
              >
                <option value="">{c.choose}</option>
                {equipment
                  .filter((item) =>
                    ["truck", "vehicle"].includes(item.category.toLowerCase()),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.status} · {item.id}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {c.replacementTrailer}
              <select
                disabled={locked}
                value={trailer}
                onChange={(event) => setTrailer(event.target.value)}
              >
                <option value="">{c.none}</option>
                {equipment
                  .filter((item) => item.category.toLowerCase() === "trailer")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.status} · {item.id}
                    </option>
                  ))}
              </select>
            </label>
            <PngPillButton
              disabled={
                locked ||
                !vehicle ||
                !notes.trim() ||
                (vehicle === run.vehicleAssetId &&
                  (trailer || null) === run.trailerAssetId)
              }
              onClick={() => void reviewProposal()}
            >
              {c.replacementReview}
            </PngPillButton>
          </>
        )}
      {pending && (
        <div className="rounded border p-2">
          <p>
            {pending.kind === "proposal"
              ? c.replacementProposal
              : pending.input.action === "accept"
                ? c.replacementAccept
                : c.cancel}{" "}
            · {c.version}{" "}
            {pending.kind === "proposal"
              ? pending.input.expectedVersion
              : pending.input.runExpectedVersion}
          </p>
          {pending.kind === "proposal" ? (
            <p>
              {pending.input.vehicleAssetId} ·{" "}
              {pending.input.trailerAssetId ?? c.none} · {pending.input.reason}
            </p>
          ) : (
            <p>
              {pending.id} · {pending.input.notes} · {c.version}{" "}
              {pending.input.expectedVersion}
            </p>
          )}
          <PngPillButton disabled={busy} onClick={() => void save()}>
            {c.replacementSave}
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
