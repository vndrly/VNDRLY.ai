import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
  type StoredUser,
} from "@/lib/auth";
import TogglePillButton from "@/components/TogglePillButton";
const eligible = ["denied", "awaiting_acceptance", "initiated"];
const ticketSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  vendorId: z.number().nullable().optional(),
  lifecycleState: z.string().nullable().optional(),
  preCancelStatus: z.string().nullable().optional(),
});
const transitionSchema = z.object({
  id: z.number().int().positive(),
  ticketId: z.number().int().positive(),
  actorUserId: z.number().nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string().refine((v) => Number.isFinite(Date.parse(v))),
});
const vendorSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  isCurrentlyInvited: z.boolean(),
});
const choicesSchema = z.object({
  approved: z.array(vendorSchema),
  unapproved: z.array(vendorSchema),
});
type Vendor = z.infer<typeof vendorSchema> & { approved: boolean };
type Snapshot = {
  ticket: z.infer<typeof ticketSchema>;
  history: z.infer<typeof transitionSchema>[];
};
type Review = { before: Snapshot; vendor?: Vendor };
type Props = {
  user: StoredUser | null;
  ticketId: number;
  status: string;
  onRefresh: () => unknown;
};
export default function TicketRecovery(props: Props) {
  const key = [
    props.ticketId,
    props.user?.id,
    props.user?.role,
    props.user?.activeMembershipId,
    props.user?.partnerId,
    props.user?.vendorId,
  ].join(":");
  return <Entry key={key} {...props} />;
}
function Entry(props: Props) {
  const [open, setOpen] = useState(false);
  const { i18n } = useTranslation();
  const es = i18n?.language?.startsWith("es") ?? false;
  const action =
    props.user?.role === "admin" && props.status === "cancelled"
      ? "reactivate"
      : props.user?.role === "partner" && eligible.includes(props.status)
        ? "reinvite"
        : null;
  // Keep an opened uncertain attempt mounted across status refreshes; scope changes remount Entry.
  const original = useRef<"reactivate" | "reinvite" | null>(null);
  if (open && original.current && props.user)
    return <Panel {...props} actor={props.user} action={original.current} />;
  if (!action) return null;
  return (
    <TogglePillButton
      onPress={() => {
        original.current = action;
        setOpen(true);
      }}
    >
      {action === "reactivate"
        ? es
          ? "Restaurar ticket cancelado"
          : "Restore cancelled ticket"
        : es
          ? "Buscar otro proveedor"
          : "Find another vendor"}
    </TogglePillButton>
  );
}
function Panel({
  ticketId,
  actor,
  action,
  onRefresh,
}: Props & { actor: StoredUser; action: "reinvite" | "reactivate" }) {
  const { i18n } = useTranslation();
  const es = i18n?.language?.startsWith("es") ?? false;
  const [ready, setReady] = useState<Snapshot | null>(null),
    [vendors, setVendors] = useState<Vendor[]>([]),
    [selected, setSelected] = useState<Vendor | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [attempt, setAttempt] = useState<Review | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const alive = useRef(true),
    scope = useRef(captureAuthScope()),
    lock = useRef(false);
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  const guard = () => {
    if (!current()) throw Error("Account changed");
  };
  async function snapshot(): Promise<Snapshot> {
    guard();
    const ticket = ticketSchema.parse(
      await apiFetch(`/api/tickets/${ticketId}`),
    );
    guard();
    const history = z
      .array(transitionSchema)
      .parse(await apiFetch(`/api/tickets/${ticketId}/transitions`));
    guard();
    if (ticket.id !== ticketId || history.some((x) => x.ticketId !== ticketId))
      throw Error("Wrong ticket");
    return { ticket, history };
  }
  function permitted(s: Snapshot) {
    return action === "reactivate"
      ? actor.role === "admin" && s.ticket.status === "cancelled"
      : actor.role === "partner" && eligible.includes(s.ticket.status);
  }
  async function choices(s: Snapshot) {
    guard();
    const data = choicesSchema.parse(
      await apiFetch(`/api/tickets/${ticketId}/nearby-vendors`),
    );
    guard();
    return [
      ...data.approved.map((x) => ({ ...x, approved: true })),
      ...data.unapproved.map((x) => ({ ...x, approved: false })),
    ].filter((x) => !x.isCurrentlyInvited && x.id !== s.ticket.vendorId);
  }
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await work();
    } catch {
      if (current())
        setMessage(
          es
            ? "Ticket actual no disponible. Actualiza para revisar."
            : "Current ticket unavailable. Refresh to review.",
        );
      else {
        setReview(null);
        setAttempt(null);
        setReady(null);
        setVendors([]);
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      alive.current = false;
      setReady(null);
      setVendors([]);
      setSelected(null);
      setReview(null);
      setAttempt(null);
      setMessage("");
    };
    const a = subscribeUser(clear),
      b = subscribeToken(clear);
    void run(async () => {
      const s = await snapshot();
      if (!permitted(s)) throw Error("Not eligible");
      const v = action === "reinvite" ? await choices(s) : [];
      guard();
      setReady(s);
      setVendors(v);
    });
    return () => {
      alive.current = false;
      a();
      b();
    };
  }, []);
  function same(a: Snapshot, b: Snapshot) {
    return (
      a.ticket.status === b.ticket.status &&
      a.ticket.vendorId === b.ticket.vendorId &&
      a.ticket.preCancelStatus === b.ticket.preCancelStatus &&
      JSON.stringify(a.history.map((x) => x.id).sort((x, y) => x - y)) ===
        JSON.stringify(b.history.map((x) => x.id).sort((x, y) => x - y))
    );
  }
  async function reconcile(r: Review) {
    const fresh = await snapshot();
    const matches = fresh.history.filter(
      (x) =>
        !r.before.history.some((old) => old.id === x.id) &&
        x.actorUserId === actor.id &&
        x.fromStatus === r.before.ticket.status &&
        (action === "reactivate"
          ? x.reason === "ticket reactivated" &&
            x.toStatus === fresh.ticket.status
          : x.toStatus === "awaiting_acceptance" &&
            x.reason ===
              `reassigned from vendor #${r.before.ticket.vendorId} to vendor #${r.vendor?.id}`),
    );
    if (
      matches.length === 1 &&
      (action === "reactivate"
        ? fresh.ticket.status !== "cancelled"
        : fresh.ticket.vendorId === r.vendor?.id)
    ) {
      setMessage(
        es
          ? `Se registró una transición coincidente (#${matches[0].id}).`
          : `A matching transition is recorded (#${matches[0].id}).`,
      );
      setAttempt(null);
      setReview(null);
      setReady(null);
      try {
        await onRefresh();
      } catch {
        if (current())
          setMessage(
            es
              ? "Transición coincidente registrada. Actualiza el ticket."
              : "Matching transition recorded. Refresh the ticket.",
          );
      }
    } else
      setMessage(
        es
          ? "Resultado incierto. Este comando no se reenviará."
          : "Outcome uncertain. This command will not be resent.",
      );
  }
  const reviewLabel =
    action === "reactivate"
      ? es
        ? "Revisar restauración"
        : "Review restoration"
      : es
        ? "Revisar invitación"
        : "Review reinvite";
  const confirmLabel =
    action === "reactivate"
      ? es
        ? "Confirmar restauración"
        : "Confirm restoration"
      : es
        ? "Confirmar invitación"
        : "Confirm reinvite";
  return (
    <View>
      <Text>{message}</Text>
      {attempt ? (
        <TogglePillButton
          disabled={busy}
          onPress={() => void run(() => reconcile(attempt))}
        >
          {es ? "Consultar historial del ticket" : "Check ticket history"}
        </TogglePillButton>
      ) : review ? (
        <>
          <Text>
            {es
              ? "Revisa el ticket exacto antes de confirmar."
              : "Review this exact ticket before confirming."}{" "}
            #{ticketId}
          </Text>
          <Text>
            {review.before.ticket.status} →{" "}
            {action === "reinvite"
              ? "awaiting_acceptance"
              : es
                ? "estado previo guardado (servidor)"
                : "saved prior status (server)"}
          </Text>
          {review.vendor ? <Text>{review.vendor.name}</Text> : null}
          <TogglePillButton
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const fresh = await snapshot();
                if (!permitted(fresh) || !same(fresh, review.before))
                  throw Error("Ticket changed");
                if (review.vendor) {
                  const v = await choices(fresh);
                  if (!v.some((x) => x.id === review.vendor?.id))
                    throw Error("Vendor unavailable");
                  const latest = await snapshot();
                  if (!same(latest, fresh)) throw Error("Ticket changed");
                }
                guard();
                setAttempt(review);
                setReview(null);
                try {
                  await apiFetch(`/api/tickets/${ticketId}/${action}`, {
                    method: "POST",
                    body: JSON.stringify(
                      action === "reinvite"
                        ? { vendorId: review.vendor!.id }
                        : {},
                    ),
                  });
                  guard();
                  await reconcile(review);
                } catch {
                  if (current())
                    setMessage(
                      es
                        ? "Resultado incierto. Consulta el historial."
                        : "Outcome uncertain. Check ticket history.",
                    );
                }
              })
            }
          >
            {confirmLabel}
          </TogglePillButton>
        </>
      ) : ready ? (
        <>
          {action === "reinvite" ? (
            <>
              <Text>
                {es
                  ? "Proveedores sugeridos; no confirma disponibilidad."
                  : "Suggested vendors; availability is not confirmed."}
              </Text>
              {vendors.slice(0, 50).map((v) => (
                <View key={v.id}>
                  <TogglePillButton
                    onPress={() => setSelected(v)}
                    disabled={busy}
                  >
                    {v.name}
                  </TogglePillButton>
                  <Text>
                    {v.approved
                      ? es
                        ? "Relación aprobada"
                        : "Approved relationship"
                      : es
                        ? "Relación no aprobada"
                        : "Unapproved relationship"}
                  </Text>
                </View>
              ))}
              {vendors.length > 50 ? (
                <Text>
                  {es ? "Se muestran los primeros 50." : "First 50 shown."}
                </Text>
              ) : null}
            </>
          ) : (
            <Text>
              {es
                ? "Restaura el estado anterior guardado; no inicia ubicación ni captura."
                : "Restores the saved prior status; does not start location or capture."}
            </Text>
          )}
          <TogglePillButton
            disabled={busy || (action === "reinvite" && !selected)}
            onPress={() =>
              void run(async () => {
                const fresh = await snapshot();
                if (!permitted(fresh) || !same(fresh, ready))
                  throw Error("Ticket changed");
                setReview({
                  before: fresh,
                  ...(selected ? { vendor: selected } : {}),
                });
              })
            }
          >
            {reviewLabel}
          </TogglePillButton>
        </>
      ) : null}
    </View>
  );
}
