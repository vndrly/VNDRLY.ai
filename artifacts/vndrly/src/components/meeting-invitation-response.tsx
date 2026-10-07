import { useEffect, useRef, useState } from "react";
import { z } from "zod/v4";
import { useTranslation } from "react-i18next";
import {
  WorkHubCalendarResponseInputSchema,
  WorkHubCalendarResponseObservationSchema,
  WorkHubCalendarResponseResultSchema,
  type WorkHubCalendarResponseInput,
  type WorkHubCalendarResponseObservation,
} from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { PngPillButton } from "@/components/png-pill-rollover";

const reviewedSchema = z
  .object({
    input: WorkHubCalendarResponseInputSchema,
    title: z.string().min(1).max(200),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    timezone: z.string().min(1).max(80),
  })
  .strict();
type Reviewed = z.infer<typeof reviewedSchema>;
const words = {
  en: {
    title: "Invitation response",
    refresh: "Read current invitation",
    accept: "Review acceptance",
    decline: "Review decline",
    confirm: "Save my reviewed response",
    retry: "Check saved response and retry",
    reReview: "Review changed invitation as a new request",
    unknown:
      "Response unverified. Keep this exact request; check its saved result before retrying.",
    saved:
      "Your response was recorded. This does not join audio or grant recording consent.",
    unavailable: "Invitation response is unavailable in this current account.",
    review: "Review your response to this exact schedule:",
    scope:
      "Only recorded responses to this schedule are verified. Attendance and external invitation delivery are separate.",
    accepted: "Accepted",
    declined: "Declined",
    pending: "Pending",
    unknownResponse: "Unknown",
    host: "Current participants' recorded responses",
    own: "Your recorded response",
  },
  es: {
    title: "Respuesta a la invitación",
    refresh: "Leer invitación actual",
    accept: "Revisar aceptación",
    decline: "Revisar rechazo",
    confirm: "Guardar mi respuesta revisada",
    retry: "Consultar respuesta guardada y reintentar",
    reReview: "Revisar invitación modificada como solicitud nueva",
    unknown:
      "Respuesta sin verificar. Conserve esta solicitud exacta y consulte el resultado antes de reintentar.",
    saved:
      "Su respuesta fue guardada. Esto no inicia audio ni autoriza grabación.",
    unavailable: "La respuesta no está disponible en esta cuenta actual.",
    review: "Revise su respuesta a este horario exacto:",
    scope:
      "Solo se verifican respuestas guardadas para este horario. Asistencia y entrega externa son independientes.",
    accepted: "Aceptada",
    declined: "Rechazada",
    pending: "Pendiente",
    unknownResponse: "Desconocida",
    host: "Respuestas guardadas de participantes actuales",
    own: "Su respuesta guardada",
  },
};
export default function MeetingInvitationResponse({
  occurrenceId,
}: {
  occurrenceId: string;
}) {
  const { user } = useAuth();
  if (
    !user?.userId ||
    !user.activeMembershipId ||
    !["vendor", "partner", "field_employee"].includes(user.role)
  )
    return null;
  const identity = JSON.stringify([
    user.userId,
    user.role,
    user.activeMembershipId,
    user.vendorId,
    user.partnerId,
  ]);
  return (
    <ResponsePanel
      key={identity + occurrenceId}
      identity={identity}
      userId={user.userId}
      ownerType={user.role === "partner" ? "partner" : "vendor"}
      ownerId={user.role === "partner" ? user.partnerId : user.vendorId}
      occurrenceId={occurrenceId}
    />
  );
}
function ResponsePanel({
  identity,
  userId,
  ownerType,
  ownerId,
  occurrenceId,
}: {
  identity: string;
  userId: number;
  ownerType: "vendor" | "partner";
  ownerId: number | null;
  occurrenceId: string;
}) {
  const { i18n } = useTranslation(),
    c = words[i18n.language.startsWith("es") ? "es" : "en"];
  const storageKey = "vndrly-meeting-response:" + identity + ":" + occurrenceId;
  const [data, setData] = useState<WorkHubCalendarResponseObservation | null>(
      null,
    ),
    [attempt, setAttempt] = useState<Reviewed | null>(() => {
      try {
        const parsed = reviewedSchema.safeParse(
          JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
        );
        return parsed.success && parsed.data.input.occurrenceId === occurrenceId
          ? parsed.data
          : null;
      } catch {
        return null;
      }
    }),
    [canReviewAgain, setCanReviewAgain] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const reviewedRef = useRef(attempt),
    sending = useRef(false);
  const alive = useRef(true),
    controllers = useRef(new Set<AbortController>());
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      for (const ctrl of controllers.current) ctrl.abort();
    };
  }, []);
  async function load() {
    const ctrl = new AbortController();
    controllers.current.add(ctrl);
    try {
      const value = WorkHubCalendarResponseObservationSchema.parse(
        await workHubRequest(`/calendar-response/${occurrenceId}/snapshot`, {
          signal: ctrl.signal,
        }),
      );
      if (
        value.actorUserId !== userId ||
        value.snapshot.occurrenceId !== occurrenceId ||
        value.snapshot.ownerType !== ownerType ||
        value.snapshot.ownerId !== ownerId ||
        !value.snapshot.participantUserIds.includes(userId) ||
        (!value.canManage && value.responses.some((r) => r.userId !== userId))
      )
        throw Error("Account mismatch");
      if (alive.current) {
        setData(value);
        return value;
      }
    } catch {
      if (alive.current) {
        setData(null);
        setMessage(c.unavailable);
      }
    } finally {
      controllers.current.delete(ctrl);
    }
    return null;
  }
  function prepare(response: WorkHubCalendarResponseInput["response"]) {
    if (
      !data ||
      reviewedRef.current ||
      sending.current ||
      busy ||
      data.snapshot.status !== "scheduled"
    )
      return;
    const next = WorkHubCalendarResponseInputSchema.parse({
      operationId: crypto.randomUUID(),
      occurrenceId,
      expectedFingerprint: data.fingerprint,
      response,
    });
    const reviewed = reviewedSchema.parse({
      input: next,
      title: data.snapshot.title,
      startsAt: data.snapshot.startsAt,
      endsAt: data.snapshot.endsAt,
      timezone: data.snapshot.timezone,
    });
    sessionStorage.setItem(storageKey, JSON.stringify(reviewed));
    reviewedRef.current = reviewed;
    setAttempt(reviewed);
    setMessage("");
  }
  async function validateResult(
    value: unknown,
    input: WorkHubCalendarResponseInput,
  ) {
    const result = WorkHubCalendarResponseResultSchema.parse(value);
    if (!result.receipt) return null;
    const r = result.receipt;
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          input: WorkHubCalendarResponseInputSchema.parse(input),
          actorUserId: userId,
        }),
      ),
    );
    const hash = Array.from(new Uint8Array(bytes), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (
      r.operationId !== input.operationId ||
      r.occurrenceId !== input.occurrenceId ||
      r.actorUserId !== userId ||
      r.response !== input.response ||
      r.scheduleFingerprint !== input.expectedFingerprint ||
      r.commandFingerprint !== hash
    )
      throw Error("Receipt mismatch");
    return r;
  }
  async function save() {
    if (!attempt || sending.current || busy) return;
    sending.current = true;
    const input = attempt.input,
      ctrl = new AbortController();
    controllers.current.add(ctrl);
    setBusy(true);
    setCanReviewAgain(false);
    try {
      const receipt = await validateResult(
        await workHubRequest("/calendar-response/readback", {
          method: "POST",
          body: JSON.stringify(input),
          signal: ctrl.signal,
        }),
        input,
      );
      if (!alive.current) return;
      if (!receipt) {
        const current = await load();
        if (!alive.current) return;
        if (!current) throw Error("Invitation unavailable");
        if (
          current.fingerprint !== input.expectedFingerprint ||
          current.snapshot.status !== "scheduled"
        ) {
          setCanReviewAgain(true);
          throw Error("Schedule changed");
        }
        const saved = await validateResult(
          await workHubRequest("/calendar-response/execute", {
            method: "POST",
            body: JSON.stringify(input),
            signal: ctrl.signal,
          }),
          input,
        );
        if (!saved) throw Error("Missing saved receipt");
      }
      if (!alive.current) return;
      sessionStorage.removeItem(storageKey);
      reviewedRef.current = null;
      setAttempt(null);
      setData(null);
      setMessage(c.saved);
      await load();
    } catch {
      if (alive.current) setMessage(c.unknown);
    } finally {
      controllers.current.delete(ctrl);
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="mt-4 grid gap-3 rounded-lg border p-4"
      aria-label={c.title}
    >
      <h2>{c.title}</h2>
      <p>{c.scope}</p>
      <PngPillButton disabled={busy} onClick={() => void load()}>
        {c.refresh}
      </PngPillButton>
      {data && (
        <>
          <h3>{data.canManage ? c.host : c.own}</h3>
          {data.responses.map((r) => (
            <p key={r.userId}>
              {r.userId === userId ? c.own : `#${r.userId}`} ·{" "}
              {r.scheduleResponseVerified
                ? r.response === "accepted"
                  ? c.accepted
                  : c.declined
                : r.response === "pending"
                  ? c.pending
                  : c.unknownResponse}
            </p>
          ))}
          {!attempt && data.snapshot.status === "scheduled" && (
            <div>
              <PngPillButton
                disabled={busy}
                onClick={() => prepare("accepted")}
              >
                {c.accept}
              </PngPillButton>
              <PngPillButton
                disabled={busy}
                onClick={() => prepare("declined")}
              >
                {c.decline}
              </PngPillButton>
            </div>
          )}
        </>
      )}
      {attempt && (
        <div>
          <p>
            {c.review} {attempt.title} ·{" "}
            {attempt.input.response === "accepted" ? c.accepted : c.declined} ·{" "}
            {attempt.startsAt} – {attempt.endsAt ?? ""} ({attempt.timezone})
          </p>
          <PngPillButton disabled={busy} onClick={() => void save()}>
            {message === c.unknown ? c.retry : c.confirm}
          </PngPillButton>
        </div>
      )}
      {canReviewAgain && (
        <PngPillButton
          disabled={busy}
          onClick={() => {
            sessionStorage.removeItem(storageKey);
            reviewedRef.current = null;
            setAttempt(null);
            setCanReviewAgain(false);
            setMessage("");
          }}
        >
          {c.reReview}
        </PngPillButton>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
