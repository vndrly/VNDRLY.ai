import { createContext, memo, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useMeetingAudio } from "@/hooks/use-meeting-audio";
import type { CallTranscriptionPolicy } from "@/hooks/use-call-transcription";
import { workHubRequest } from "@/lib/work-hub-client";
import type { MeetingSnapshot } from "@/lib/meeting-types";
import { useAuth } from "@/hooks/use-auth";
import { WorkHubMiniCardButton } from "@/components/work-hub/chrome";

type MeetingAudio = ReturnType<typeof useMeetingAudio>;
type SessionTarget = { occurrenceId: string; callId: string | null };
type AudioConnectionRequest = { occurrenceId: string; sourceDeviceId?: string; unmuteOnJoin?: boolean };
type SessionRuntime = SessionTarget & {
  audio: MeetingAudio;
  snapshot?: MeetingSnapshot;
  captionStatus: "loading" | "enabled" | "disabled" | "unavailable";
};
type MeetingSession = {
  available: true;
  floatingCalls: boolean;
  occurrenceId: string | null;
  callId: string | null;
  audio?: MeetingAudio;
  snapshot?: MeetingSnapshot;
  captionStatus?: SessionRuntime["captionStatus"];
  activate: (occurrenceId: string) => void;
  connect: (occurrenceId: string, sourceDeviceId?: string, callId?: string | null, unmuteOnJoin?: boolean) => void;
  clear: () => void;
};

const MeetingSessionContext = createContext<MeetingSession | null>(null);

function storedMeeting(key: string): SessionTarget | null {
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    const target = JSON.parse(stored) as SessionTarget;
    return typeof target.occurrenceId === "string" ? target : null;
  } catch {
    return null;
  }
}

// The keyed audio controller is a sibling of the page. Switching calls or
// starting audio never replaces the page subtree or its unsaved state.
const ActiveMeetingSession = memo(function ActiveMeetingSession({
  occurrenceId, callId, clear, pending, consume, publish,
}: SessionTarget & {
  clear: () => void;
  pending: AudioConnectionRequest | null;
  consume: (request: AudioConnectionRequest) => void;
  publish: (runtime: SessionRuntime) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const meeting = useQuery<MeetingSnapshot>({
    queryKey: ["work-hub", "persistent-meeting", occurrenceId],
    queryFn: ({ signal }) => workHubRequest(`/meetings/${occurrenceId}/catch-up`, { signal }),
    refetchInterval: 2_000,
    retry: false,
  });
  const ended = meeting.data?.occurrence.status === "ended" || meeting.data?.occurrence.status === "cancelled";
  const captions = useQuery<CallTranscriptionPolicy>({
    queryKey: ["work-hub", "call-transcription-state", callId],
    queryFn: ({ signal }) => workHubRequest(`/calls/${callId}/transcription-state`, { signal }),
    enabled: Boolean(callId && !ended),
    refetchInterval: 5_000,
    retry: false,
  });
  const audio = useMeetingAudio(occurrenceId, meeting.data, user?.userId, callId ? {
    id: callId,
    transcriptionPolicy: ended || captions.isError ? undefined : captions.data,
  } : undefined);
  useEffect(() => {
    if (!pending || pending.occurrenceId !== occurrenceId || audio.connecting || audio.handoffBusy || ended) return;
    if (callId && (!meeting.data || meeting.data.participationMode === "view_only")) return;
    consume(pending);
    const connection = audio.joined && pending.sourceDeviceId
      ? audio.moveAudioHere(pending.sourceDeviceId)
      : audio.join(pending.sourceDeviceId, pending.unmuteOnJoin);
    void connection.finally(() => queryClient.invalidateQueries({ queryKey: ["work-hub", "active-audio"] }));
  }, [audio, callId, consume, ended, meeting.data, occurrenceId, pending, queryClient]);
  const meetingErrorStatus = (meeting.error as { status?: number } | null)?.status;
  useEffect(() => {
    if (ended || meetingErrorStatus === 403 || meetingErrorStatus === 404) clear();
  }, [clear, ended, meetingErrorStatus]);
  useEffect(() => {
    const captionStatus = captions.isError ? "unavailable"
      : captions.data?.enabled ? "enabled"
        : captions.data ? "disabled" : "loading";
    publish({ occurrenceId, callId, audio, snapshot: meeting.data, captionStatus });
  }, [audio, callId, captions.data, captions.isError, meeting.data, occurrenceId, publish]);
  if (callId) return null;
  return (
    <aside className="fixed bottom-3 left-1/2 z-[70] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-2 shadow-lg" style={{ borderColor: "var(--brand-primary)" }} aria-label="Active meeting companion">
      <span className="min-w-0 truncate text-sm"><strong>{meeting.data?.meeting.title ?? "Work Hub audio"}</strong>{audio.joined ? ` · ${audio.muted ? "Mic muted" : "Mic live"}` : " · Companion mode"}</span>
      {audio.joined ? <button type="button" className="text-sm underline" onClick={() => void audio.toggleMute()}>{audio.muted ? "Unmute" : "Mute"}</button> : <WorkHubMiniCardButton disabled={audio.connecting} onClick={() => void audio.join()}>Join audio</WorkHubMiniCardButton>}
      {audio.needsPlayback && <WorkHubMiniCardButton onClick={() => void audio.enablePlayback()}>Resume audio</WorkHubMiniCardButton>}
      {audio.error && <span role="alert" className="text-sm text-destructive">{audio.error}</span>}
      <Link className="text-sm font-semibold underline" href={`/work-hub/chat?view=meetings&meeting=${encodeURIComponent(occurrenceId)}`}>Return to meeting</Link>
    </aside>
  );
});

export function MeetingSessionProvider({ children, scope, floatingCalls = false }: {
  children: ReactNode;
  scope?: string;
  floatingCalls?: boolean;
}) {
  const storageKey = scope ? `vndrly.activeMeeting:${scope}` : null;
  const [target, setTarget] = useState<SessionTarget | null>(() => storageKey ? storedMeeting(storageKey) : null);
  const [runtime, setRuntime] = useState<SessionRuntime | null>(null);
  const [pending, setPending] = useState<AudioConnectionRequest | null>(null);
  const save = useCallback((next: SessionTarget | null) => {
    setTarget(next);
    if (!storageKey) return;
    try {
      if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Session still persists across routes in this tab. */ }
  }, [storageKey]);
  const activate = useCallback((occurrenceId: string) => {
    setPending(null);
    save({ occurrenceId, callId: null });
  }, [save]);
  const connect = useCallback((occurrenceId: string, sourceDeviceId?: string, callId: string | null = null, unmuteOnJoin?: boolean) => {
    save({ occurrenceId, callId });
    setPending({ occurrenceId, sourceDeviceId, unmuteOnJoin });
  }, [save]);
  const consume = useCallback((request: AudioConnectionRequest) => setPending(current => current === request ? null : current), []);
  const clear = useCallback(() => { setPending(null); setRuntime(null); save(null); }, [save]);
  const active = runtime?.occurrenceId === target?.occurrenceId && runtime?.callId === target?.callId ? runtime : null;
  const value: MeetingSession = {
    available: true, floatingCalls, occurrenceId: target?.occurrenceId ?? null, callId: target?.callId ?? null,
    audio: active?.audio, snapshot: active?.snapshot, captionStatus: active?.captionStatus,
    activate, connect, clear,
  };
  return (
    <MeetingSessionContext.Provider value={value}>
      {children}
      {target && <ActiveMeetingSession key={target.occurrenceId} {...target} clear={clear} pending={pending} consume={consume} publish={setRuntime} />}
    </MeetingSessionContext.Provider>
  );
}

export function useMeetingSession() { return useContext(MeetingSessionContext); }
