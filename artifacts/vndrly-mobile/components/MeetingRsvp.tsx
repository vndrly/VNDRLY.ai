import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Crypto from "expo-crypto";
import {
  WorkHubCalendarResponseInputSchema,
  WorkHubCalendarResponseObservationSchema,
  type WorkHubCalendarResponseObservation,
} from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import {
  captureAuthScope,
  isAuthScopeCurrent,
  subscribeUser,
  subscribeToken,
} from "@/lib/auth";
import {
  makeRsvpAttempt,
  submitRsvpAttempt,
  type RsvpAttempt,
} from "@/lib/meeting-rsvp";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
const copy = {
  en: {
    title: "Invitation response",
    accept: "Accept invitation",
    decline: "Decline invitation",
    retry: "Check original response",
    refresh: "Refresh response",
    error: "Response unavailable. Refresh to review.",
    unknown: "Not verified for the current schedule",
    accepted: "Accepted for the current schedule",
    declined: "Declined for the current schedule",
    pending: "No saved response",
    saved: "Response saved. Refresh to view current schedule.",
    host: "Participant responses",
    boundary:
      "RSVP does not verify attendance, microphone use, recording consent, or invitation delivery.",
  },
  es: {
    title: "Respuesta a la invitación",
    accept: "Aceptar invitación",
    decline: "Rechazar invitación",
    retry: "Consultar respuesta original",
    refresh: "Actualizar respuesta",
    error: "Respuesta no disponible. Actualiza para revisar.",
    unknown: "No verificada para el horario actual",
    accepted: "Aceptada para el horario actual",
    declined: "Rechazada para el horario actual",
    pending: "Sin respuesta guardada",
    saved: "Respuesta guardada. Actualiza para ver el horario actual.",
    host: "Respuestas de participantes",
    boundary:
      "La respuesta no verifica asistencia, uso del micrófono, consentimiento de grabación ni entrega de la invitación.",
  },
};
export default function MeetingRsvp({
  occurrenceId,
}: {
  occurrenceId: string;
}) {
  const { user } = useAuth();
  const key = [
    occurrenceId,
    user?.id,
    user?.activeMembershipId,
    user?.vendorId,
    user?.partnerId,
  ].join(":");
  return user ? (
    <Panel key={key} occurrenceId={occurrenceId} actor={user} />
  ) : null;
}
function Panel({
  occurrenceId,
  actor,
}: {
  occurrenceId: string;
  actor: NonNullable<ReturnType<typeof useAuth>["user"]>;
}) {
  const { i18n } = useTranslation(),
    c = copy[i18n.language.startsWith("es") ? "es" : "en"],
    colors = useColors();
  const [observation, setObservation] =
      useState<WorkHubCalendarResponseObservation | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState<RsvpAttempt | null>(null),
    [saved, setSaved] = useState(false);
  const sending = useRef(false);
  const generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      generation.current++;
      setObservation(null);
      setAttempt(null);
      setSaved(false);
      setError(true);
    };
    const u = subscribeUser(invalidate),
      t = subscribeToken(invalidate);
    return () => {
      mounted.current = false;
      generation.current++;
      u();
      t();
    };
  }, []);
  async function refresh() {
    const n = ++generation.current,
      scope = captureAuthScope();
    setObservation(null);
    setError(false);
    setBusy(true);
    try {
      const parsed = WorkHubCalendarResponseObservationSchema.parse(
        await apiFetch(
          `/api/work-hub/calendar-response/${occurrenceId}/snapshot`,
          undefined,
          scope,
        ),
      );
      if (
        !mounted.current ||
        n !== generation.current ||
        !isAuthScopeCurrent(scope)
      )
        return;
      const owner =
        parsed.snapshot.ownerType === "vendor"
          ? actor.vendorId
          : actor.partnerId;
      if (
        parsed.actorUserId !== actor.id ||
        parsed.snapshot.occurrenceId !== occurrenceId ||
        owner !== parsed.snapshot.ownerId ||
        (!parsed.canManage &&
          parsed.responses.some((r) => r.userId !== actor.id))
      )
        throw Error("Snapshot identity mismatch");
      setObservation(parsed);
    } catch {
      if (mounted.current && n === generation.current) setError(true);
    } finally {
      if (mounted.current && n === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [occurrenceId]);
  async function respond(response: "accepted" | "declined", retry = false) {
    if (sending.current || busy || (!retry && (!observation || attempt)))
      return;
    sending.current = true;
    const n = generation.current,
      scope = captureAuthScope(),
      current = () =>
        mounted.current &&
        n === generation.current &&
        isAuthScopeCurrent(scope);
    setBusy(true);
    setError(false);
    try {
      let exact = attempt;
      if (!retry) {
        const input = WorkHubCalendarResponseInputSchema.parse({
          operationId: Crypto.randomUUID(),
          occurrenceId,
          expectedFingerprint: observation!.fingerprint,
          response,
        });
        const hash = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          JSON.stringify({ input, actorUserId: actor.id }),
        );
        if (!current()) return;
        exact = makeRsvpAttempt(input, actor.id, hash);
        setAttempt(exact);
      }
      if (!exact) throw Error("Missing original response");
      await submitRsvpAttempt(
        exact,
        retry,
        (path, init) => apiFetch(path, init, scope),
        current,
      );
      if (!current()) return;
      setAttempt(null);
      setObservation(null);
      setSaved(true);
    } catch {
      if (current()) setError(true);
    } finally {
      sending.current = false;
      if (current()) setBusy(false);
    }
  }
  const own = observation?.responses.find((r) => r.userId === actor.id),
    label = (r: NonNullable<typeof own>) =>
      r.scheduleResponseVerified
        ? r.response === "accepted"
          ? c.accepted
          : c.declined
        : r.response === "pending"
          ? c.pending
          : c.unknown;
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <Text style={{ color: colors.foreground, fontWeight: "700" }}>
        {c.title}
      </Text>
      <Text style={{ color: colors.foreground }}>{c.boundary}</Text>
      {error && (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {c.error}
        </Text>
      )}
      {saved && <Text style={{ color: colors.foreground }}>{c.saved}</Text>}
      {observation && (
        <Text selectable style={{ color: colors.foreground }}>
          {observation.snapshot.title}
          {" · "}
          {observation.snapshot.startsAt}
          {" → "}
          {observation.snapshot.endsAt ?? "—"}
          {" · "}
          {observation.snapshot.timezone}
        </Text>
      )}
      {own && <Text style={{ color: colors.foreground }}>{label(own)}</Text>}
      {observation?.canManage && (
        <View>
          <Text style={{ color: colors.foreground }}>{c.host}</Text>
          {observation.responses.map((r) => (
            <Text key={r.userId} style={{ color: colors.foreground }}>
              {r.userId}: {label(r)}
            </Text>
          ))}
        </View>
      )}
      {observation &&
        observation.snapshot.status === "scheduled" &&
        observation.snapshot.participantUserIds.includes(actor.id) && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TogglePillButton
              disabled={busy || !!attempt}
              onPress={() => void respond("accepted")}
              color="green"
            >
              {c.accept}
            </TogglePillButton>
            <TogglePillButton
              disabled={busy || !!attempt}
              onPress={() => void respond("declined")}
              color="red"
            >
              {c.decline}
            </TogglePillButton>
          </View>
        )}
      {attempt ? (
        <TogglePillButton
          disabled={busy}
          onPress={() => void respond(attempt.input.response, true)}
        >
          {c.retry}
        </TogglePillButton>
      ) : (
        <TogglePillButton disabled={busy} onPress={() => void refresh()}>
          {c.refresh}
        </TogglePillButton>
      )}
    </View>
  );
}
