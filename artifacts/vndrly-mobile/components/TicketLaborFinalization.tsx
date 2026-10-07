import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useTranslation } from "react-i18next";
import { TicketLaborFinalizationInputSchema, finalizeTicketLaborAttempt, type TicketLaborFinalizationInput } from "@workspace/api-zod";
import { captureAuthScope, isAuthScopeCurrent, type StoredUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import TogglePillButton from "@/components/TogglePillButton";

export default function TicketLaborFinalization(props: { ticketId: number; updatedAt: string; canFinalize: boolean; user: StoredUser | null; onRefresh: () => unknown; disabled?: boolean }) {
  const identity = [props.user?.id, props.user?.role, props.user?.activeMembershipId, props.user?.vendorId, props.user?.partnerId, props.ticketId].join(".");
  return props.user ? <Panel key={identity} {...props} actorId={props.user.id} identity={identity} /> : null;
}
function Panel({ ticketId, updatedAt, canFinalize, actorId, identity, onRefresh, disabled }: { ticketId: number; updatedAt: string; canFinalize: boolean; actorId: number; identity: string; onRefresh: () => unknown; disabled?: boolean }) {
  const { t, i18n } = useTranslation(), es = i18n.language.startsWith("es");
  const key = "vndrly.labor-finalize." + identity;
  const scope = useRef(captureAuthScope()), alive = useRef(true), locked = useRef(false);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const [attempt, setAttempt] = useState<TicketLaborFinalizationInput | null>(null);
  const [conflictedAt, setConflictedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [review, setReview] = useState(false), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    alive.current = true;
    void SecureStore.getItemAsync(key).then(raw => {
      if (!current()) return;
      if (raw) setAttempt(TicketLaborFinalizationInputSchema.parse(JSON.parse(raw)));
      setReady(true);
    }).catch(() => { if (current()) setMessage(es ? "No se pudo leer la solicitud guardada." : "Could not read the saved request."); });
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (conflictedAt !== null && updatedAt !== conflictedAt && current()) {
      setConflictedAt(null); setReview(false); setMessage("");
    }
  }, [updatedAt, conflictedAt]);
  async function save() {
    if (locked.current || !current() || !ready) return;
    locked.current = true; setBusy(true);
    let posted = false;
    try {
      const command = attempt ?? TicketLaborFinalizationInputSchema.parse({ operationId: Crypto.randomUUID(), expectedUpdatedAt: updatedAt });
      await SecureStore.setItemAsync(key, JSON.stringify(command));
      if (!current()) return;
      setAttempt(command);
      await finalizeTicketLaborAttempt(ticketId, actorId, command, async (path, body) => {
        if (!current()) throw Error("Account changed");
        if (body) posted = true;
        return apiFetch("/api" + path, { ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) }, scope.current);
      }, current);
      if (!current()) return;
      await SecureStore.deleteItemAsync(key);
      if (!current()) return;
      setAttempt(null); setSaved(true); setReview(false);
      setMessage(es ? "Totales registrados guardados y congelados." : "Recorded labor totals saved and frozen.");
      void Promise.resolve().then(() => { if (current()) return onRefresh(); }).catch(() => {
        if (current()) setMessage(es ? "Totales guardados y congelados. No se pudo actualizar la vista; actualícela para ver el estado guardado." : "Totals saved and frozen. The view could not refresh; refresh to see the saved state.");
      });
    } catch (error) {
      if (!current()) return;
      if (posted && [400, 409].includes((error as { status?: number }).status ?? 0)) {
        await SecureStore.deleteItemAsync(key);
        if (!current()) return;
        setAttempt(null); setReview(false); setConflictedAt(attempt?.expectedUpdatedAt ?? updatedAt);
        setMessage(t("tickets.errorCloseTicket") + " " + (es ? "El ticket cambió. Actualice antes de revisar otra solicitud." : "The ticket changed. Refresh before reviewing another request."));
        void Promise.resolve().then(() => { if (current()) return onRefresh(); }).catch(() => {});
      } else setMessage(es ? "Resultado sin resolver. Compruebe la misma solicitud." : "Result unresolved. Check the same request.");
    } finally { locked.current = false; if (current()) setBusy(false); }
  }
  if (!canFinalize && !attempt && !message) return null;
  return <View accessibilityLabel={t("tickets.closeTicket")}>
    {review ? <Text>{t("tickets.closeTicketTitle")}</Text> : null}
    <Text>{t("tickets.closeTicketBody")}</Text>
    <Text>{es ? "Congela totales registrados; no envía el ticket ni verifica el trabajo físico." : "Freeze recorded totals; this does not submit the ticket or verify physical work."}</Text>
    {message ? <Text accessibilityRole="text">{message}</Text> : null}
    {attempt || (canFinalize && !saved && conflictedAt === null) ? <TogglePillButton disabled={!ready || busy || disabled} onPress={() => attempt || review ? void save() : setReview(true)}>{attempt ? es ? "Comprobar solicitud guardada" : "Check saved request" : review ? es ? "Confirmar congelación" : "Confirm freeze" : es ? "Cerrar totales registrados" : "Finalize recorded labor"}</TogglePillButton> : null}
  </View>;
}
