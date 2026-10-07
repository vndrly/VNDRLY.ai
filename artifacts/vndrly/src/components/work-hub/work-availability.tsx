import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { PngPillButton } from "@/components/png-pill-rollover";
import {
  WorkHubAvailabilityInputSchema,
  WorkHubAvailabilityReadSchema,
  WorkHubAvailabilityAbsentConflict,
  submitWorkHubAvailabilityAttempt,
  workHubAvailabilityFingerprintValues,
  fleetAvailabilityLocalWindow,
  type WorkHubAvailabilityAttempt,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
const copy = {
  en: {
    title: "My work availability",
    planning:
      "Your saved planning declaration. This does not start duty or prove physical readiness.",
    refresh: "Refresh",
    start: "Start (local time)",
    end: "End (local time)",
    available: "Available",
    unavailable: "Unavailable",
    new: "New interval",
    review: "Review availability",
    save: "Save reviewed interval",
    retry: "Check the same request",
    unknown:
      "The result is unresolved. Check the same request before creating another.",
    saved: "Availability saved.",
    savedRefresh: "Saved. Refresh to view the current records.",
    changed: "The snapshot changed. Refresh and review a new request.",
    error: "Availability could not be loaded.",
    none: "No saved intervals.",
  },
  es: {
    title: "Mi disponibilidad laboral",
    planning:
      "Su declaración de planificación guardada. No inicia servicio ni verifica presencia física.",
    refresh: "Actualizar",
    start: "Inicio (hora local)",
    end: "Fin (hora local)",
    available: "Disponible",
    unavailable: "No disponible",
    new: "Nuevo intervalo",
    review: "Revisar disponibilidad",
    save: "Guardar intervalo revisado",
    retry: "Consultar la misma solicitud",
    unknown:
      "El resultado no está resuelto. Consulte la misma solicitud antes de crear otra.",
    saved: "Disponibilidad guardada.",
    savedRefresh: "Guardado. Actualice para ver los registros actuales.",
    changed: "La información cambió. Actualice y revise una nueva solicitud.",
    error: "No se pudo cargar la disponibilidad.",
    none: "No hay intervalos guardados.",
  },
};
export default function WorkHubAvailability() {
  const { user } = useAuth();
  if (user?.role !== "field_employee" || !user.vendorId || !user.vendorPeopleId)
    return null;
  const identity = JSON.stringify([
    user.userId,
    user.vendorId,
    user.activeMembershipId,
    user.role,
    user.vendorPeopleId,
  ]);
  return (
    <Panel
      key={identity}
      identity={identity}
      userId={user.userId}
      companyId={user.vendorId}
    />
  );
}
function Panel({
  identity,
  userId,
  companyId,
}: {
  identity: string;
  userId: number;
  companyId: number;
}) {
  const { i18n } = useTranslation(),
    c = copy[i18n.language.startsWith("es") ? "es" : "en"],
    key = `vndrly-own-availability:${identity}`,
    alive = useRef(true),
    busyRef = useRef(false);
  const [snapshot, setSnapshot] = useState<z.infer<
      typeof WorkHubAvailabilityReadSchema
    > | null>(null),
    [recordId, setRecordId] = useState<string | null>(null),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [available, setAvailable] = useState(true),
    [review, setReview] = useState<WorkHubAvailabilityAttempt | null>(null),
    [attempt, setAttempt] = useState<WorkHubAvailabilityAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [journalBlocked, setJournalBlocked] = useState(false);
  const assertCurrent = () => {
    if (!alive.current) throw Error("account_changed");
  };
  async function request(method: "GET" | "POST", path: string, body?: unknown) {
    assertCurrent();
    const r = await fetch(path, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assertCurrent();
    const out = await r.json();
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return out;
  }
  async function load() {
    const data = WorkHubAvailabilityReadSchema.parse(
      await request("GET", "/api/work-hub/availability"),
    );
    assertCurrent();
    if (data.userId !== userId || data.companyId !== companyId)
      throw Error("account_changed");
    setSnapshot(data);
  }
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const pending = JSON.parse(raw) as WorkHubAvailabilityAttempt;
        WorkHubAvailabilityInputSchema.parse(pending.body);
        if (pending.userId !== userId || pending.companyId !== companyId)
          throw Error("journal_context");
        setAttempt(pending);
      }
    } catch {
      setJournalBlocked(true);
      setMessage(c.unknown);
    }
    void load().catch(() => {
      if (alive.current) setMessage(c.error);
    });
    return () => {
      alive.current = false;
    };
  }, [identity]);
  async function prepare() {
    if (!snapshot || busyRef.current || attempt || journalBlocked) return;
    try {
      const body = WorkHubAvailabilityInputSchema.parse({
        operationId: crypto.randomUUID(),
        recordId,
        expectedFingerprint: snapshot.fingerprint,
        window: fleetAvailabilityLocalWindow(start, end),
        available,
      });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify(
            workHubAvailabilityFingerprintValues(userId, companyId, body),
          ),
        ),
      );
      assertCurrent();
      setReview({
        userId,
        companyId,
        actorMembershipId: snapshot.actorMembershipId,
        actorSessionVersion: snapshot.actorSessionVersion,
        body,
        commandFingerprint: Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      });
      setMessage("");
    } catch {
      if (alive.current) setMessage(c.error);
    }
  }
  async function save() {
    let verified = false;
    const pending = attempt ?? review;
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      sessionStorage.setItem(key, JSON.stringify(pending));
      setAttempt(pending);
      setReview(null);
      await submitWorkHubAvailabilityAttempt(pending, {
        request,
        assertCurrent,
      });
      assertCurrent();
      verified = true;
      setMessage(c.saved);
      sessionStorage.removeItem(key);
      setAttempt(null);
      setSnapshot(null);
      setRecordId(null);
      setMessage(c.saved);
      void load().catch(() => {
        if (alive.current) setMessage(c.savedRefresh);
      });
    } catch (error) {
      if (!alive.current) return;
      if (verified) {
        setSnapshot(null);
        setMessage(c.savedRefresh);
      } else if (error instanceof WorkHubAvailabilityAbsentConflict) {
        sessionStorage.removeItem(key);
        setAttempt(null);
        setSnapshot(null);
        setMessage(c.changed);
      } else setMessage(c.unknown);
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const locked = Boolean(attempt || review || busy || journalBlocked);
  return (
    <section aria-label={c.title} className="rounded-xl border p-4 space-y-3">
      <h3>{c.title}</h3>
      <p>{c.planning}</p>
      <PngPillButton
        disabled={busy}
        onClick={() => {
          setReview(null);
          void load().catch(() => {
            if (alive.current) setMessage(c.error);
          });
        }}
      >
        {c.refresh}
      </PngPillButton>
      {snapshot && (
        <>
          <select
            aria-label={c.new}
            disabled={locked}
            value={recordId ?? ""}
            onChange={(e) => setRecordId(e.target.value || null)}
          >
            <option value="">{c.new}</option>
            {snapshot.records
              .filter((r) => !r.recurring)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.startsAt} — {r.endsAt} ·{" "}
                  {r.available ? c.available : c.unavailable}
                </option>
              ))}
          </select>
          {!snapshot.records.length && <p>{c.none}</p>}
          <label>
            {c.start}
            <input
              type="datetime-local"
              disabled={locked}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            {c.end}
            <input
              type="datetime-local"
              disabled={locked}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              disabled={locked}
              checked={available}
              onChange={(e) => setAvailable(e.target.checked)}
            />
            {available ? c.available : c.unavailable}
          </label>
          {!attempt && !review && (
            <PngPillButton
              disabled={busy || journalBlocked || !snapshot.canManage}
              onClick={() => void prepare()}
            >
              {c.review}
            </PngPillButton>
          )}
        </>
      )}
      {review && (
        <p>
          {review.body.window.plannedStartAt} —{" "}
          {review.body.window.plannedEndAt} ({review.body.window.timezone}) ·{" "}
          {review.body.available ? c.available : c.unavailable}
        </p>
      )}
      {(review || attempt) && (
        <PngPillButton disabled={busy} onClick={() => void save()}>
          {attempt ? c.retry : c.save}
        </PngPillButton>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
