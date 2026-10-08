import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { isWorkHubScheduler, ownerForUser } from "@/lib/work-hub-client";
import { PngPillButton } from "@/components/png-pill-rollover";
import { makeWorkHubShiftOpeningAttempt, submitWorkHubShiftOpeningAttempt, workHubShiftOpeningFingerprintValues, type WorkHubShiftOpeningAttempt } from "@workspace/api-zod";

const copy = {
  en: { title: "Shift claiming", select: "Choose a shift", review: "Review change", save: "Save reviewed change", retry: "Check the same request", open: "Open for claims", close: "Close to claims", note: "Changes planning only. Does not start duty, timekeeping, or tracking.", unknown: "The result is unresolved. Check the same request before making another change.", saved: "Change saved.", refresh: "Change saved. Calendar refresh failed.", unavailable: "This shift cannot be changed. Refresh the calendar.", journal: "A saved request could not be verified. Do not create a replacement request.", load: "The shift could not be loaded." },
  es: { title: "Solicitudes de turnos", select: "Elegir un turno", review: "Revisar cambio", save: "Guardar cambio revisado", retry: "Consultar la misma solicitud", open: "Abrir para solicitudes", close: "Cerrar solicitudes", note: "Solo cambia la planificación. No inicia servicio, reloj ni seguimiento.", unknown: "El resultado no está resuelto. Consulte la misma solicitud antes de otro cambio.", saved: "Cambio guardado.", refresh: "Cambio guardado. No se pudo actualizar el calendario.", unavailable: "No se puede cambiar este turno. Actualice el calendario.", journal: "No se pudo verificar una solicitud guardada. No cree otra solicitud.", load: "No se pudo cargar el turno." },
};
type ShiftRow = { item?: { id: string; title?: string }; id?: string; title?: string };
export default function ShiftOpening({ shifts, onSaved }: { shifts: ShiftRow[]; onSaved: () => Promise<unknown> }) {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  if (!user || !owner || !isWorkHubScheduler(user)) return null;
  const identity = JSON.stringify([user.userId, user.activeMembershipId, user.role, user.availableMemberships?.map(membership => [membership.id, membership.role]), user.vendorRole, owner]);
  return <Panel key={identity} identity={identity} actor={user.userId} owner={owner} shifts={shifts} onSaved={onSaved} />;
}
function Panel({ identity, actor, owner, shifts, onSaved }: { identity: string; actor: number; owner: { type: "vendor" | "partner"; id: number }; shifts: ShiftRow[]; onSaved: () => Promise<unknown> }) {
  const { i18n } = useTranslation();
  const c = copy[i18n.language.startsWith("es") ? "es" : "en"];
  const key = `work-hub-shift-opening:${identity}`;
  const alive = useRef(true), lock = useRef(false);
  const [selected, setSelected] = useState("");
  const [attempt, setAttempt] = useState<WorkHubShiftOpeningAttempt | null>(null);
  const [sent, setSent] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [invalid, setInvalid] = useState(false);
  useEffect(() => {
    alive.current = true;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      try {
        const value = JSON.parse(stored) as WorkHubShiftOpeningAttempt;
        if (value.actorUserId !== actor || value.owner.type !== owner.type || value.owner.id !== owner.id || !/^[a-f0-9]{64}$/.test(value.commandFingerprint)) throw Error("journal");
        setAttempt(value); setSent(true); setMessage(c.unknown);
      } catch { setInvalid(true); setMessage(c.journal); }
    }
    return () => { alive.current = false; };
  }, [key]);
  const assertCurrent = () => { if (!alive.current) throw Error("account_changed"); };
  async function http(path: string, method: "GET" | "PATCH", body?: unknown) {
    assertCurrent();
    const response = await fetch(`/api${path}`, { method, credentials: "include", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assertCurrent();
    if (!response.ok) throw Error(`http_${response.status}`);
    const result: unknown = await response.json(); assertCurrent(); return result;
  }
  async function review() {
    if (lock.current || attempt || invalid || !selected) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const result = await http(`/work-hub/calendar/items/shift/${encodeURIComponent(selected)}`, "GET") as { item: { id: string; title: string; ownerOrgType: string; ownerOrgId: number; version: number; open: boolean; startsAt: string; endsAt: string; milestoneStatus: string; assigneeUserIds: number[]; siteLocationId?: number } };
      const item = result.item;
      if (!item || item.id !== selected || item.ownerOrgType !== owner.type || item.ownerOrgId !== owner.id || typeof item.open !== "boolean" || !Array.isArray(item.assigneeUserIds) || item.assigneeUserIds.length || Date.parse(item.startsAt) <= Date.now() || !Number.isFinite(Date.parse(item.startsAt)) || ["cancelled", "completed"].includes(item.milestoneStatus)) throw Error("unavailable");
      const input = { operationId: crypto.randomUUID(), expectedVersion: item.version, open: !item.open };
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(workHubShiftOpeningFingerprintValues(selected, actor, owner.type, owner.id, input))));
      assertCurrent();
      const hash = Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
      const next = makeWorkHubShiftOpeningAttempt({ actorUserId: actor, shiftId: selected, owner, context: item.siteLocationId ? { kind: "gate", id: item.siteLocationId } : { kind: "organization", id: owner.id }, input }, () => hash);
      sessionStorage.setItem(key, JSON.stringify(next)); setAttempt(next); setSent(false);
    } catch (error) { if (alive.current) setMessage(error instanceof Error && error.message === "unavailable" ? c.unavailable : c.load); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function save() {
    if (lock.current || !attempt || invalid) return;
    lock.current = true; setBusy(true); setSent(true);
    try {
      const values = workHubShiftOpeningFingerprintValues(attempt.shiftId, actor, owner.type, owner.id, attempt.input);
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(values)));
      assertCurrent();
      const hash = Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
      if (hash !== attempt.commandFingerprint) { setInvalid(true); setMessage(c.journal); return; }
      await submitWorkHubShiftOpeningAttempt(attempt, http, () => hash); assertCurrent();
      sessionStorage.removeItem(key); setAttempt(null); setMessage(c.saved);
      try { await onSaved(); assertCurrent(); } catch { if (alive.current) setMessage(c.refresh); }
    } catch { if (alive.current) setMessage(c.unknown); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="mb-4 rounded-lg border p-4" aria-label={c.title}>
    <h2>{c.title}</h2><p>{c.note}</p>
    <select aria-label={c.select} value={selected} disabled={busy || Boolean(attempt) || invalid} onChange={e => setSelected(e.target.value)}><option value="">{c.select}</option>{shifts.map(row => row.item ?? row).filter(row => row.id).map(row => <option key={row.id} value={row.id}>{row.title ?? row.id}</option>)}</select>
    {!attempt && <PngPillButton color="blue" disabled={busy || !selected || invalid} onClick={() => void review()}>{c.review}</PngPillButton>}
    {attempt && <><p>{attempt.input.open ? c.open : c.close} · {attempt.shiftId} · v{attempt.input.expectedVersion}</p><PngPillButton color="blue" disabled={busy} onClick={() => void save()}>{sent ? c.retry : c.save}</PngPillButton></>}
    {message && <p role="status">{message}</p>}
  </section>;
}
