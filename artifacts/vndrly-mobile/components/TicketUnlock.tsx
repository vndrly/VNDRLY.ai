import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { StoredUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
} from "@/lib/auth";
import TogglePillButton from "@/components/TogglePillButton";
type Ticket = { id: number; status: string; lifecycleState: string };
type Unlock = {
  id: number;
  unlockedById: number | null;
  reason: string;
  previousStatus: string;
  unlockedAt: string;
};
type Attempt = { reason: string; status: string; historyIds: number[] };
export default function TicketUnlock(props: {
  ticketId: number;
  status: string;
  user: StoredUser | null;
  onRefresh: () => unknown;
}) {
  const user = props.user;
  const key = [
    props.ticketId,
    user?.id,
    user?.role,
    user?.activeMembershipId,
    user?.vendorId,
    user?.partnerId,
  ].join(":");
  return user?.role === "admin" ? (
    <Panel key={key} {...props} actorId={user.id} />
  ) : null;
}
function Panel({
  ticketId,
  status,
  actorId,
  onRefresh,
}: {
  ticketId: number;
  status: string;
  actorId: number;
  onRefresh: () => unknown;
}) {
  const { i18n } = useTranslation();
  const es = i18n?.language?.startsWith("es") ?? false;
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Attempt | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const scope = useRef(captureAuthScope());
  const locked = useRef(false);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const guard = () => {
    if (!current()) throw Error("Account changed");
  };
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      alive.current = false;
      setReview(null);
      setAttempt(null);
      setReason("");
      setMessage("");
    };
    const a = subscribeUser(clear),
      b = subscribeToken(clear);
    return () => {
      alive.current = false;
      a();
      b();
    };
  }, []);
  async function snapshot() {
    guard();
    const ticket = await apiFetch<Ticket>(`/api/tickets/${ticketId}`);
    guard();
    const history = await apiFetch<Unlock[]>(
      `/api/tickets/${ticketId}/unlocks`,
    );
    guard();
    if (ticket.id !== ticketId || !Array.isArray(history))
      throw Error("Invalid ticket");
    return { ticket, history };
  }
  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      if (current())
        setMessage(
          es
            ? "No se pudo verificar. Consulta el intento original."
            : "Not verified. Check the original unlock.",
        );
      else {
        setReview(null);
        setAttempt(null);
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function reconcile(a: Attempt) {
    const { ticket, history } = await snapshot();
    const saved = history.filter(
      (x) =>
        !a.historyIds.includes(x.id) &&
        x.unlockedById === actorId &&
        x.reason === a.reason &&
        x.previousStatus === a.status &&
        Number.isFinite(Date.parse(x.unlockedAt)),
    );
    if (
      saved.length === 1 &&
      ticket.status === "in_progress" &&
      ticket.lifecycleState === "on_site"
    ) {
      setMessage(es ? "Se registró un desbloqueo coincidente." : "A matching unlock is recorded.");
      setAttempt(null);
      setReview(null);
      try {
        await onRefresh();
      } catch {
        if (current())
          setMessage(
            es
              ? "Se registró un desbloqueo coincidente. Actualiza el ticket."
              : "A matching unlock is recorded. Refresh the ticket.",
          );
      }
    } else
      setMessage(
        es
          ? "Resultado incierto. No se reenviará el desbloqueo."
          : "Outcome uncertain. Unlock will not be resent.",
      );
  }
  if (!attempt && !review && !["submitted", "approved"].includes(status))
    return null;
  return (
    <View>
      <Text>{es ? "Desbloquear para editar" : "Unlock for editing"}</Text>
      <Text>{message}</Text>
      {attempt ? (
        <TogglePillButton
          disabled={busy}
          onPress={() => void run(() => reconcile(attempt))}
        >
          {es ? "Consultar historial de desbloqueos" : "Check unlock history"}
        </TogglePillButton>
      ) : review ? (
        <>
          <Text>{review.reason}</Text>
          <Text>
            {es
              ? "Reabre el ticket para editar."
              : "Reopens the ticket for editing."}
          </Text>
          <TogglePillButton
            disabled={busy}
            onPress={() =>
              void run(async () => {
                guard();
                const fresh = await snapshot();
                if (
                  fresh.ticket.status !== review.status ||
                  fresh.history.some((x) => !review.historyIds.includes(x.id))
                )
                  throw Error("Ticket changed");
                guard();
                setAttempt(review);
                setReview(null);
                try {
                  await apiFetch(`/api/tickets/${ticketId}/unlock`, {
                    method: "POST",
                    body: JSON.stringify({ reason: review.reason }),
                  });
                  guard();
                  await reconcile(review);
                } catch {
                  if (current())
                    setMessage(
                      es
                        ? "Resultado incierto. Consulta el intento original."
                        : "Outcome uncertain. Check the original unlock.",
                    );
                }
              })
            }
          >
            {es ? "Confirmar desbloqueo" : "Confirm unlock"}
          </TogglePillButton>
        </>
      ) : (
        <>
          <TextInput
            placeholder={es ? "Motivo (obligatorio)" : "Reason (required)"}
            value={reason}
            maxLength={500}
            onChangeText={setReason}
          />
          <TogglePillButton
            disabled={busy || !reason.trim()}
            onPress={() =>
              void run(async () => {
                const { ticket, history } = await snapshot();
                if (!["submitted", "approved"].includes(ticket.status))
                  throw Error("Ticket changed");
                setReview({
                  reason: reason.trim(),
                  status: ticket.status,
                  historyIds: history.map((x) => x.id),
                });
              })
            }
          >
            {es ? "Revisar desbloqueo" : "Review unlock"}
          </TogglePillButton>
        </>
      )}
    </View>
  );
}

