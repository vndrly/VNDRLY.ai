import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, PhoneIncoming, PhoneOff } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { MeetingSessionProvider, useMeetingSession } from "@/components/meeting-session-provider";
import { useAuth } from "@/hooks/use-auth";
import { brandStyleVars, useBrand } from "@/hooks/use-brand";
import { registerWorkHubBrowserDevice, reportWorkHubBrowserPresence, useWorkHubDevicePresence, workHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { workHubRequest } from "@/lib/work-hub-client";

type LiveCall = {
  id: string;
  occurrenceId: string;
  status: "ringing" | "active";
  incoming: boolean;
  callerName?: string;
  recipientName?: string;
};
type Caption = { id: string; speakerUserId: number; speakerName: string | null; text: string };

const buttonClass = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-sm disabled:opacity-50";
const actionClass = `${buttonClass} border-white/20 hover:bg-white/10`;
const primaryActionClass = `${buttonClass} border-transparent bg-[var(--brand-primary)] font-medium text-[var(--brand-icon-color)] hover:brightness-110`;

function LiveCaptions({ callId, userId, enabled, status }: {
  callId: string;
  userId: number;
  enabled: boolean;
  status: string;
}) {
  const captions = useQuery({
    queryKey: ["work-hub", "call-transcript", callId, userId],
    queryFn: ({ signal }) => workHubRequest<{ segments: Caption[] }>(`/calls/${callId}/transcript`, { signal }),
    enabled,
    refetchInterval: 1_500,
    retry: false,
  });
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const segments = enabled ? captions.data?.segments : undefined;
  useEffect(() => {
    const log = scroll.current;
    if (log && follow.current) log.scrollTop = log.scrollHeight;
  }, [segments]);
  return (
    <div ref={scroll} role="log" aria-label="Live captions" aria-relevant="additions text"
      className="max-h-[min(45vh,22rem)] space-y-2 overflow-y-auto overscroll-contain"
      onScroll={event => {
        const log = event.currentTarget;
        follow.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
      }}>
      {segments?.map(segment => {
        const mine = segment.speakerUserId === userId;
        return (
          <div key={segment.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] break-words rounded-xl px-3 py-2 text-sm ${mine ? "bg-[var(--brand-primary)] text-[var(--brand-icon-color)]" : "bg-[#3a3d42] text-gray-100"}`}>
              <div className="text-xs font-semibold">{mine ? "You" : segment.speakerName ?? "Caller"}</div>
              <p className="whitespace-pre-wrap">{segment.text}</p>
            </div>
          </div>
        );
      })}
      {(!segments?.length || captions.isError) && (
        <p className="text-sm text-gray-300">{captions.isError && enabled ? "Live captions could not load." : status}</p>
      )}
    </div>
  );
}

function FloatingCall({ userId, scope }: { userId: number; scope: string }) {
  const session = useMeetingSession();
  const queryClient = useQueryClient();
  const brand = useBrand();
  const calls = useQuery({
    queryKey: ["work-hub", "calls", "live", scope],
    queryFn: ({ signal }) => workHubRequest<LiveCall[]>("/calls?filter=live", { signal }),
    refetchInterval: (query) => {
      const status = (query.state.error as { status?: number } | null)?.status;
      return status === 401 || status === 403 || status === 404 ? false : 2_500;
    },
    retry: false,
  });
  const ringing = calls.data?.find(call => call.incoming && call.status === "ringing");
  const active = calls.data?.find(call => call.id === session?.callId);
  const audio = session?.audio;
  const viewOnly = session?.snapshot?.participationMode === "view_only";
  const response = useMutation({
    mutationFn: async ({ callId, action }: { callId: string; action: "accept" | "decline" | "end" }) => {
      const identity = action === "accept" ? workHubDeviceIdentity(userId) : null;
      if (action === "accept" && !identity) throw new Error("This browser could not identify its audio device.");
      if (identity) {
        await registerWorkHubBrowserDevice(identity.deviceId);
        await reportWorkHubBrowserPresence(identity);
      }
      return workHubRequest<{ occurrenceId: string; selectedAudioOwner: boolean }>(`/calls/${callId}/respond`, {
        method: "POST", body: JSON.stringify({ action, ...identity }),
      });
    },
    onSuccess: (result, { callId, action }) => {
      queryClient.setQueryData<LiveCall[]>(["work-hub", "calls", "live", scope], rows => (
        action === "accept"
          ? rows?.map(call => call.id === callId ? { ...call, status: "active" } : call)
          : rows?.filter(call => call.id !== callId)
      ));
      if (action === "accept" && result.selectedAudioOwner) session?.connect(result.occurrenceId, undefined, callId, true);
      if (action === "end") session?.clear();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-hub", "calls"] });
      void queryClient.invalidateQueries({ queryKey: ["work-hub", "active-audio"] });
    },
  });
  const authorize = useMutation({
    mutationFn: ({ occurrenceId, policyVersion }: { occurrenceId: string; policyVersion: number }) => workHubRequest(
      `/meetings/${occurrenceId}/consent`, {
        method: "POST", body: JSON.stringify({ policyVersion, response: "accepted" }),
      },
    ),
    onSuccess: (_result, { occurrenceId }) => {
      void queryClient.invalidateQueries({ queryKey: ["work-hub", "persistent-meeting", occurrenceId] });
    },
  });
  const callId = session?.callId;
  if (!callId && !ringing) return null;
  const caller = active ? (active.incoming ? active.callerName : active.recipientName) : undefined;
  const otherName = caller ?? session?.snapshot?.participants.find(person => person.userId !== userId)?.displayName;
  const captionsEnabled = session?.captionStatus === "enabled";
  const captionStatus = session?.captionStatus === "disabled" ? "Live captions are unavailable for this call."
    : session?.captionStatus === "unavailable" ? "Caption status could not load."
      : audio?.callCaptionsError ?? (audio?.joined ? captionsEnabled ? "Waiting for speech…" : "Checking caption availability…" : "Waiting for call audio…");
  const error = response.error ?? authorize.error;
  return (
    <aside aria-label={callId ? "Active call" : "Incoming call"}
      className="fixed inset-x-3 top-14 z-[70] space-y-3 rounded-xl border border-[var(--brand-primary)] bg-[#242426] p-4 text-gray-100 shadow-xl sm:left-auto sm:w-[26rem]"
      style={brandStyleVars(brand)}>
      {!callId && ringing ? (
        <>
          <p role="status" className="flex items-center gap-2 font-semibold">
            <PhoneIncoming aria-hidden="true" className="size-5 shrink-0 text-[var(--brand-primary)]" />
            {ringing.callerName ?? "A VNDRLY contact"} is calling
          </p>
          <div className="flex gap-2">
            <button type="button" className={primaryActionClass} disabled={response.isPending}
              onClick={() => response.mutate({ callId: ringing.id, action: "accept" })}>Accept</button>
            <button type="button" className={actionClass} disabled={response.isPending}
              onClick={() => response.mutate({ callId: ringing.id, action: "decline" })}>Decline</button>
          </div>
        </>
      ) : callId && (
        <>
          <h2 className="font-semibold">{otherName ?? "Active call"}</h2>
          <div className="flex flex-wrap gap-2">
            {audio?.joined ? (
              <button type="button" className={actionClass} disabled={audio.connecting} onClick={() => void audio.toggleMute()}>
                {audio.muted ? <MicOff aria-hidden="true" className="size-4" /> : <Mic aria-hidden="true" className="size-4" />}
                {audio.muted ? "Unmute" : "Mute"}
              </button>
            ) : audio && !viewOnly && (
              <button type="button" className={actionClass} disabled={audio.connecting} onClick={() => void audio.join(undefined, true)}>
                {audio.connecting ? "Connecting…" : "Join audio"}
              </button>
            )}
            {audio?.needsPlayback && <button type="button" className={actionClass} onClick={() => void audio.enablePlayback()}>Resume audio</button>}
            <button type="button" className={actionClass} disabled={response.isPending} onClick={() => response.mutate({ callId, action: "end" })}>
              <PhoneOff aria-hidden="true" className="size-4" /> End call
            </button>
          </div>
          {viewOnly && session.snapshot && session.occurrenceId && (
            <div className="space-y-2 text-sm">
              <p>Accept the work participation authorization to join audio. Transcription follows your company policy.</p>
              <button type="button" className={primaryActionClass} disabled={authorize.isPending} onClick={() => authorize.mutate({
                occurrenceId: session.occurrenceId!,
                policyVersion: session.snapshot!.meeting.policyVersion,
              })}>Accept and participate</button>
            </div>
          )}
          {audio?.error && <p role="alert" className="text-sm text-red-300">{audio.error}</p>}
          <LiveCaptions key={callId} callId={callId} userId={userId} enabled={captionsEnabled} status={captionStatus} />
        </>
      )}
      {error && <p role="alert" className="text-sm text-red-300">{error.message}</p>}
    </aside>
  );
}

export function WorkHubCallSession({ children, showPopup = true }: { children: ReactNode; showPopup?: boolean }) {
  const { user } = useAuth();
  const [location] = useLocation();
  const scope = user?.userId ? `${user.userId}:${user.activeMembershipId ?? ""}:${user.vendorId ?? ""}:${user.partnerId ?? ""}` : undefined;
  const hasOrganization = Boolean(user?.vendorId || user?.partnerId);
  const popupUserId = showPopup && hasOrganization ? user?.userId : undefined;
  useWorkHubDevicePresence(location, hasOrganization, user?.userId, scope ?? "");
  return (
    <MeetingSessionProvider key={scope ?? "guest"} scope={scope} floatingCalls={Boolean(popupUserId)}>
      {children}
      {scope && popupUserId ? <FloatingCall userId={popupUserId} scope={scope} /> : null}
    </MeetingSessionProvider>
  );
}
