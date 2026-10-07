import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  FleetEvidenceInputSchema,
  type FleetEvidence,
  type FleetRun,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import {
  fleetEvidenceFileSha256,
  uploadFleetEvidence,
  validateFleetEvidenceFile,
  type FleetEvidenceUpload,
} from "@/lib/fleet-evidence-upload";
import { fleetCopy } from "@/lib/fleet-copy";
import { PngPillButton } from "@/components/png-pill-rollover";
type Intent = {
  upload: FleetEvidenceUpload;
  sha256: string;
  input: Omit<z.infer<typeof FleetEvidenceInputSchema>, "objectPath">;
  command?: z.infer<typeof FleetEvidenceInputSchema>;
};
export function FleetEvidencePanel({
  run,
  identity,
  userId,
  canAdd,
  onSaved,
}: {
  run: FleetRun;
  identity: string;
  userId: number;
  canAdd: boolean;
  onSaved: () => Promise<void>;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ["fleet", identity, "evidence", run.id, run.version],
    queryFn: () => fleetClient.evidence(run.id),
    retry: false,
  });
  const data =
    !query.isError && query.data?.runId === run.id
      ? query.data.evidence.filter(
          (item) => item.companyId === run.companyId && item.runId === run.id,
        )
      : undefined;
  const [file, setFile] = useState<File | null>(null),
    [kind, setKind] =
      useState<z.infer<typeof FleetEvidenceInputSchema>["kind"]>("photo"),
    [stopId, setStop] = useState(""),
    [loadId, setLoad] = useState(""),
    [notes, setNotes] = useState(""),
    [captured, setCaptured] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const authority = useRef(canAdd);
  authority.current = canAdd;
  const locked = busy || !!intent;
  function select(value: File | undefined) {
    if (!value) return;
    try {
      validateFleetEvidenceFile(value);
      setFile(value);
      setMessage("");
    } catch {
      setMessage(c.evidenceFileInvalid);
      setFile(null);
    }
  }
  async function review() {
    if (!file || !canAdd || busy) return;
    setBusy(true);
    try {
      const capturedAt = captured
        ? new Date(captured).toISOString()
        : undefined;
      const input = {
        operationId: crypto.randomUUID(),
        evidenceId: crypto.randomUUID(),
        expectedVersion: run.version,
        kind,
        notes,
        ...(stopId ? { stopId } : {}),
        ...(loadId ? { loadId } : {}),
        ...(capturedAt ? { capturedAt } : {}),
      };
      const parsed = FleetEvidenceInputSchema.safeParse({
        ...input,
        objectPath: "/objects/uploads/11111111-1111-4111-8111-111111111111",
      });
      if (!parsed.success) throw Error("Incomplete evidence");
      const sha256 = await fleetEvidenceFileSha256(file);
      if (alive.current) setIntent({ upload: { file }, input, sha256 });
    } catch {
      if (alive.current) setMessage(c.evidenceFileInvalid);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const matches = (record: FleetEvidence, pending: Intent) =>
    record.runId === run.id &&
    record.companyId === run.companyId &&
    record.operationId === pending.input.operationId &&
    record.evidenceId === pending.input.evidenceId &&
    record.recordedByUserId === userId &&
    record.sha256 === pending.sha256 &&
    record.size === pending.upload.file.size &&
    record.contentType === pending.upload.file.type;
  async function save() {
    if (!intent || busy) return;
    const pending = intent;
    setBusy(true);
    setMessage("");
    try {
      const existing = await fleetClient.evidence(run.id);
      if (!alive.current) return;
      const recorded = existing.evidence.find(
        (item) => item.operationId === pending.input.operationId,
      );
      let record = recorded;
      if (!record) {
        const objectPath = await uploadFleetEvidence(
          pending.upload,
          () => alive.current && authority.current,
        );
        if (!alive.current || !authority.current)
          throw Error("Fleet assignment changed");
        pending.command ??= FleetEvidenceInputSchema.parse({
          ...pending.input,
          objectPath,
        });
        record = await fleetClient.addEvidence(run.id, pending.command);
      }
      if (!alive.current) return;
      if (!matches(record, pending)) throw Error("Evidence outcome mismatch");
      setIntent(null);
      setFile(null);
      setMessage(c.evidenceSaved);
      await onSaved();
      await query.refetch();
    } catch {
      if (alive.current) {
        setMessage(c.evidenceUnknown);
        await onSaved();
        await query.refetch();
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border p-3">
      <h3>{c.evidenceTitle}</h3>
      <p className="text-xs">{c.evidenceSource}</p>
      <PngPillButton disabled={busy} onClick={() => void query.refetch()}>
        {c.refresh}
      </PngPillButton>
      {query.isError && <p role="alert">{c.evidenceUnavailable}</p>}
      {data?.map((item) => (
        <article key={item.evidenceId} className="rounded border p-2">
          <p>
            {item.kind} · {item.contentType} ·{" "}
            {item.size.toLocaleString(i18n.language)} {c.bytes} · {item.notes}
          </p>
          <p>
            {c.actor} {item.recordedByUserId} · {c.accepted} {item.recordedAt} ·{" "}
            {c.captured}: {item.capturedAt ?? c.notRecorded}
          </p>
          <p className="break-all text-xs">SHA-256: {item.sha256}</p>
          <a
            href={`/api/fleet/runs/${run.id}/evidence/${item.evidenceId}/file`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {c.evidenceReadFile}
          </a>
        </article>
      ))}
      {canAdd && (
        <>
          <label>
            {c.chooseFile}
            <input
              disabled={locked}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => select(event.target.files?.[0])}
            />
          </label>
          <label>
            {c.capturePhoto}
            <input
              disabled={locked}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => {
                select(event.target.files?.[0]);
                setKind("photo");
              }}
            />
          </label>
          <label>
            {c.kind}
            <select
              disabled={locked}
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              {["photo", "scale", "receipt", "signature"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.stops}
            <select
              disabled={locked}
              value={stopId}
              onChange={(event) => {
                setStop(event.target.value);
                setLoad("");
              }}
            >
              <option value="">{c.unlinked}</option>
              {run.stops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.sequence + 1}. {stop.kind} ·{" "}
                  {run.labels?.sites.find((site) => site.siteId === stop.siteId)
                    ?.name ?? stop.siteId}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.loads}
            <select
              disabled={locked}
              value={loadId}
              onChange={(event) => setLoad(event.target.value)}
            >
              <option value="">{c.unlinked}</option>
              {run.loads
                .filter(
                  (load) =>
                    !stopId ||
                    load.pickupStopId === stopId ||
                    load.deliveryStopId === stopId ||
                    (run.currentStopId === stopId &&
                      run.stops.find((stop) => stop.id === stopId)?.kind ===
                        "delivery"),
                )
                .map((load) => (
                  <option key={load.id} value={load.id}>
                    {load.commodity} · {load.quantity} {load.unit} ·{" "}
                    {load.manifestReference}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {c.notes}
            <textarea
              disabled={locked}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <label>
            {c.evidenceCaptureTime}
            <input
              disabled={locked}
              type="datetime-local"
              value={captured}
              onChange={(event) => setCaptured(event.target.value)}
            />
          </label>
          {!intent && (
            <PngPillButton
              disabled={busy || !file || !notes.trim()}
              onClick={() => void review()}
            >
              {c.evidenceReview}
            </PngPillButton>
          )}
        </>
      )}
      {intent && (
        <div className="rounded border p-2">
          <p>
            {intent.upload.file.name} · {intent.upload.file.size} {c.bytes} ·{" "}
            {intent.input.kind} · {c.version} {intent.input.expectedVersion}
          </p>
          <p>
            {intent.input.notes} · {intent.input.stopId ?? c.unlinked} ·{" "}
            {intent.input.loadId ?? c.unlinked} ·{" "}
            {intent.input.capturedAt ?? c.notRecorded}
          </p>
          <p className="break-all text-xs">SHA-256: {intent.sha256}</p>
          <PngPillButton disabled={busy} onClick={() => void save()}>
            {c.evidenceSave}
          </PngPillButton>
          <PngPillButton disabled={busy} onClick={() => setIntent(null)}>
            {c.cancel}
          </PngPillButton>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
