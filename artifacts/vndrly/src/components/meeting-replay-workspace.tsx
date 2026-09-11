import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrand } from "@/hooks/use-brand";
import { workHubRequest } from "@/lib/work-hub-client";
import type { MeetingSnapshot } from "@/lib/meeting-types";
import BrandPillButton from "@/components/brand-pill-button";

type ReplayEvent = { key: string; type: "transcript" | "message" | "file" | "askv_answer" | "gap"; offsetMs: number; endOffsetMs: number | null; payload: Record<string, unknown> };
export type ReplayManifest = { schemaVersion: number; rendererVersion: number; status: "complete" | "incomplete"; complete: boolean; occurrence: { startedAt: string; durationMs: number }; audio: Array<{ sequence: number; startsAtMs: number; endsAtMs: number; downloadPath: string }>; gaps: Array<{ startsAtMs: number; endsAtMs: number; reason: string }>; events: ReplayEvent[] };
type ReplayAssignment = { id: string; assigneeUserId: number; requirement: "optional" | "required"; dueAt: string | null; status: "not_started" | "in_progress" | "completed"; watchedMs: number; lastPositionMs: number; completedAt: string | null };

export function replayEventsAt(events: ReplayEvent[], playheadMs: number) {
  return events.filter((event) => event.offsetMs <= playheadMs && !["speaker", "activity"].includes(event.type));
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function MeetingReplayWorkspace({ occurrenceId, meeting }: { occurrenceId: string; meeting: MeetingSnapshot }) {
  const { t } = useTranslation(); const brand = useBrand();
  const [manifest, setManifest] = useState<ReplayManifest | null>(null);
  const [assignments, setAssignments] = useState<ReplayAssignment[]>([]);
  const [viewerToken, setViewerToken] = useState<string | null>(null);
  const [myAssignment, setMyAssignment] = useState<ReplayAssignment | null>(null);
  const [playhead, setPlayhead] = useState(0); const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(false); const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(""); const [requirement, setRequirement] = useState<"optional" | "required">("required"); const [dueAt, setDueAt] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const playbackAttemptRef = useRef(0);

  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      workHubRequest<ReplayManifest>(`/meetings/${occurrenceId}/replay`, { headers: { "x-replay-schema-version": "2", "x-replay-renderer-version": "1" } }),
      workHubRequest<{ assignments: ReplayAssignment[] }>(`/meetings/${occurrenceId}/replay/assignments`),
      workHubRequest<{ assignment: ReplayAssignment | null; viewerSessionId: string | null }>(`/meetings/${occurrenceId}/replay/watch/session`, { method: "POST", body: "{}" }),
    ]).then(([nextManifest, listed, watch]) => {
      if (cancelled) return; setManifest(nextManifest); setAssignments(listed.assignments); setMyAssignment(watch.assignment); setViewerToken(watch.viewerSessionId); setPlayhead(watch.assignment?.lastPositionMs ?? 0);
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : t("meetingReplay.unavailable", { defaultValue: "Meeting replay is unavailable." })); });
    return () => { cancelled = true; };
  }, [occurrenceId, t]);

  const chunk = useMemo(() => manifest?.audio.find((item) => playhead >= item.startsAtMs && playhead < item.endsAtMs) ?? null, [manifest, playhead]);
  useEffect(() => {
    if (!playing || chunk) return;
    const timer = window.setInterval(() => setPlayhead((value) => Math.min(manifest?.occurrence.durationMs ?? value, value + 250)), 250);
    return () => window.clearInterval(timer);
  }, [playing, chunk, manifest?.occurrence.durationMs]);
  useEffect(() => { if (manifest && playhead >= manifest.occurrence.durationMs) setPlaying(false); }, [manifest, playhead]);
  useEffect(() => {
    if (!playing || !viewerToken) return;
    const send = () => workHubRequest<{ assignment: ReplayAssignment }>(`/meetings/${occurrenceId}/replay/watch/progress`, { method: "POST", headers: { "x-replay-view-session": viewerToken }, body: JSON.stringify({ playheadMs: Math.round(playheadRef.current) }) }).then((result) => { setMyAssignment(result.assignment); setAssignments((rows) => rows.map((row) => row.id === result.assignment.id ? result.assignment : row)); }).catch(() => undefined);
    const timer = window.setInterval(() => void send(), 5_000);
    return () => { window.clearInterval(timer); void send(); };
  }, [occurrenceId, playing, viewerToken]);

  async function assign() {
    if (!assignee) return;
    try {
      const result = await workHubRequest<{ assignment: ReplayAssignment }>(`/meetings/${occurrenceId}/replay/assignments`, { method: "POST", body: JSON.stringify({ assigneeUserId: Number(assignee), requirement, dueAt: dueAt ? new Date(dueAt).toISOString() : null }) });
      setAssignments((rows) => [...rows.filter((row) => row.id !== result.assignment.id), result.assignment]); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("meetingReplay.assignFailed", { defaultValue: "Catch-up could not be assigned." })); }
  }
  function playAudio(audio: HTMLAudioElement) {
    const attempt = ++playbackAttemptRef.current;
    void audio.play().catch(() => {
      if (playbackAttemptRef.current !== attempt) return;
      audio.pause();
      setPlaying(false);
    });
  }
  function togglePlayback() {
    const next = !playing;
    setPlaying(next);
    const audio = audioRef.current;
    if (!audio) return;
    if (!next) {
      playbackAttemptRef.current += 1;
      audio.pause();
      return;
    }
    playAudio(audio);
  }
  function seekReplay(next: number) {
    playheadRef.current = next;
    setPlaying(false);
    playbackAttemptRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (chunk && next >= chunk.startsAtMs && next < chunk.endsAtMs) {
        audio.currentTime = Math.max(0, (next - chunk.startsAtMs) / 1_000);
      }
    }
    setPlayhead(next);
  }
  if (error && !manifest) return <div className="meeting-replay-unavailable" role="status">{error}</div>;
  if (!manifest) return <div className="meeting-replay-unavailable" role="status">{t("meetingReplay.loading", { defaultValue: "Loading timed replay…" })}</div>;
  const visibleEvents = replayEventsAt(manifest.events, playhead);
  const progress = myAssignment ? Math.min(100, Math.round(myAssignment.watchedMs / manifest.occurrence.durationMs * 100)) : null;
  return <section className="meeting-replay" style={{ "--meeting-brand": brand.primary } as React.CSSProperties} aria-label={t("meetingReplay.label", { defaultValue: "Timed meeting replay" })}>
    <div className="meeting-replay-head"><div><strong>{t("meetingReplay.title", { defaultValue: "Watch meeting replay" })}</strong><small>{manifest.complete ? t("meetingReplay.completeRecording", { defaultValue: "Complete recording" }) : t("meetingReplay.hasGaps", { defaultValue: "Replay includes clearly marked gaps" })}</small></div>{myAssignment && <span>{myAssignment.requirement === "required" ? t("meetingReplay.required", { defaultValue: "Required" }) : t("meetingReplay.optional", { defaultValue: "Optional" })} · {myAssignment.status === "completed" ? t("meetingReplay.completed", { defaultValue: "Completed" }) : `${progress}%`}</span>}</div>
    <div className="meeting-replay-controls"><BrandPillButton tone="brand" onClick={togglePlayback}>{playing ? t("meetingReplay.pause", { defaultValue: "Pause" }) : t("meetingReplay.play", { defaultValue: "Play" })}</BrandPillButton><span>{clock(playhead)} / {clock(manifest.occurrence.durationMs)}</span><input aria-label={t("meetingReplay.timeline", { defaultValue: "Replay timeline" })} type="range" min={0} max={manifest.occurrence.durationMs} step={250} value={playhead} onChange={(event) => seekReplay(Number(event.target.value))} /></div>
    {chunk && <audio ref={audioRef} key={chunk.sequence} src={chunk.downloadPath} autoPlay={playing} onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.max(0, (playheadRef.current - chunk.startsAtMs) / 1_000); if (playing) playAudio(event.currentTarget); }} onTimeUpdate={(event) => setPlayhead(Math.min(chunk.endsAtMs, chunk.startsAtMs + event.currentTarget.currentTime * 1_000))} onEnded={() => setPlayhead(chunk.endsAtMs)} />}
    <div className="meeting-replay-timeline" role="log" aria-label={t("meetingReplay.events", { defaultValue: "Meeting replay events" })}>{visibleEvents.map((event) => { const name = String(event.payload.displayName ?? (event.type === "askv_answer" ? "V" : t("meetingReplay.attendee", { defaultValue: "Attendee" }))); const text = String(event.payload.text ?? event.payload.body ?? event.payload.fileName ?? event.payload.reason ?? ""); return <article key={event.key} className="meeting-message"><div className="meeting-message-heading"><strong style={{ color: name === "V" ? "white" : brand.primary }}>{name}</strong><time>{clock(event.offsetMs)}</time></div><p>{text}</p>{event.type === "file" && typeof event.payload.downloadPath === "string" && <a href={event.payload.downloadPath} target="_blank" rel="noreferrer">{t("meetingReplay.openFile", { defaultValue: "Open shared file" })}</a>}</article>; })}</div>
    {manifest.gaps.some((gap) => playhead >= gap.startsAtMs && playhead < gap.endsAtMs) && <p className="meeting-notice" role="status">{t("meetingReplay.gap", { defaultValue: "This portion of the meeting has no recorded audio." })}</p>}
    {meeting.canManage && <details className="meeting-tools"><summary>{t("meetingReplay.assignCatchUp", { defaultValue: "Assign catch-up" })}</summary><div className="meeting-replay-assign"><select aria-label={t("meetingReplay.assignee", { defaultValue: "Attendee" })} value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">{t("meetingReplay.chooseAttendee", { defaultValue: "Choose attendee" })}</option>{meeting.participants.filter((person) => person.role !== "host" && !person.removedAt).map((person) => <option key={person.userId} value={person.userId}>{person.displayName}</option>)}</select><select aria-label={t("meetingReplay.requirement", { defaultValue: "Requirement" })} value={requirement} onChange={(event) => setRequirement(event.target.value as "optional" | "required")}><option value="required">{t("meetingReplay.required", { defaultValue: "Required" })}</option><option value="optional">{t("meetingReplay.optional", { defaultValue: "Optional" })}</option></select><input aria-label={t("meetingReplay.dueDate", { defaultValue: "Due date" })} type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /><BrandPillButton tone="brand" onClick={() => void assign()} disabled={!assignee}>{t("meetingReplay.assign", { defaultValue: "Assign" })}</BrandPillButton></div><ul>{assignments.map((row) => <li key={row.id}>{meeting.participants.find((person) => person.userId === row.assigneeUserId)?.displayName ?? t("meetingReplay.attendee", { defaultValue: "Attendee" })} · {row.requirement} · {row.status}{row.dueAt ? ` · ${new Date(row.dueAt).toLocaleString()}` : ""}</li>)}</ul></details>}
  </section>;
}
