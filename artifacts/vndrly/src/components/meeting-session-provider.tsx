import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMeetingAudio } from "@/hooks/use-meeting-audio";
import { workHubRequest } from "@/lib/work-hub-client";
import type { MeetingSnapshot } from "@/lib/meeting-types";

type MeetingAudio = ReturnType<typeof useMeetingAudio>;
type MeetingSession = {
  available: true;
  occurrenceId: string | null;
  audio?: MeetingAudio;
  snapshot?: MeetingSnapshot;
  activate: (occurrenceId: string) => void;
  clear: () => void;
};

const MeetingSessionContext = createContext<MeetingSession | null>(null);
const STORAGE_KEY = "vndrly.activeMeetingOccurrence";

function storedMeeting() {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function ActiveMeetingSession({ occurrenceId, activate, clear, children }: { occurrenceId: string; activate: (id: string) => void; clear: () => void; children: ReactNode }) {
  const meeting = useQuery<MeetingSnapshot>({ queryKey: ["work-hub", "persistent-meeting", occurrenceId], queryFn: () => workHubRequest(`/meetings/${occurrenceId}/catch-up`), refetchInterval: 2_000, retry: false });
  const audio = useMeetingAudio(occurrenceId, meeting.data);
  useEffect(() => { if (meeting.data?.occurrence.status === "ended" || meeting.data?.occurrence.status === "cancelled") clear(); }, [clear, meeting.data?.occurrence.status]);
  const value = useMemo<MeetingSession>(() => ({ available: true, occurrenceId, audio, snapshot: meeting.data, activate, clear }), [activate, audio, clear, meeting.data, occurrenceId]);
  return <MeetingSessionContext.Provider value={value}>{children}<aside className="fixed bottom-3 left-1/2 z-[70] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-card px-4 py-2 shadow-lg" style={{ borderColor: "var(--brand-primary)" }} aria-label="Active meeting companion"><span className="min-w-0 truncate text-sm"><strong>{meeting.data?.meeting.title ?? "Active meeting"}</strong>{audio.joined ? ` · ${audio.muted ? "Mic muted" : "Mic live"}` : " · Companion mode"}</span>{audio.joined ? <button type="button" className="text-sm underline" onClick={() => void audio.toggleMute()}>{audio.muted ? "Unmute" : "Mute"}</button> : <button type="button" className="text-sm underline" onClick={() => void audio.join()}>Join audio</button>}<a className="text-sm font-semibold underline" href={`/work-hub/meetings?meeting=${encodeURIComponent(occurrenceId)}`}>Return to meeting</a></aside></MeetingSessionContext.Provider>;
}

export function MeetingSessionProvider({ children }: { children: ReactNode }) {
  const [occurrenceId, setOccurrenceId] = useState<string | null>(storedMeeting);
  const activate = useCallback((id: string) => { setOccurrenceId(current => current === id ? current : id); try { sessionStorage.setItem(STORAGE_KEY, id); } catch { /* The current tab still retains state. */ } }, []);
  const clear = useCallback(() => { setOccurrenceId(null); try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* State is already cleared in memory. */ } }, []);
  if (occurrenceId) return <ActiveMeetingSession occurrenceId={occurrenceId} activate={activate} clear={clear}>{children}</ActiveMeetingSession>;
  return <MeetingSessionContext.Provider value={{ available: true, occurrenceId: null, activate, clear }}>{children}</MeetingSessionContext.Provider>;
}

export function useMeetingSession() { return useContext(MeetingSessionContext); }
