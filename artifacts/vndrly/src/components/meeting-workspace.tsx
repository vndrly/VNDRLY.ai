import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import MeetingReplayWorkspace from "./meeting-replay-workspace";

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
  const { t } = useTranslation();
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
  const rosterTrigger = useRef<HTMLButtonElement>(null);
  const firstRosterPerson = useRef<HTMLButtonElement>(null);
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
    catch (cause) { setError(cause instanceof Error ? cause.message : t("meetingWorkspace.tryAgain", { defaultValue: "Please try again." })); }
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("meetingWorkspace.sendFailed", { defaultValue: "Message was not sent. Your draft is still here." })); }
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
      if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error?.message ?? t("meetingWorkspace.fileAddFailed", { defaultValue: "File could not be added. Please try again." })); }
      setFollowing(true); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("meetingWorkspace.fileAddUnable", { defaultValue: "Unable to add file." })); }
    finally { clearInterval(heartbeat); reportActivity(null); setBusy(false); if (fileInput.current) fileInput.current.value = ""; if (cameraInput.current) cameraInput.current.value = ""; }
  }
  const started = Date.parse(data?.occurrence.startedAt ?? data?.occurrence.startsAt ?? new Date().toISOString());
  const entries: TimelineEntry[] = data ? [
    ...data.transcript.map((line) => ({ id: line.id, userId: line.speakerUserId, name: line.displayName, text: line.text, time: started + line.startsAtMs, type: "Spoken", recipient: null })),
    ...data.chat.map((line) => {
      const url = `/api/work-hub/meetings/${occurrenceId}/files/${line.id}`;
      const extra = line.messageType !== "attachment" || !line.attachment ? undefined : line.attachment.removedAt ? <small>{t("meetingWorkspace.fileRemoved", { defaultValue: "File removed by host" })}</small> : <div className="meeting-attachment">{["image/jpeg", "image/png", "image/webp"].includes(line.attachment.contentType) && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={line.attachment.fileName} loading="lazy" /></a>}<a href={url} target="_blank" rel="noreferrer">{line.attachment.fileName} · {Math.ceil(line.attachment.byteSize / 1024)} KB</a></div>;
      return { id: line.id, userId: line.userId, name: line.displayName, text: line.body, time: Date.parse(line.createdAt), type: line.messageType === "typed" ? "Typed" : line.messageType, recipient: line.recipientUserId, extra };
    }),
  ].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)) : [];
  const threadEntries = entries.filter((item) => {
    // Defense in depth; server catch-up and downloads independently enforce this audience.
    if (item.recipient !== null && item.userId !== data?.userId && item.recipient !== data?.userId) return false;
    return recipient === null || (item.recipient !== null && (item.userId === recipient || item.recipient === recipient));
  });
  const visible = threadEntries.filter((item) => (!search || `${item.name} ${item.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (!speaker || item.userId === Number(speaker)));
  useEffect(() => { if (following && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; }, [entries.length, following, recipient]);
  useEffect(() => { if (roster) firstRosterPerson.current?.focus(); }, [roster]);
  if (!data) return <section className="meeting-workspace" aria-label={t("meetingWorkspace.workspaceLabel", { defaultValue: "Meeting workspace" })}><p role={meeting.error ? "alert" : "status"}>{meeting.error ? meeting.error.message : t("meetingWorkspace.opening", { defaultValue: "Opening meeting…" })}</p></section>;
  const host = data.participants.find((p) => p.role === "host");
  const currentSpeaker = data.participants.find((p) => p.speaking);
  const present = data.participants.filter((p) => p.present);
  const firstMessageableUserId = data.participants.find((p) => !p.removedAt && p.userId !== data.userId)?.userId;
  const ended = ["ended", "cancelled"].includes(data.occurrence.status);
  const timing = meetingTimer(data.occurrence.startedAt, data.occurrence.startsAt, data.occurrence.endsAt, data.occurrence.endedAt ? Date.parse(data.occurrence.endedAt) : now);
  const invited = Boolean(data.occurrence.askvInvitedAt);
  const captureAvailable = data.streamingCaptureAvailable === true || data.nativeCaptureAvailable === true;
  // Spotlight authorized answers in this thread even while the saved timeline is filtered.
  const latestAnswer = !ended && invited ? threadEntries.filter((entry) => entry.type === "askv" && now >= entry.time && now - entry.time < 10_000).at(-1) : undefined;
  const privateCounterpart = (entry: TimelineEntry) => data.participants.find((p) => p.userId === (entry.userId === data.userId ? entry.recipient : entry.userId))?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "attendee" });
  const toolLabel = (name: string) => t(`meetingWorkspace.tools.${({ "Summary": "summary", "Action Items": "actionItems", "Decisions": "decisions", "Search": "search", "Attendance": "attendance", "Agenda": "agenda", "Manage Attendees": "manageAttendees" } as Record<string, string>)[name]}`, { defaultValue: name });
  const captureLabel = ended ? t("meetingWorkspace.meetingEnded", { defaultValue: "Meeting ended" }) : !invited ? t("meetingWorkspace.restartV", { defaultValue: "Click to restart V" })
    : !captureAvailable || audio.transcriptionError ? t("meetingWorkspace.transcriptionUnavailable", { defaultValue: "Transcription unavailable" })
      : !data.transcription || data.myConsent !== "accepted" ? t("meetingWorkspace.waitingConsent", { defaultValue: "Waiting for consent" })
        : !audio.joined ? t("meetingWorkspace.joinAudioTranscribe", { defaultValue: "Join audio to transcribe" }) : audio.muted ? t("meetingWorkspace.micMuted", { defaultValue: "Your mic is muted" })
          : audio.transcriptionActive ? t("meetingWorkspace.vListening", { defaultValue: "V is listening" }) : t("meetingWorkspace.transcriptionPausedHere", { defaultValue: "Transcription paused here" });
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

  return <section className="meeting-workspace" style={{ "--meeting-brand": brand.primary } as React.CSSProperties} aria-label={t("meetingWorkspace.workspaceLabel", { defaultValue: "Meeting workspace" })}>
    <header className="meeting-header">
      <div className="meeting-heading">
        <h2>{data.meeting.title}</h2>
        <p>{t("meetingWorkspace.presentCount", { defaultValue: "{{count}} present", count: present.length })} · {ended ? t("meetingWorkspace.meetingEnded", { defaultValue: "Meeting ended" }) : audio.joined ? t("meetingWorkspace.live", { defaultValue: "Live" }) : t("meetingWorkspace.workspaceLabel", { defaultValue: "Meeting workspace" })} · {audio.transcriptionActive ? t("meetingWorkspace.transcribingMic", { defaultValue: "Transcribing your microphone" }) : invited ? captureLabel : t("meetingWorkspace.transcriptionPaused", { defaultValue: "Transcription paused" })}</p>
        <div className="meeting-actions">
          <AskVListeningPill active={audio.transcriptionActive} statusLabel={captureLabel} disabled={!data.canManage || busy || ended} title={data.canManage ? t("meetingWorkspace.pauseRestartV", { defaultValue: "Pause or restart V" }) : t("meetingWorkspace.hostControlsV", { defaultValue: "The host controls V" })} onClick={() => { if (invited) audio.stopTranscription(); void action("askv", { invited: !invited }); }} />
          {!audio.joined && !ended && <button onClick={() => void audio.join()}>{t("meetingWorkspace.joinAudio", { defaultValue: "Join audio" })}</button>}
          {audio.joined && <><button onClick={() => void audio.toggleMute()} aria-pressed={!audio.muted}>{audio.muted ? t("meetingWorkspace.unmuteMic", { defaultValue: "Unmute mic" }) : t("meetingWorkspace.muteMic", { defaultValue: "Mute mic" })}</button><button onClick={() => void audio.leave()}>{t("meetingWorkspace.leave", { defaultValue: "Leave" })}</button></>}
        </div>
      </div>
      <div className="meeting-people">
        <span className="meeting-person">{host?.displayName ?? t("meetingWorkspace.host", { defaultValue: "Host" })} · {t("meetingWorkspace.host", { defaultValue: "Host" })}</span>
        <button ref={rosterTrigger} className="meeting-roster-trigger" onClick={() => setRoster(!roster)} aria-expanded={roster} aria-controls="meeting-attendee-roster" aria-label={t("meetingWorkspace.privateMessageCount", { defaultValue: "Private Message, {{count}} attendees", count: Math.max(0, present.filter((p) => p.userId !== host?.userId).length) })}>{t("meetingWorkspace.privateMessage", { defaultValue: "Private Message" })} <span>+{Math.max(0, present.filter((p) => p.userId !== host?.userId).length)}</span></button>
        <span className="meeting-person" role="status" aria-live="polite" aria-label={currentSpeaker ? t("meetingWorkspace.speaking", { defaultValue: "{{name}} speaking", name: currentSpeaker.displayName }) : t("meetingWorkspace.noOneSpeaking", { defaultValue: "No one speaking" })}><SpeakingBars active={Boolean(currentSpeaker)} /><strong>{currentSpeaker ? t("meetingWorkspace.speaking", { defaultValue: "{{name}} speaking", name: currentSpeaker.displayName }) : t("meetingWorkspace.noOneSpeaking", { defaultValue: "No one speaking" })}</strong></span>
      </div>
    </header>
    <div className="meeting-timer">
      <span>{t("meetingWorkspace.elapsed", { defaultValue: "Elapsed" })} <strong>{meetingClock(timing.elapsedMs)}</strong>{timing.targetMs > 0 && <> · {t("meetingWorkspace.target", { defaultValue: "Target" })} <strong>{meetingClock(timing.targetMs)}</strong></>}{timing.overtimeMs > 0 && <strong className="meeting-overtime"> · {t("meetingWorkspace.overtime", { defaultValue: "Overtime" })} +{meetingClock(timing.overtimeMs)}</strong>}</span>
      {timing.targetMs > 0 && <div role="progressbar" aria-label={t("meetingWorkspace.duration", { defaultValue: "Meeting duration" })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(timing.progress)} aria-valuetext={timing.overtimeMs > 0 ? `${t("meetingWorkspace.overtime", { defaultValue: "Overtime" })} ${meetingClock(timing.overtimeMs)}` : `${meetingClock(timing.elapsedMs)} ${t("meetingWorkspace.elapsed", { defaultValue: "elapsed" })}`} className="meeting-progress"><span style={{ width: `${timing.progress}%`, background: timing.warning ? "#F59E0B" : brand.primary }} /></div>}
    </div>
    {ended && <MeetingReplayWorkspace occurrenceId={occurrenceId} meeting={data} />}
    {roster && <section id="meeting-attendee-roster" className="meeting-roster" aria-label={t("meetingWorkspace.attendees", { defaultValue: "Attendees" })}><div><strong>{t("meetingWorkspace.choosePrivate", { defaultValue: "Choose someone to message privately" })}</strong><button aria-label={t("meetingWorkspace.closeAttendees", { defaultValue: "Close attendees" })} onClick={() => { setRoster(false); rosterTrigger.current?.focus(); }}>{t("meetingWorkspace.close", { defaultValue: "Close" })}</button></div>{data.participants.filter((p) => !p.removedAt).map((p) => { const status = p.speaking ? t("meetingWorkspace.speakingState", { defaultValue: "Speaking" }) : p.present ? t("meetingWorkspace.present", { defaultValue: "Present" }) : t("meetingWorkspace.notConnected", { defaultValue: "Not connected" }); return <button ref={p.userId === firstMessageableUserId ? firstRosterPerson : undefined} key={p.userId} disabled={p.userId === data.userId} aria-label={`${p.displayName} ${status}`} onClick={() => { setRecipient(p.userId); setRoster(false); setTimeout(() => textarea.current?.focus(), 0); }}><span>{p.displayName}{p.role === "host" ? ` · ${t("meetingWorkspace.host", { defaultValue: "Host" })}` : ""}</span>{" "}<small>{status}</small></button>; })}</section>}
    {invited && !ended && data.myConsent !== "accepted" && <div className="meeting-notice"><p>{t("meetingWorkspace.consentNotice", { defaultValue: "With everyone's consent, V can transcribe your unmuted microphone. The shared transcript is saved for authorized attendees. Private messages stay between their two participants." })}</p><button disabled={busy} onClick={() => void action("consent", { policyVersion: data.meeting.policyVersion, response: "accepted" })}>{t("meetingWorkspace.acceptTranscription", { defaultValue: "Accept transcription" })}</button><button disabled={busy} onClick={() => { audio.stopTranscription(); void action("consent", { policyVersion: data.meeting.policyVersion, response: "declined" }); }}>{t("meetingWorkspace.decline", { defaultValue: "Decline" })}</button></div>}
    {invited && !ended && data.myConsent === "accepted" && <div className="meeting-notice"><button disabled={busy} onClick={() => { audio.stopTranscription(); void action("consent", { policyVersion: data.meeting.policyVersion, response: "declined" }); }}>{t("meetingWorkspace.withdrawConsent", { defaultValue: "Withdraw transcription consent" })}</button></div>}
    {invited && !ended && !captureAvailable && <p className="meeting-notice">{t("meetingWorkspace.captureUnavailable", { defaultValue: "Transcription is unavailable. Your microphone is not being transcribed." })}</p>}
    {audio.transcriptionError && <div className="meeting-notice"><p role="alert" className="meeting-error">{audio.transcriptionError}</p>{audio.joined && !audio.muted && data.transcription && captureAvailable && <button onClick={audio.retryTranscription}>{t("meetingWorkspace.retryTranscription", { defaultValue: "Retry transcription" })}</button>}</div>}
    {audio.needsPlayback && <button onClick={() => void audio.enablePlayback()}>{t("meetingWorkspace.playAudio", { defaultValue: "Play meeting audio" })}</button>}
    {(error || audio.error || meeting.error) && <p role="alert" className="meeting-error">{error ?? audio.error ?? meeting.error?.message}</p>}
    {latestAnswer && <section className="meeting-answer-card" aria-label={t("meetingWorkspace.latestAnswer", { defaultValue: "V's latest answer" })} aria-live="polite" aria-atomic="true"><div><strong>V</strong>{latestAnswer.recipient !== null && <span>{t("meetingWorkspace.privateWith", { defaultValue: "Private with {{name}}", name: privateCounterpart(latestAnswer) })}</span>}</div><p>{latestAnswer.text}</p><small>{t("meetingWorkspace.savedTranscript", { defaultValue: "Saved in the transcript" })}</small></section>}
    <div className="meeting-timeline-label"><span>{recipient ? t("meetingWorkspace.privateWith", { defaultValue: "Private with {{name}}", name: person?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "attendee" }) }) : t("meetingWorkspace.liveTranscript", { defaultValue: "Live transcript" })}</span><span>{following ? t("meetingWorkspace.scrollFullMeeting", { defaultValue: "Scroll for full meeting" }) : <button onClick={() => setFollowing(true)}>{t("meetingWorkspace.jumpLatest", { defaultValue: "Jump to latest" })}</button>}</span></div>
    <div ref={timeline} className="meeting-timeline" role="log" aria-live="polite" aria-relevant="additions text" aria-atomic="false" aria-label={recipient ? t("meetingWorkspace.privateMessagesLabel", { defaultValue: "Private meeting messages" }) : t("meetingWorkspace.transcriptLabel", { defaultValue: "Meeting transcript" })} onScroll={() => { const node = timeline.current; if (node) setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 45); }}>
      {visible.length === 0 && <p className="meeting-empty">{search ? t("meetingWorkspace.noMatches", { defaultValue: "No matching entries." }) : recipient ? t("meetingWorkspace.emptyPrivate", { defaultValue: "Your private conversation starts here." }) : t("meetingWorkspace.emptyTimeline", { defaultValue: "Spoken words, typed messages, and shared files appear here." })}</p>}
      {visible.map((entry) => {
        const isV = entry.type === "askv";
        const own = entry.userId === data.userId && !isV && entry.type !== "system";
        const photo = isV || entry.type === "system" ? null : data.participants.find((p) => p.userId === entry.userId)?.photoUrl;
        return <article key={entry.id} className={`meeting-message ${own ? "meeting-message-own" : ""} ${activeEntryIds.has(entry.id) ? "meeting-message-active" : ""}`}><div className="meeting-message-heading">{photo && <img key={photo} src={photo} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}<strong style={{ color: own || isV ? "white" : brand.primary }}>{isV ? "V" : entry.name}</strong><time dateTime={new Date(entry.time).toISOString()}>{new Date(entry.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><small>{entry.recipient !== null ? t("meetingWorkspace.privateLabel", { defaultValue: "Private · {{name}}", name: privateCounterpart(entry) }) : entry.type === "Typed" ? t("meetingWorkspace.typed", { defaultValue: "Typed" }) : ""}</small></div><p>{entry.text}</p>{entry.extra}</article>;
      })}
    </div>
    <div role="status" aria-label={t("meetingWorkspace.activity", { defaultValue: "Meeting activity" })} aria-live="polite" className="meeting-activity">{scopedActivity.map((item) => <span key={item.userId}>{item.recipientUserId !== null && t("meetingWorkspace.privatePrefix", { defaultValue: "Private · " })}<strong style={{ color: brand.primary }}>{data.participants.find((p) => p.userId === item.userId)?.displayName ?? t("meetingWorkspace.anAttendee", { defaultValue: "An attendee" })}</strong> {item.kind === "typing" ? t("meetingWorkspace.typing", { defaultValue: "is typing a message…" }) : t("meetingWorkspace.addingFile", { defaultValue: "is adding a file…" })}</span>)}</div>
    {!ended && <div className="meeting-composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}>
      <div className="meeting-composer-heading"><span>{recipient ? t("meetingWorkspace.privateTo", { defaultValue: "Private message to {{name}}", name: person?.displayName ?? t("meetingWorkspace.attendee", { defaultValue: "attendee" }) }) : t("meetingWorkspace.messageMeeting", { defaultValue: "Message the meeting" })}</span><div>{recipient && <button onClick={() => setRecipient(null)}>{t("meetingWorkspace.backMeeting", { defaultValue: "Back to meeting" })}</button>}<button aria-label={t("meetingWorkspace.addFile", { defaultValue: "Add File" })} disabled={busy} onClick={() => fileInput.current?.click()}>+ {t("meetingWorkspace.addFile", { defaultValue: "Add File" })}</button><button aria-label={t("meetingWorkspace.takePhoto", { defaultValue: "Take photo" })} className="meeting-camera" disabled={busy} onClick={() => cameraInput.current?.click()}>{t("meetingWorkspace.takePhoto", { defaultValue: "Take photo" })}</button></div></div>
      <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain" onChange={(event) => void upload(event.target.files?.[0])} />
      <input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={(event) => void upload(event.target.files?.[0])} />
      <textarea ref={textarea} aria-label={recipient ? t("meetingWorkspace.privateTo", { defaultValue: "Private message to {{name}}", name: person?.displayName }) : t("meetingWorkspace.messageMeeting", { defaultValue: "Message the meeting" })} placeholder={recipient ? t("meetingWorkspace.privatePlaceholder", { defaultValue: "Private message to {{name}}…", name: person?.displayName }) : t("meetingWorkspace.messagePlaceholder", { defaultValue: "Message the meeting…" })} value={draft} onChange={(event) => updateDraft(event.target.value)} onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); void upload(event.clipboardData.files[0]); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <div className="meeting-composer-footer"><small>{t("meetingWorkspace.sendHint", { defaultValue: "Enter to send · Shift+Enter for a new line" })}</small><MeetingPill aria-label={t("meetingWorkspace.send", { defaultValue: "Send" })} disabled={busy || !draft.trim()} onClick={() => void send()}>{t("meetingWorkspace.send", { defaultValue: "Send" })}</MeetingPill></div>
    </div>}
    <details className="meeting-tools"><summary aria-label={t("meetingWorkspace.meetingTools", { defaultValue: "Meeting Tools" })}>{t("meetingWorkspace.meetingTools", { defaultValue: "Meeting Tools" })}</summary><div className="meeting-tool-actions">{tools.map((name) => <MeetingPill key={name} onClick={() => setTool(name)} aria-pressed={name === tool}>{toolLabel(name)}</MeetingPill>)}</div>
      <div className="meeting-tool-body" aria-label={toolLabel(tool)}>
        {tool === "Summary" && <p>{typeof data.recap?.summary === "string" ? data.recap.summary : t("meetingWorkspace.summaryEmpty", { defaultValue: "The saved meeting summary will appear here when available." })}</p>}
        {tool === "Agenda" && <p>{data.meeting.agenda || t("meetingWorkspace.agendaEmpty", { defaultValue: "No agenda was added." })}</p>}
        {["Action Items", "Decisions"].includes(tool) && <p>{JSON.stringify(data.recap?.[tool === "Decisions" ? "decisions" : "actionItems"] ?? []) === "[]" ? t("meetingWorkspace.itemsEmpty", { defaultValue: "No items have been published yet." }) : JSON.stringify(data.recap?.[tool === "Decisions" ? "decisions" : "actionItems"])}</p>}
        {tool === "Search" && <div className="meeting-search"><input aria-label={t("meetingWorkspace.searchMeeting", { defaultValue: "Search meeting" })} placeholder={t("meetingWorkspace.searchPlaceholder", { defaultValue: "Search text, names, or filenames" })} value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label={t("meetingWorkspace.filterSpeaker", { defaultValue: "Filter by speaker" })} value={speaker} onChange={(event) => setSpeaker(event.target.value)}><option value="">{t("meetingWorkspace.everyone", { defaultValue: "Everyone" })}</option>{data.participants.map((p) => <option key={p.userId} value={p.userId}>{p.displayName}</option>)}</select><button onClick={() => { setSearch(""); setSpeaker(""); }}>{t("meetingWorkspace.clearSearch", { defaultValue: "Clear search" })}</button><small>{t("meetingWorkspace.searchPrivacy", { defaultValue: "Results appear in the timeline. Private results are visible only to their two participants." })}</small></div>}
        {tool === "Attendance" && <ul>{data.participants.map((p) => { const visits = data.attendance.filter((a) => a.userId === p.userId); return <li key={p.userId}>{p.displayName} · {p.removedAt ? t("meetingWorkspace.removedByHost", { defaultValue: "Removed by host" }) : p.present ? t("meetingWorkspace.present", { defaultValue: "Present" }) : visits.length ? t("meetingWorkspace.left", { defaultValue: "Left" }) : t("meetingWorkspace.neverJoined", { defaultValue: "Never joined" })}{visits.map((a) => <small key={a.id}> · {new Date(a.joinedAt).toLocaleTimeString()} – {a.leftAt ? new Date(a.leftAt).toLocaleTimeString() : t("meetingWorkspace.connected", { defaultValue: "Connected" })}</small>)}</li>; })}</ul>}
        {tool === "Manage Attendees" && data.canManage && <div>{data.participants.filter((p) => p.role !== "host" && !p.removedAt).map((p) => <div className="meeting-manage-person" key={p.userId}><span>{p.displayName}</span><button disabled={busy} onClick={() => { if (window.confirm(t("meetingWorkspace.removeConfirm", { defaultValue: "Remove {{name}} from this meeting? Their contributions remain in the record.", name: p.displayName }))) void action(`participants/${p.userId}/remove`, {}); }}>{t("meetingWorkspace.removeMeeting", { defaultValue: "Remove from meeting" })}</button></div>)}{!ended && <button disabled={busy} onClick={() => { if (window.confirm(t("meetingWorkspace.endConfirm", { defaultValue: "End this meeting for everyone? Saved transcript entries will remain available." }))) { audio.stopTranscription(); void action("end", {}); } }}>{t("meetingWorkspace.endEveryone", { defaultValue: "End meeting for everyone" })}</button>}</div>}
      </div>
    </details>
  </section>;
}
