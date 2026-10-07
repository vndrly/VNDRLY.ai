import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { saveMeetingSpeakRequest } from "@workspace/api-zod";
import {
  createWorkHubOperationId,
  workHubRequest,
} from "@/lib/work-hub-client";

export default function MeetingSpeakRequest(props: {
  occurrenceId: string;
  pending: boolean;
  canRequest: boolean;
  onSaved: () => unknown;
}) {
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
      actorUserId={user.userId}
    />
  ) : null;
}
function Panel({
  occurrenceId,
  pending,
  canRequest,
  onSaved,
  identity,
  actorUserId,
}: {
  occurrenceId: string;
  pending: boolean;
  canRequest: boolean;
  onSaved: () => unknown;
  identity: string;
  actorUserId: number;
}) {
  const { t } = useTranslation(),
    key = "vndrly:meeting-speak:" + identity;
  const [operationId, setOperationId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true);
  const canRequestRef = useRef(canRequest);
  canRequestRef.current = canRequest;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function send() {
    if (busy || saved || ((!canRequest || pending) && !operationId)) return;
    const id = operationId ?? createWorkHubOperationId();
    setBusy(true);
    setError("");
    try {
      // If local persistence fails, do not start an effect whose exact retry identity would be lost.
      sessionStorage.setItem(key, id);
      setOperationId(id);
      await saveMeetingSpeakRequest(
        occurrenceId,
        actorUserId,
        id,
        async (path, init) => {
          if (!alive.current) throw Error("Account changed");
          if (init.method === "POST" && !canRequestRef.current) throw Error("The original speak request result remains unresolved");
          const value = await workHubRequest(path, init);
          if (!alive.current) throw Error("Account changed");
          return value;
        },
        canRequest,
      );
      if (!alive.current) return;
      setSaved(true);
      setOperationId(null);
      sessionStorage.removeItem(key);
      void Promise.resolve()
        .then(onSaved)
        .catch(() => {
          if (alive.current) setError(t("meetingWorkspace.tryAgain"));
        });
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : t("meetingWorkspace.tryAgain"),
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (!canRequest && !operationId && !saved) return null;
  return (
    <>
      <button
        disabled={busy || saved || (pending && !operationId)}
        onClick={() => void send()}
      >
        {saved || (pending && !operationId)
          ? t("meetingWorkspace.speakRequested")
          : t("meetingWorkspace.requestToSpeak")}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
