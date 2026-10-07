import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { PngPillButton } from "@/components/png-pill-rollover";
import {
  workHubRequest,
  createWorkHubOperationId,
} from "@/lib/work-hub-client";
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
  onSaved: (invited: boolean) => unknown;
};
export default function MeetingAssistantInvitation(props: Props) {
  return props.canManage && Number.isSafeInteger(props.version) ? (
    <Bound {...props} />
  ) : null;
}
function Bound(props: Props) {
  const { user } = useAuth();
  const identity = [
    user?.userId,
    user?.role,
    user?.activeMembershipId,
    user?.vendorId,
    user?.partnerId,
    props.occurrenceId,
  ].join(":");
  return user ? (
    <Panel
      key={identity}
      {...props}
      identity={identity}
      actorId={user.userId}
    />
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
    key = "vndrly:meeting-assistant:" + identity;
  const [attempt, setAttempt] =
      useState<MeetingAssistantInvitationInput | null>(() => {
        try {
          const raw = sessionStorage.getItem(key);
          return raw
            ? MeetingAssistantInvitationInputSchema.parse(JSON.parse(raw))
            : null;
        } catch {
          return null;
        }
      }),
    [review, setReview] = useState<MeetingAssistantInvitationInput | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [savedVersion, setSavedVersion] = useState<number | null>(null),
    [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const alive = useRef(true),
    locked = useRef(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const stale =
    (savedVersion !== null && Number(version) < savedVersion) ||
    (conflictVersion !== null && version === conflictVersion);
  async function save() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    let posted = false;
    try {
      const body = MeetingAssistantInvitationInputSchema.parse(
        attempt ?? review,
      );
      sessionStorage.setItem(key, JSON.stringify(body));
      setAttempt(body);
      setReview(null);
      const abort = new AbortController();
      controller.current = abort;
      const receipt = await saveMeetingAssistantInvitation(
        occurrenceId,
        body,
        async (path, init) => {
          if (!alive.current) throw Error("Account changed");
          if (init.method === "POST") posted = true;
          return workHubRequest(path, { ...init, signal: abort.signal });
        },
      );
      if (!alive.current) return;
      if (receipt.actorUserId !== actorId) throw Error("Saved actor differs");
      setSavedVersion(receipt.version);
      setAttempt(null);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Saved receipt remains authoritative. */
      }
      setMessage(es ? "Invitación de V guardada." : "V invitation saved.");
      void Promise.resolve()
        .then(() => onSaved(receipt.invited))
        .catch(() => {
          if (alive.current)
            setMessage(
              es
                ? "Guardado. Actualiza la reunión para continuar."
                : "Saved. Refresh the meeting to continue.",
            );
        });
    } catch (error) {
      if (!alive.current) return;
      const status = (error as { status?: number }).status;
      if (posted && (status === 400 || status === 409)) {
        setAttempt(null);
        sessionStorage.removeItem(key);
        setConflictVersion(version!);
        setMessage(
          es
            ? "La reunión cambió. Actualiza y revisa una solicitud nueva."
            : "The meeting changed. Refresh and review a new request.",
        );
        void Promise.resolve()
          .then(() => onSaved(invited))
          .catch(() => {});
      } else
        setMessage(
          es
            ? "Resultado sin resolver. Conserva y comprueba la solicitud original."
            : "Result unresolved. Check the original request.",
        );
    } finally {
      if (alive.current) setBusy(false);
      locked.current = false;
    }
  }
  return (
    <div>
      {message && <p role="status">{message}</p>}
      {attempt ? (
        <PngPillButton disabled={busy} onClick={() => void save()}>
          {es ? "Comprobar solicitud original" : "Check original invitation"}
        </PngPillButton>
      ) : (
        !stale && (
          <>
            {review ? (
              <>
                <p>
                  {review.invited
                    ? es
                      ? "Invitar V"
                      : "Invite V"
                    : es
                      ? "Quitar V"
                      : "Remove V"}{" "}
                  · {es ? "Revisión" : "Revision"} {review.expectedVersion}
                </p>
                <p>
                  {es
                    ? "Esto cambia la invitación de V. No acepta consentimiento ni inicia captura del dispositivo."
                    : "This changes V invitation. It does not accept consent or start device capture."}
                </p>
                <PngPillButton disabled={busy} onClick={() => void save()}>
                  {es
                    ? "Guardar invitación revisada"
                    : "Save reviewed invitation"}
                </PngPillButton>
              </>
            ) : (
              <PngPillButton
                disabled={busy}
                onClick={() =>
                  setReview(
                    MeetingAssistantInvitationInputSchema.parse({
                      operationId: createWorkHubOperationId(),
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
              </PngPillButton>
            )}
          </>
        )
      )}
    </div>
  );
}
