import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBrand } from "@/hooks/use-brand";
import { useMeetingAudio } from "@/hooks/use-meeting-audio";
import { workHubRequest, createWorkHubOperationId } from "@/lib/work-hub-client";
import { meetingClock, meetingTimer, type MeetingSnapshot } from "@/lib/meeting-types";
import { PillColorLayer } from "@/components/png-pill-chrome";
import { brandImagePillSrc } from "@/components/png-pill-rollover";
import { PILL_IDLE, pillGreen } from "@/lib/pill-palette-assets";
import { PILL_LABEL_CLASS, pillLabelToneClass } from "@/lib/pill-doctrine";
import "./meeting-workspace.css";
import AskVListeningPill from "./askv-listening-pill";

function MeetingPill({ children, idle = false, tone = "brand", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { idle?: boolean; tone?: "brand" | "green" }) {
  const brand = useBrand();
  const src = idle ? PILL_IDLE : tone === "green" ? pillGreen : brandImagePillSrc(brand.primary, brand.name);
  return <button {...props} type="button" className="meeting-pill"><PillColorLayer src={src} className="absolute inset-0 h-full w-full" /><span className={`${PILL_LABEL_CLASS} ${pillLabelToneClass(idle)}`}>{children}</span></button>;
}
export function SpeakingBars({ active }: { active: boolean }) {
  return <span className="meeting-speaking-bars" data-active={active} aria-hidden="true">{[7, 12, 9, 13, 6].map((height, index) => <i key={index} style={{ height, animationDelay: `${index * -.13}s` }} />)}</span>;
}
type TimelineEntry = { id: string; userId: number | null; name: string; text: string; time: number; type: string; recipient: number | null; extra?: ReactNode };

export default function MeetingWorkspace({ occurrenceId }: { occurrenceId: string }) {
  const brand = useBrand();
  const qc = useQueryClient();
  const queryKey = ["work-hub", "meeting-workspace", occurrenceId];
  const meeting = useQuery<MeetingSnapshot>({ queryKey, queryFn: () => workHubRequest(`/meetings/${occurrenceId}/catch-up`), refetchInterval: 2000, retry: false });
  const data = meeting.data;
  const audio = useMeetingAudio(occurrenceId, data);
  const [draft, setDraft] = useState("");
  const [recipient, setRecipient] = useState<number | null>(null);
  const [roster, setRoster] = useState(false);
  const [tool, setTool] = useState("Summary");
  const [search, setSearch] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [following, setFollowing] = useState(true);
  const timeline = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const pendingMessage = useRef<{ id: string; body: string; recipientUserId: number | null } | null>(null);
  const activitySentAt = useRef(0);
  function reportActivity(kind: "typing" | "file" | null) {
    if (kind === "typing" && Date.now() - activitySentAt.current < 1800) return;
    activitySentAt.current = Date.now();
    void workHubRequest(`/meetings/${occurrenceId}/activity`, { method: "POST", body: JSON.stringify({ kind, recipientUserId: recipient }) }).catch(() => undefined);
  }
  const draftKey = data ? `vndrly:meeting-draft:${data.userId}:${occurrenceId}:${recipient ?? "shared"}` : null;

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!draftKey) return;
    try { setDraft(sessionStorage.getItem(draftKey) ?? ""); } catch { setDraft(""); }
  }, [draftKey]);
  useEffect(() => {
    if (textarea.current) { textarea.current.style.height = "auto"; textarea.current.style.height = `${Math.min(170, Math.max(70, textarea.current.scrollHeight))}px`; }
  }, [draft]);
  const updateDraft = (value: string) => {
    setDraft(value);
    reportActivity(value ? "typing" : null);
    if (draftKey) try { sessionStorage.setItem(draftKey, value); } catch { /* Draft still stays in this open editor. */ }
  };
  const refresh = () => qc.invalidateQueries({ queryKey });
  async function action(path: string, body: unknown) {
    setError(null); setBusy(true);
    try { await workHubRequest(`/meetings/${occurrenceId}/${path}`, { method: "POST", body: JSON.stringify(body) }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again."); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!draft.trim() || busy) return;
    const body = draft.trim();
    const operation = pendingMessage.current?.body === body && pendingMessage.current.recipientUserId === recipient ? pendingMessage.current : { id: createWorkHubOperationId(), body, recipientUserId: recipient };
    pendingMessage.current = operation;
    setBusy(true); setError(null);
    try {
      await workHubRequest(`/meetings/${occurrenceId}/chat`, { method: "POST", body: JSON.stringify(operation) });
      updateDraft(""); pendingMessage.current = null; setFollowing(true); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Message was not sent. Your draft is still here."); }
    finally { setBusy(false); }
  }
  async function upload(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true); setError(null);
    reportActivity("file");
    const heartbeat = setInterval(() => reportActivity("file"), 3000);
    try {
      const url = `/api/work-hub/meetings/${occurrenceId}/files/${createWorkHubOperationId()}${recipient ? `?recipient=${recipient}` : ""}`;
      const response = await fetch(url, { method: "PUT", credentials: "include", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) }, body: file });
      if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error?.message ?? "File could not be added. Please try again."); }
      setFollowing(true); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to add file."); }
    finally { clearInterval(heartbeat); reportActivity(null); setBusy(false); if (fileInput.current) fileInput.current.value = ""; if (cameraInput.current) cameraInput.current.value = ""; }
  }
  const started = Date.parse(data?.occurrence.startedAt ?? data?.occurrence.startsAt ?? new Date().toISOString());
  const entries: TimelineEntry[] = data ? [
    ...data.transcript.map((line) => ({ id: line.id, userId: line.speakerUserId, name: line.displayName, text: line.text, time: started + line.startsAtMs, type: "Spoken", recipient: null })),
    ...data.chat.map((line) => {
      const url = `/api/work-hub/meetings/${occurrenceId}/files/${line.id}`;
      const extra = !line.attachment ? undefined : line.attachment.removedAt ? <small>File removed by host</small> : <div className="meeting-attachment">{["image/jpeg", "image/png", "image/webp"].includes(line.attachment.contentType) && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={line.attachment.fileName} loading="lazy" /></a>}<a href={url} target="_blank" rel="noreferrer">{line.attachment.fileName} · {Math.ceil(line.attachment.byteSize / 1024)} KB</a></div>;
      return { id: line.id, userId: line.userId, name: line.displayName, text: line.body, time: Date.parse(line.createdAt), type: line.messageType === "typed" ? "Typed" : line.messageType, recipient: line.recipientUserId, extra };
    }),
  ].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)) : [];
  const visible = entries.filter((item) => {
    if (recipient !== null && !(item.recipient !== null && (item.userId === recipient || item.recipient === recipient))) return false;
    return (!search || `${item.name} ${item.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (!speaker || item.userId === Number(speaker));
  });
  useEffect(() => { if (following && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; }, [entries.length, following, recipient]);
  if (!data) return <section className="meeting-workspace" aria-label="Meeting workspace"><p role={meeting.error ? "alert" : "status"}>{meeting.error ? meeting.error.message : "Opening meeting…"}</p></section>;
  const host = data.participants.find((p) => p.role === "host");
  const currentSpeaker = data.participants.find((p) => p.speaking);
  const present = data.participants.filter((p) => p.present);
  const ended = ["ended", "cancelled"].includes(data.occurrence.status);
  const timing = meetingTimer(data.occurrence.startedAt, data.occurrence.startsAt, data.occurrence.endsAt, data.occurrence.endedAt ? Date.parse(data.occurrence.endedAt) : now);
  const invited = Boolean(data.occurrence.askvInvitedAt);
  const person = data.participants.find((p) => p.userId === recipient);
  const tools = ["Summary", "Action Items", "Decisions", "Search", ...(data.canViewAttendance ? ["Attendance"] : []), "Agenda", ...(data.canManage ? ["Manage Attendees"] : [])];
  const recentActivity = ended ? [] : (data.activity ?? []).filter((item) => item.expiresAt > Date.now());
  const scopedActivity = recentActivity.filter((item) => recipient === null || (item.userId === recipient && item.recipientUserId === data.userId));
  // Activity belongs to an author AND an audience, never to all of their history.
  const scope = (userId: number | null, recipientId: number | null) => `${userId}:${recipientId ?? "shared"}`;
  const activeScopes = new Set(recentActivity.map((item) => scope(item.userId, item.recipientUserId)));
  if (!ended) for (const participant of data.participants) {
    if (participant.present && participant.speaking && !participant.muted && !participant.removedAt) activeScopes.add(scope(participant.userId, null));
  }
  const newestActive = new Map<string, string>();
  for (const entry of entries) {
    const key = scope(entry.userId, entry.recipient);
    if (activeScopes.has(key) && entry.type !== "askv" && entry.type !== "system") newestActive.set(key, entry.id);
  }
  const activeEntryIds = new Set(newestActive.values());

  return <section className="meeting-workspace" style={{ "--meeting-brand": brand.primary } as React.CSSProperties} aria-label="Meeting workspace">
    <header className="meeting-header">
      <div className="meeting-heading">
        <h2>{data.meeting.title}</h2>
        <p>{present.length} present · {ended ? "Meeting ended" : audio.joined ? "Live" : "Meeting workspace"} · {data.transcription ? "Transcript saving" : invited ? "Waiting for consent" : "Transcription paused"}</p>
        <div className="meeting-actions">
          <AskVListeningPill active={data.transcription} waiting={invited} disabled={!data.canManage || busy || ended} title={data.canManage ? "Pause or restart V" : "The host controls V"} onClick={() => void action("askv", { invited: !invited })} />
          {!audio.joined && !ended && <button onClick={() => void audio.join()}>Join audio</button>}
          {audio.joined && <><button onClick={() => void audio.toggleMute()} aria-pressed={!audio.muted}>{audio.muted ? "Unmute mic" : "Mute mic"}</button><button onClick={() => void audio.leave()}>Leave</button></>}
        </div>
      </div>
      <div className="meeting-people">
        <span className="meeting-person">{host?.displayName ?? "Host"} · Host</span>
        <button className="meeting-roster-trigger" onClick={() => setRoster(!roster)} aria-expanded={roster}>Private Message <span>+{Math.max(0, present.filter((p) => p.userId !== host?.userId).length)}</span></button>
        <span className="meeting-person"><SpeakingBars active={Boolean(currentSpeaker)} /><strong>{currentSpeaker ? `${currentSpeaker.displayName} speaking` : "No one speaking"}</strong></span>
      </div>
    </header>
    <div className="meeting-timer">
      <span>Elapsed <strong>{meetingClock(timing.elapsedMs)}</strong>{timing.targetMs > 0 && <> · Target <strong>{meetingClock(timing.targetMs)}</strong></>}{timing.overtimeMs > 0 && <strong className="meeting-overtime"> · Overtime +{meetingClock(timing.overtimeMs)}</strong>}</span>
      {timing.targetMs > 0 && <div role="progressbar" aria-label="Meeting duration" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(timing.progress)} aria-valuetext={timing.overtimeMs > 0 ? `Overtime ${meetingClock(timing.overtimeMs)}` : `${meetingClock(timing.elapsedMs)} elapsed`} className="meeting-progress"><span style={{ width: `${timing.progress}%`, background: timing.warning ? "#F59E0B" : brand.primary }} /></div>}
    </div>
    {roster && <section className="meeting-roster" aria-label="Attendees"><div><strong>Choose someone to message privately</strong><button onClick={() => setRoster(false)}>Close</button></div>{data.participants.filter((p) => !p.removedAt).map((p) => <button key={p.userId} disabled={p.userId === data.userId} onClick={() => { setRecipient(p.userId); setRoster(false); }}><span>{p.displayName}{p.role === "host" ? " · Host" : ""}</span>{" "}<small>{p.speaking ? "Speaking" : p.present ? "Present" : "Not connected"}</small></button>)}</section>}
    {invited && !ended && data.myConsent !== "accepted" && <div className="meeting-notice"><p>V will transcribe your meeting audio. The shared transcript and summary are saved for authorized attendees. Private messages stay between their two participants.</p><button disabled={busy} onClick={() => void action("consent", { policyVersion: data.meeting.policyVersion, response: "accepted" })}>Accept transcription</button><button disabled={busy} onClick={() => void action("consent", { policyVersion: data.meeting.policyVersion, response: "declined" })}>Decline</button></div>}
    {audio.needsPlayback && <button onClick={() => void audio.enablePlayback()}>Play meeting audio</button>}
    {(error || audio.error || meeting.error) && <p role="alert" className="meeting-error">{error ?? audio.error ?? meeting.error?.message}</p>}
    <div className="meeting-timeline-label"><span>{recipient ? `Private with ${person?.displayName ?? "attendee"}` : "Live transcript"}</span><span>{following ? "Scroll for full meeting" : <button onClick={() => setFollowing(true)}>Jump to latest</button>}</span></div>
    <div ref={timeline} className="meeting-timeline" aria-label={recipient ? "Private meeting messages" : "Meeting transcript"} onScroll={() => { const node = timeline.current; if (node) setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 45); }}>
      {visible.length === 0 && <p className="meeting-empty">{search ? "No matching entries." : recipient ? "Your private conversation starts here." : "Spoken words, typed messages, and shared files appear here."}</p>}
      {visible.map((entry) => {
        const isV = entry.type === "askv";
        const own = entry.userId === data.userId && !isV && entry.type !== "system";
        const photo = data.participants.find((p) => p.userId === entry.userId)?.photoUrl;
        return <article key={entry.id} className={`meeting-message ${own ? "meeting-message-own" : ""} ${activeEntryIds.has(entry.id) ? "meeting-message-active" : ""}`}><div className="meeting-message-heading">{photo && <img src={photo} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}<strong style={{ color: own || isV ? "white" : brand.primary }}>{isV ? "V" : entry.name}</strong><time dateTime={new Date(entry.time).toISOString()}>{new Date(entry.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><small>{entry.recipient !== null ? `Private · ${data.participants.find((p) => p.userId === (own ? entry.recipient : entry.userId))?.displayName ?? "attendee"}` : entry.type === "Typed" ? "Typed" : ""}</small></div><p>{entry.text}</p>{entry.extra}</article>;
      })}
    </div>
    <div role="status" aria-live="polite" className="meeting-activity">{scopedActivity.map((item) => <span key={item.userId}>{item.recipientUserId !== null && "Private · "}<strong style={{ color: brand.primary }}>{data.participants.find((p) => p.userId === item.userId)?.displayName ?? "An attendee"}</strong> {item.kind === "typing" ? "is typing a message…" : "is adding a file…"}</span>)}</div>
    {!ended && <div className="meeting-composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}>
      <div className="meeting-composer-heading"><span>{recipient ? `Private message to ${person?.displayName ?? "attendee"}` : "Message the meeting"}</span><div>{recipient && <button onClick={() => setRecipient(null)}>Back to meeting</button>}<button disabled={busy} onClick={() => fileInput.current?.click()}>+ Add File</button><button className="meeting-camera" disabled={busy} onClick={() => cameraInput.current?.click()}>Take photo</button></div></div>
      <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain" onChange={(event) => void upload(event.target.files?.[0])} />
      <input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={(event) => void upload(event.target.files?.[0])} />
      <textarea ref={textarea} aria-label={recipient ? `Private message to ${person?.displayName}` : "Message the meeting"} placeholder={recipient ? `Private message to ${person?.displayName}…` : "Message the meeting…"} value={draft} onChange={(event) => updateDraft(event.target.value)} onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); void upload(event.clipboardData.files[0]); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <div className="meeting-composer-footer"><small>Enter to send · Shift+Enter for a new line</small><MeetingPill disabled={busy || !draft.trim()} onClick={() => void send()}>Send</MeetingPill></div>
    </div>}
    <details className="meeting-tools"><summary>Meeting Tools</summary><div className="meeting-tool-actions">{tools.map((name) => <MeetingPill key={name} onClick={() => setTool(name)} aria-pressed={name === tool}>{name}</MeetingPill>)}</div>
      <div className="meeting-tool-body" aria-label={tool}>
        {tool === "Summary" && <p>{typeof data.recap?.summary === "string" ? data.recap.summary : "The saved meeting summary will appear here when available."}</p>}
        {tool === "Agenda" && <p>{data.meeting.agenda || "No agenda was added."}</p>}
        {["Action Items", "Decisions"].includes(tool) && <p>{JSON.stringify(data.recap?.[tool === "Decisions" ? "decisions" : "actionItems"] ?? []) === "[]" ? "No items have been published yet." : JSON.stringify(data.recap?.[tool === "Decisions" ? "decisions" : "actionItems"])}</p>}
        {tool === "Search" && <div className="meeting-search"><input aria-label="Search meeting" placeholder="Search text, names, or filenames" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Filter by speaker" value={speaker} onChange={(event) => setSpeaker(event.target.value)}><option value="">Everyone</option>{data.participants.map((p) => <option key={p.userId} value={p.userId}>{p.displayName}</option>)}</select><button onClick={() => { setSearch(""); setSpeaker(""); }}>Clear search</button><small>Results appear in the timeline. Private results are visible only to their two participants.</small></div>}
        {tool === "Attendance" && <ul>{data.participants.map((p) => { const visits = data.attendance.filter((a) => a.userId === p.userId); return <li key={p.userId}>{p.displayName} · {p.removedAt ? "Removed by host" : p.present ? "Present" : visits.length ? "Left" : "Never joined"}{visits.map((a) => <small key={a.id}> · {new Date(a.joinedAt).toLocaleTimeString()} – {a.leftAt ? new Date(a.leftAt).toLocaleTimeString() : "Connected"}</small>)}</li>; })}</ul>}
        {tool === "Manage Attendees" && data.canManage && <div>{data.participants.filter((p) => p.role !== "host" && !p.removedAt).map((p) => <div className="meeting-manage-person" key={p.userId}><span>{p.displayName}</span><button disabled={busy} onClick={() => { if (window.confirm(`Remove ${p.displayName} from this meeting? Their contributions remain in the record.`)) void action(`participants/${p.userId}/remove`, {}); }}>Remove from meeting</button></div>)}{!ended && <button disabled={busy} onClick={() => { if (window.confirm("End this meeting for everyone and save its transcript?")) void action("end", {}); }}>End meeting for everyone</button>}</div>}
      </div>
    </details>
  </section>;
}
