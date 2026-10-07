import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/hooks/use-auth";
import { captureAuthScope, isAuthScopeCurrent } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import TogglePillButton from "@/components/TogglePillButton";
import {
  MeetingAssistantInvitationInputSchema,
  saveMeetingAssistantInvitation,
  type MeetingAssistantInvitationInput,
} from "@workspace/api-zod";
type Props = {
  occurrenceId: string;
  version: number | undefined;
  canManage: boolean;
  invited: boolean;
  onSaved: () => unknown;
};
export default function MeetingAssistantInvitation(props: Props) {
  return props.canManage && Number.isSafeInteger(props.version) ? (
    <Bound {...props} />
  ) : null;
}
function Bound(props: Props) {
  const { user } = useAuth();
  const identity = [
    user?.id,
    user?.role,
    user?.activeMembershipId,
    user?.vendorId,
    user?.partnerId,
    props.occurrenceId,
  ].join(".");
  return user ? (
    <Panel key={identity} {...props} identity={identity} actorId={user.id} />
  ) : null;
}
function Panel({
  occurrenceId,
  version,
  invited,
  onSaved,
  identity,
  actorId,
}: Props & { identity: string; actorId: number }) {
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es"),
    key = "vndrly.meeting-assistant." + identity;
  const [attempt, setAttempt] =
      useState<MeetingAssistantInvitationInput | null>(null),
    [ready, setReady] = useState(false),
    [review, setReview] = useState<MeetingAssistantInvitationInput | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [savedVersion, setSavedVersion] = useState<number | null>(null),
    [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const alive = useRef(true),
    locked = useRef(false),
    scope = useRef(captureAuthScope());
  const current = () => alive.current && isAuthScopeCurrent(scope.current);
  useEffect(() => {
    alive.current = true;
    void SecureStore.getItemAsync(key)
      .then((raw) => {
        if (!current()) return;
        if (raw)
          setAttempt(
            MeetingAssistantInvitationInputSchema.parse(JSON.parse(raw)),
          );
        setReady(true);
      })
      .catch(() => {
        if (current())
          setMessage(
            es
              ? "No se pudo leer la solicitud guardada."
              : "Could not read saved request.",
          );
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const stale =
    (savedVersion !== null && Number(version) < savedVersion) ||
    (conflictVersion !== null && version === conflictVersion);
  async function save() {
    if (locked.current || !current()) return;
    locked.current = true;
    setBusy(true);
    let posted = false;
    try {
      const body = MeetingAssistantInvitationInputSchema.parse(
        attempt ?? review,
      );
      await SecureStore.setItemAsync(key, JSON.stringify(body));
      if (!current()) return;
      setAttempt(body);
      setReview(null);
      const receipt = await saveMeetingAssistantInvitation(
        occurrenceId,
        body,
        async (path, init) => {
          if (!current()) throw Error("Account changed");
          if (init.method === "POST") posted = true;
          return apiFetch("/api/work-hub" + path, init, scope.current);
        },
      );
      if (!current()) return;
      if (receipt.actorUserId !== actorId) throw Error("Saved actor differs");
      setSavedVersion(receipt.version);
      setAttempt(null);
      await SecureStore.deleteItemAsync(key).catch(() => {});
      if (!current()) return;
      setMessage(es ? "Invitación de V guardada." : "V invitation saved.");
      void Promise.resolve()
        .then(onSaved)
        .catch(() => {
          if (current())
            setMessage(
              es
                ? "Guardado. Actualiza la reunión para continuar."
                : "Saved. Refresh the meeting to continue.",
            );
        });
    } catch (error) {
      if (!current()) return;
      const status = (error as { status?: number }).status;
      if (posted && (status === 400 || status === 409)) {
        setAttempt(null);
        await SecureStore.deleteItemAsync(key);
        if (!current()) return;
        setConflictVersion(version!);
        setMessage(
          es
            ? "La reunión cambió. Actualiza y revisa una solicitud nueva."
            : "The meeting changed. Refresh and review a new request.",
        );
        void Promise.resolve()
          .then(onSaved)
          .catch(() => {});
      } else
        setMessage(
          es
            ? "Resultado sin resolver. Conserva y comprueba la solicitud original."
            : "Result unresolved. Check the original request.",
        );
    } finally {
      if (current()) setBusy(false);
      locked.current = false;
    }
  }
  return (
    <View>
      {Boolean(message) && (
        <Text accessibilityLiveRegion="polite">{message}</Text>
      )}
      {attempt ? (
        <TogglePillButton disabled={busy || !ready} onPress={() => void save()}>
          {es ? "Comprobar solicitud original" : "Check original invitation"}
        </TogglePillButton>
      ) : (
        !stale && (
          <>
            {review ? (
              <>
                <Text>
                  {review.invited
                    ? es
                      ? "Invitar V"
                      : "Invite V"
                    : es
                      ? "Quitar V"
                      : "Remove V"}{" "}
                  · {es ? "Revisión" : "Revision"} {review.expectedVersion}
                </Text>
                <Text>
                  {es
                    ? "Esto cambia la invitación de V. No acepta consentimiento ni inicia captura del dispositivo."
                    : "This changes V invitation. It does not accept consent or start device capture."}
                </Text>
                <TogglePillButton
                  disabled={busy || !ready}
                  onPress={() => void save()}
                >
                  {es
                    ? "Guardar invitación revisada"
                    : "Save reviewed invitation"}
                </TogglePillButton>
              </>
            ) : (
              <TogglePillButton
                disabled={busy || !ready}
                onPress={() =>
                  setReview(
                    MeetingAssistantInvitationInputSchema.parse({
                      operationId: Crypto.randomUUID(),
                      expectedVersion: version,
                      invited: !invited,
                    }),
                  )
                }
              >
                {invited
                  ? es
                    ? "Quitar V"
                    : "Remove V"
                  : es
                    ? "Invitar V"
                    : "Invite V"}
              </TogglePillButton>
            )}
          </>
        )
      )}
    </View>
  );
}
