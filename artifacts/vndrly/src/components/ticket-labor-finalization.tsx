import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { PngPillButton } from "@/components/png-pill-rollover";
import { TicketLaborFinalizationInputSchema, finalizeTicketLaborAttempt, type TicketLaborFinalizationInput } from "@workspace/api-zod";

export default function TicketLaborFinalization({ ticketId, updatedAt, canFinalize, onSaved }: { ticketId: number; updatedAt: string; canFinalize: boolean; onSaved: () => unknown }) {
  const { user } = useAuth();
  const identity = [user?.userId, user?.role, user?.activeMembershipId, user?.vendorId, user?.partnerId, ticketId].join(":");
  return user ? <Panel key={identity} identity={identity} actorId={user.userId} ticketId={ticketId} updatedAt={updatedAt} canFinalize={canFinalize} onSaved={onSaved} /> : null;
}
function Panel({ identity, actorId, ticketId, updatedAt, canFinalize, onSaved }: { identity: string; actorId: number; ticketId: number; updatedAt: string; canFinalize: boolean; onSaved: () => unknown }) {
  const { i18n } = useTranslation(), es = i18n.language.startsWith("es");
  const storageKey = "vndrly-labor-finalize:" + identity;
  const [attempt, setAttempt] = useState<TicketLaborFinalizationInput | null>(() => { try { const raw = sessionStorage.getItem(storageKey); return raw ? TicketLaborFinalizationInputSchema.parse(JSON.parse(raw)) : null; } catch { return null; } });
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [conflictedAt, setConflictedAt] = useState<string | null>(null);
  const alive = useRef(true), lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (conflictedAt !== null && updatedAt !== conflictedAt && alive.current) {
      setConflictedAt(null); setReview(false); setMessage("");
    }
  }, [updatedAt, conflictedAt]);
  async function save() {
    if (lock.current || !alive.current) return;
    lock.current = true; setBusy(true);
    controller.current = new AbortController();
    let posted = false, journaled = false;
    try {
      const command = attempt ?? TicketLaborFinalizationInputSchema.parse({ operationId: crypto.randomUUID(), expectedUpdatedAt: updatedAt });
      sessionStorage.setItem(storageKey, JSON.stringify(command)); journaled = true; setAttempt(command);
      await finalizeTicketLaborAttempt(ticketId, actorId, command, async (path, body) => {
        if (!alive.current) throw Error("account changed");
        if (body) posted = true;
        const response = await fetch("/api" + path, { credentials: "include", signal: controller.current?.signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
        if (!response.ok) throw Object.assign(Error("request failed"), { status: response.status });
        return response.json();
      }, () => alive.current);
      if (!alive.current) return;
      sessionStorage.removeItem(storageKey); setAttempt(null); setReview(false); setSaved(true); setMessage(es ? "Totales de mano de obra guardados y congelados." : "Recorded labor totals saved and frozen.");
      void Promise.resolve().then(() => alive.current ? onSaved() : undefined).catch(() => {
        if (alive.current) setMessage(es ? "Totales guardados y congelados. No se pudo actualizar la vista; actualícela para ver el estado guardado." : "Totals saved and frozen. The view could not refresh; refresh to see the saved state.");
      });
    } catch (error) {
      if (!alive.current) return;
      if (!journaled) setMessage(es ? "No se pudo guardar la solicitud. No se envió ningún cambio." : "Could not save the request. No change was sent.");
      else if (posted && [400, 409].includes((error as { status?: number }).status ?? 0)) {
        sessionStorage.removeItem(storageKey); setAttempt(null); setReview(false); setConflictedAt(attempt?.expectedUpdatedAt ?? updatedAt);
        setMessage(es ? "El ticket cambió. Actualice y revise antes de intentar otra vez." : "The ticket changed. Refresh and review before trying again.");
        void Promise.resolve().then(() => alive.current ? onSaved() : undefined).catch(() => {});
      }
      else setMessage(es ? "Resultado sin resolver. Compruebe la misma solicitud antes de reintentar." : "Result unresolved. Check the same request before retrying.");
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  if (!canFinalize && !attempt && !message) return null;
  return <section className="space-y-2" aria-label={es ? "Cerrar totales de mano de obra" : "Finalize recorded labor"}>
    <p>{es ? "Congela los totales registrados para revisión contable. No envía el ticket ni verifica el trabajo físico." : "Freeze recorded labor totals for accounting review. This does not submit the ticket or verify physical work."}</p>
    {message && <p role="status">{message}</p>}
    {attempt ? <PngPillButton color="blue" disabled={busy} onClick={() => void save()}>{es ? "Comprobar solicitud guardada" : "Check saved request"}</PngPillButton> : canFinalize && !saved && conflictedAt === null && <PngPillButton color="blue" disabled={busy} onClick={() => review ? void save() : setReview(true)}>{review ? es ? "Confirmar congelación" : "Confirm freeze" : es ? "Cerrar totales registrados" : "Finalize recorded labor"}</PngPillButton>}
  </section>;
}
