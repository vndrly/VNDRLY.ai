import { MeetingRecapItems } from "./meeting-recap-items";
import { Root as AgendaPopover } from "@radix-ui/react-popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Mic, MicOff, LogOut, PhoneOff, MessageSquare, MessageSquareOff, Plus, ArrowUp, FileText, ListTodo, ListChecks, Search, CalendarDays, UserCog, UserX, UserPlus } from "lucide-react";
import { CardHeading } from "@/components/ui/card-heading";
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
import MeetingSpeakRequest from "./meeting-speak-request";
import MeetingAssistantInvitation from "./meeting-assistant-invitation";
import MeetingReplayWorkspace from "./meeting-replay-workspace";
import { useMeetingSession } from "./meeting-session-provider";
import { useWorkHubActiveAudio } from "@/hooks/use-work-hub-active-audio";
import { workHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { WorkHubMiniCardButton } from "@/components/work-hub/chrome";

const meetingToolIcons: Record<string, typeof FileText> = { Summary: FileText, "Action Items": ListTodo, Decisions: ListChecks, Search, Agenda: CalendarDays, "Manage Attendees": UserCog, UserX, UserPlus };
function MeetingPill({ children, idle = false, tone = "brand", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { idle?: boolean; tone?: "brand" | "green" }) {
  const brand = useBrand();
  const src = idle ? PILL_IDLE : tone === "green" ? pillGreen : brandImagePillSrc(brand.primary, brand.name);
  return <button {...props} type="button" className="meeting-pill"><PillColorLayer src={src} className="absolute inset-0 h-full w-full" /><span className={`${PILL_LABEL_CLASS} ${pillLabelToneClass(idle)}`}>{children}</span></button>;
}
export function SpeakingBars({ active }: { active: boolean }) {
  return <span className="meeting-speaking-bars" data-active={active} aria-hidden="true">{[7, 12, 9, 13, 6].map((height, index) => <i key={index} style={{ height, animationDelay: `${index * -.13}s` }} />)}</span>;
}
type TimelineEntry = { id: string; userId: number | null; name: string; text: string; time: number; type: string; recipient: number | null; extra?: ReactNode };
type MeetingSnapshotWithPresence = Omit<MeetingSnapshot, "participants"> & { participants: Array<MeetingSnapshot["participants"][number] & { presenceKind?: "authenticated_device" | "host_confirmed_invitation" | null }> };

export default function MeetingWorkspace({ occurrenceId, onReturn }: { occurrenceId: string; onReturn?: () => void }) {
  const { t } = useTranslation();
  const brand = useBrand();
  const qc = useQueryClient();
  const queryKey = ["work-hub", "meeting-workspace", occurrenceId];
  const meeting = useQuery<MeetingSnapshotWithPresence>({ queryKey, queryFn: () => workHubRequest(`/meetings/${occurrenceId}/catch-up`), refetchInterval: 2000, retry: false });
  const data = meeting.data;
  const standaloneAudio = useMeetingAudio(occurrenceId, data);
  const meetingSession = useMeetingSession();
  useEffect(() => { meetingSession?.activate(occurrenceId); }, [meetingSession?.activate, occurrenceId]);
  const audio = meetingSession?.occurrenceId === occurrenceId && meetingSession.audio ? meetingSession.audio : standaloneAudio;
  const { data: activeAudio } = useWorkHubActiveAudio();
  const currentDeviceId = workHubDeviceIdentity(data?.userId)?.deviceId;
  const takeoverSource = activeAudio?.occurrenceId === occurrenceId && activeAudio.deviceId !== currentDeviceId ? activeAudio.deviceId : undefined;
  const [draft, setDraft] = useState("");
  const [recipient, setRecipient] = useState<number | null>(null);
  const [tool, setTool] = useState("Summary");
  const [search, setSearch] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [managedPerson, setManagedPerson] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePeople, setInvitePeople] = useState<{ userId: number; displayName: string | null }[]>([]);
  const [inviteSearch, setInviteSearch] = useState("");
  async function openInvites(open: boolean) {
    setInviteOpen(open);
    if (!open) return;
    setError(null);
    try { const result = await workHubRequest<{people: typeof invitePeople}>(`/meetings/${occurrenceId}/invite-candidates`); setInvitePeople(result.people); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load people"); }
  }
  async function invitePerson(userId: number) {
    setBusy(true); setError(null);
    try { await workHubRequest(`/meetings/${occurrenceId}/invitations`, { method: "POST", body: JSON.stringify({userId}) }); setInvitePeople(people => people.filter(p => p.userId !== userId)); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not invite person"); }
    finally { setBusy(false); }
  }
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [following, setFollowing] = useState(true);
  const timeline = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
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
  async function action(path: string, body: unknown, method = "POST") {
    setError(null); setBusy(true);
    try { await workHubRequest(`/meetings/${occurrenceId}/${path}`, { method, body: JSON.stringify(body) }); await refresh(); if (path === "end") { await audio.leave(); onReturn?.(); } }
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
      setFollowing(true); await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["work-hub-file-library"] }), qc.invalidateQueries({ queryKey: ["vendor-repository"] }), qc.invalidateQueries({ queryKey: ["work-hub", "files"] })]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("meetingWorkspace.fileAddUnable", { defaultValue: "Unable to add file." })); }
    finally { clearInterval(heartbeat); reportActivity(null); setBusy(false); if (fileInput.current) fileInput.current.value = ""; if (cameraInput.current) cameraInput.current.value = ""; if (photosInput.current) photosInput.current.value = ""; }
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
    return recipient === null ? item.recipient === null : (item.recipient !== null && (item.userId === recipient || item.recipient === recipient));
  });
  const visible = threadEntries.filter((item) => (!search || `${item.name} ${item.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (!speaker || item.userId === Number(speaker)));
  useEffect(() => { if (following && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; }, [entries.length, following, recipient]);
  const selfParticipant = data?.participants.find((participant) => participant.userId === data.userId);
  useEffect(() => {
    if (selfParticipant?.hostMutedAt && audio.joined && !audio.muted) void audio.toggleMute();
  }, [audio.joined, audio.muted, audio.toggleMute, selfParticipant?.hostMuteGeneration, selfParticipant?.hostMutedAt]);
  if (!data) return <section className="meeting-workspace" aria-label={t("meetingWorkspace.workspaceLabel", { defaultValue: "Meeting workspace" })}><p role={meeting.error ? "alert" : "status"}>{meeting.error ? meeting.error.message : t("meetingWorkspace.opening", { defaultValue: "Opening meeting…" })}</p></section>;
  const host = data.participants.find((p) => p.role === "host");
  const currentSpeaker = data.participants.find((p) => p.speaking);
  const present = data.participants.filter((p) => p.present);
  const ended = ["ended", "cancelled"].includes(data.occurrence.status);
  const timing = meetingTimer(data.occurrence.startedAt, data.occurrence.startsAt, data.occurrence.endsAt, data.occurrence.endedAt ? Date.parse(data.occurrence.endedAt) : now);
  const invited = Boolean(data.occurrence.askvInvitedAt);
  const viewOnly = data.participationMode === "view_only" || data.myConsent !== "accepted";
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
  const tools = ["Summary", "Action Items", "Decisions", "Search", "Agenda", "Manage Attendees"];
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
    <div className="meeting-scroll-content">
    <header className="meeting-header">
      <div className="meeting-heading">
        <CardHeading as="h2">{data.meeting.title}</CardHeading>
        {data.transcriptionIndicator === "persistent" && <span className="meeting-recording-indicator" role="status">● {t("meetingWorkspace.transcriptionActiveIndicator", { defaultValue: "Transcription active" })}</span>}
        <div className="meeting-presence-row"><span className="meeting-host">{host?.displayName ?? t("meetingWorkspace.host", { defaultValue: "Host" })} · {t("meetingWorkspace.host", { defaultValue: "Host" })}</span><span>{t("meetingWorkspace.presentCount", { defaultValue: "{{count}} present", count: present.length })} · {ended ? t("meetingWorkspace.meetingEnded", { defaultValue: "Meeting ended" }) : audio.joined ? t("meetingWorkspace.live", { defaultValue: "Live" }) : t("meetingWorkspace.workspaceLabel", { defaultValue: "Meeting workspace" })} · {audio.transcriptionActive ? t("meetingWorkspace.transcribingMic", { defaultValue: "Transcribing your microphone" }) : invited ? captureLabel : t("meetingWorkspace.transcriptionPaused", { defaultValue: "Transcription paused" })}</span><span className="meeting-current-speaker" role="status" aria-live="polite" aria-label={currentSpeaker ? t("meetingWorkspace.speaking", { defaultValue: "{{name}} speaking", name: currentSpeaker.displayName }) : t("meetingWorkspace.noOneSpeaking", { defaultValue: "No one speaking" })}><SpeakingBars active={Boolean(currentSpeaker)} /><strong>{currentSpeaker ? t("meetingWorkspace.speaking", { defaultValue: "{{name}} speaking", name: currentSpeaker.displayName }) : t("meetingWorkspace.noOneSpeaking", { defaultValue: "No one speaking" })}</strong></span></div>
        <div className="meeting-actions">
          <AskVListeningPill active={audio.transcriptionActive} statusLabel={captureLabel} disabled={true} title={data.canManage ? t("meetingWorkspace.pauseRestartV", { defaultValue: "Pause or restart V" }) : t("meetingWorkspace.hostControlsV", { defaultValue: "The host controls V" })} onClick={() => undefined} />
          <MeetingAssistantInvitation occurrenceId={occurrenceId} version={data.assistantInvitationVersion} canManage={data.canManageAssistantInvitation === true && !ended} invited={invited} onSaved={(next) => { if (!next) audio.stopTranscription(); return qc.invalidateQueries({ queryKey }); }} />
          {data.canManage && !ended && <button type="button" className="meeting-icon-button" aria-label="End" title="End" disabled={busy} onClick={() => { if (window.confirm(t("meetingWorkspace.endConfirm", { defaultValue: "End this meeting for everyone? Saved transcript entries will remain available." }))) { audio.stopTranscription(); void action("end", {}); } }}><PhoneOff /></button>}
          {onReturn && <button type="button" className="meeting-icon-button" aria-label="Leave" title="Leave" onClick={async () => { if (audio.joined) await audio.leave(); onReturn(); }}><LogOut /></button>}
          {!audio.joined && !ended && !viewOnly && <button disabled={audio.connecting} onClick={() => void audio.join()}>{t("meetingWorkspace.joinAudio", { defaultValue: "Join audio" })}</button>}
          {!onReturn && audio.joined && <button type="button" className="meeting-icon-button" aria-label={t("meetingWorkspace.leave", { defaultValue: "Leave" })} title={t("meetingWorkspace.leave", { defaultValue: "Leave" })} onClick={() => void audio.leave()}><LogOut /></button>}
          {audio.joined && <><button type="button" className="meeting-icon-button" aria-label={audio.muted || selfParticipant?.hostMutedAt ? <MicOff /> : <Mic />} title={audio.muted || selfParticipant?.hostMutedAt ? <MicOff /> : <Mic />} disabled={Boolean(selfParticipant?.hostMutedAt)} onClick={() => void audio.toggleMute()} aria-pressed={audio.muted}>{audio.muted || selfParticipant?.hostMutedAt ? <MicOff /> : <Mic />}</button></>}
          {!ended && !viewOnly && (takeoverSource || (audio.joined && audio.audioOnAnotherDevice)) && <WorkHubMiniCardButton disabled={audio.connecting || audio.handoffBusy} onClick={() => void (audio.joined ? audio.moveAudioHere(takeoverSource) : audio.join(takeoverSource))}>
            {t(audio.connecting || audio.handoffBusy ? "workHubDevices.takingOver" : "workHubDevices.takeOver")}
          </WorkHubMiniCardButton>}
          {audio.joined && !takeoverSource && !audio.audioOnAnotherDevice && <WorkHubMiniCardButton disabled={audio.disconnecting} onClick={() => void audio.disconnect()}>
            {t(audio.disconnecting ? "workHubDevices.disconnecting" : "workHubDevices.disconnect")}
          </WorkHubMiniCardButton>}
          <MeetingSpeakRequest occurrenceId={occurrenceId} pending={Boolean(data.mySpeakRequest)} canRequest={Boolean(selfParticipant?.hostMutedAt) && ["scheduled", "live"].includes(data.occurrence.status)} onSaved={refresh} />
        </div>
      </div>
      <div className="meeting-people">
        
        {data.assistantParticipant?.visible && <span className="meeting-person" aria-label={`${data.assistantParticipant.label}, ${data.assistantParticipant.state}`}><strong>{data.assistantParticipant.label}</strong> · {data.assistantParticipant.state === "paused" ? t("meetingWorkspace.paused", { defaultValue: "Paused" }) : t("meetingWorkspace.silentAssistant", { defaultValue: "Silent unless addressed" })}</span>}


      </div>
    <details className="meeting-tools"><summary aria-label={t("meetingWorkspace.meetingTools", { defaultValue: "Meeting Tools" })}>{t("meetingWorkspace.meetingTools", { defaultValue: "Meeting Tools" })}</summary><div className="meeting-tool-actions">{tools.map((name) => { const Icon = meetingToolIcons[name]; if (name === "Agenda") return <AgendaPopover key={name} open={tool === "Agenda"} onOpenChange={open => setTool(open ? "Agenda" : "")}><PopoverTrigger asChild><button type="button" className="meeting-icon-button" aria-label="Agenda" title="Agenda"><CalendarDays /></button></PopoverTrigger><PopoverContent align="start" className="meeting-agenda-flyout"><p>{data.meeting.agenda || t("meetingWorkspace.agendaEmpty", { defaultValue: "No agenda was added." })}</p></PopoverContent></AgendaPopover>; return <button type="button" className="meeting-icon-button" key={name} aria-label={toolLabel(name)} title={toolLabel(name)} onClick={() => setTool(current => current === name ? "" : name)} aria-pressed={name === tool}><Icon /></button>; })}</div>
      <div className="meeting-tool-body" aria-label={tool ? toolLabel(tool) : undefined} hidden={!tool}>
        {tool === "Summary" && <p>{typeof data.recap?.summary === "string" ? data.recap.summary : t("meetingWorkspace.summaryEmpty", { defaultValue: "The summary updates as the meeting progresses." })}</p>}
        {["Action Items", "Decisions"].includes(tool) && <MeetingRecapItems value={data.recap?.[tool === "Decisions" ? "decisions" : "actionItems"]} />}
        {tool === "Search" && <div className="meeting-search"><input aria-label={t("meetingWorkspace.searchMeeting", { defaultValue: "Search meeting" })} placeholder={t("meetingWorkspace.searchPlaceholder", { defaultValue: "Search text, names, or filenames" })} value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label={t("meetingWorkspace.filterSpeaker", { defaultValue: "Filter by speaker" })} value={speaker} onChange={(event) => setSpeaker(event.target.value)}><option value="">{t("meetingWorkspace.everyone", { defaultValue: "Everyone" })}</option>{data.participants.map((p) => <option key={p.userId} value={p.userId}>{p.displayName}</option>)}</select><button onClick={() => { setSearch(""); setSpeaker(""); }}>{t("meetingWorkspace.clearSearch", { defaultValue: "Clear search" })}</button><small>{t("meetingWorkspace.searchPrivacy", { defaultValue: "Results appear in the timeline. Private results are visible only to their two participants." })}</small></div>}
        {tool === "Manage Attendees" && <div className="meeting-manage-compact">
          <Select value={managedPerson} onValueChange={setManagedPerson}><SelectTrigger aria-label="Choose participant"><SelectValue placeholder="Choose participant" /></SelectTrigger><SelectContent>{data.participants.filter(p => !p.removedAt).map(p => <SelectItem key={p.userId} value={String(p.userId)}>{!p.present && <span className="meeting-absent-label">Absent </span>}<span className={!p.present ? "meeting-absent-name" : undefined}>{p.displayName}</span></SelectItem>)}</SelectContent></Select>
          <button type="button" className="meeting-icon-button" aria-label={recipient !== null ? "Stop PM" : "Private message"} title={recipient !== null ? "Stop PM" : "Private message"} disabled={recipient === null && (ended || !data.participants.some(p => String(p.userId) === managedPerson && p.present && !p.removedAt && p.userId !== data.userId))} onClick={() => { setRecipient(recipient !== null ? null : Number(managedPerson)); setDraft(""); setTimeout(() => textarea.current?.focus(), 0); }}>{recipient !== null ? <MessageSquareOff /> : <MessageSquare />}</button>
          {(data.canManage || data.canModerate) && data.participants.filter(p => String(p.userId) === managedPerson && !p.removedAt).map(p => <div className="meeting-manage-person" key={p.userId}>
            <button type="button" className="meeting-icon-button" aria-label={p.hostMutedAt ? "Unmute attendee" : "Mute attendee"} title={p.hostMutedAt ? "Unmute attendee" : "Mute attendee"} disabled={busy || ended || !p.present || p.userId === data.userId || p.role === "host" || !(data.canManage || selfParticipant?.role === "host" || p.role === "participant")} onClick={() => void action(`participants/${p.userId}/host-mute`, {}, p.hostMutedAt ? "DELETE" : "POST")}>{p.hostMutedAt ? <Mic /> : <MicOff />}</button>
            {data.canManage && <button type="button" className="meeting-icon-button" aria-label="Boot attendee" title="Boot attendee" disabled={busy || ended || !p.present || p.userId === data.userId || p.role === "host"} onClick={() => { if (window.confirm(t("meetingWorkspace.removeConfirm", { defaultValue: "Remove {{name}} from this meeting? Their contributions remain in the record.", name: p.displayName }))) void action(`participants/${p.userId}/remove`, {}); }}><UserX /></button>}
          </div>)}
          {data.canManage && !ended && <Popover open={inviteOpen} onOpenChange={open => void openInvites(open)}><PopoverTrigger asChild><button type="button" className="meeting-icon-button" aria-label="Invite to meeting" title="Invite to meeting"><UserPlus /></button></PopoverTrigger><PopoverContent className="meeting-pm-flyout" align="start"><input aria-label="Find people to invite" placeholder="Find people" value={inviteSearch} onChange={event => setInviteSearch(event.target.value)} /><div className="meeting-roster">{invitePeople.filter(p => (p.displayName ?? "").toLowerCase().includes(inviteSearch.toLowerCase())).map(p => <button type="button" key={p.userId} disabled={busy} onClick={() => void invitePerson(p.userId)}>{p.displayName ?? "Member"}<UserPlus size={16} /></button>)}{invitePeople.length === 0 && <span>No more people to invite</span>}</div></PopoverContent></Popover>}
        </div>}

      </div>
    </details></header>
      
    <div className="meeting-timer">
      <span>{t("meetingWorkspace.elapsed", { defaultValue: "Elapsed" })} <strong>{meetingClock(timing.elapsedMs)}</strong>{timing.targetMs > 0 && <> · {t("meetingWorkspace.target", { defaultValue: "Target" })} <strong>{meetingClock(timing.targetMs)}</strong></>}{timing.overtimeMs > 0 && <strong className="meeting-overtime"> · {t("meetingWorkspace.overtime", { defaultValue: "Overtime" })} +{meetingClock(timing.overtimeMs)}</strong>}</span>
      {timing.targetMs > 0 && <div role="progressbar" aria-label={t("meetingWorkspace.duration", { defaultValue: "Meeting duration" })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(timing.progress)} aria-valuetext={timing.overtimeMs > 0 ? `${t("meetingWorkspace.overtime", { defaultValue: "Overtime" })} ${meetingClock(timing.overtimeMs)}` : `${meetingClock(timing.elapsedMs)} ${t("meetingWorkspace.elapsed", { defaultValue: "elapsed" })}`} className="meeting-progress"><span style={{ width: `${timing.progress}%`, background: timing.warning ? "#F59E0B" : brand.primary }} /></div>}
    </div>
    {ended && <MeetingReplayWorkspace occurrenceId={occurrenceId} meeting={data} />}

    {viewOnly && !ended && <div className="meeting-notice" aria-live="polite"><p>{t("meetingWorkspace.participationAuthorization", { defaultValue: "You are viewing this meeting. Accept the work participation authorization to speak, post, and share files. Transcription begins automatically under your company policy." })}</p><button disabled={busy} onClick={() => void action("consent", { policyVersion: data.meeting.policyVersion, response: "accepted" })}>{t("meetingWorkspace.acceptAndParticipate", { defaultValue: "Accept and participate" })}</button></div>}
    {invited && !ended && !captureAvailable && <p className="meeting-notice">{t("meetingWorkspace.captureUnavailable", { defaultValue: "Transcription is unavailable. Your microphone is not being transcribed." })}</p>}
    {audio.transcriptionError && <div className="meeting-notice"><p role="alert" className="meeting-error">{audio.transcriptionError}</p>{audio.joined && !audio.muted && data.transcription && captureAvailable && <button onClick={audio.retryTranscription}>{t("meetingWorkspace.retryTranscription", { defaultValue: "Retry transcription" })}</button>}</div>}
    {audio.needsPlayback && <button onClick={() => void audio.enablePlayback()}>{t("meetingWorkspace.playAudio", { defaultValue: "Play meeting audio" })}</button>}
    {audio.failoverCountdown !== null && <div className="meeting-notice" role="status" aria-live="assertive"><p>{t("meetingWorkspace.failoverCountdown", { defaultValue: "Audio device disconnected. This microphone will turn on in {{count}} seconds.", count: audio.failoverCountdown })}</p><button onClick={audio.cancelFailover}>{t("meetingWorkspace.cancelFailover", { defaultValue: "Keep microphone off" })}</button></div>}
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

    
    </div>
    {!ended && <div className={`meeting-composer ${viewOnly ? "meeting-composer-view-only" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}>
<div className="meeting-input-row"><Popover><PopoverTrigger asChild><button type="button" className="meeting-icon-button" aria-label="Add attachment" title="Add attachment" disabled={busy || viewOnly}><Plus /></button></PopoverTrigger><PopoverContent side="top" align="start" collisionPadding={12} className="meeting-pm-flyout"><div className="meeting-roster"><button type="button" onClick={() => cameraInput.current?.click()}>Camera</button><button type="button" onClick={() => photosInput.current?.click()}>Photos</button><button type="button" onClick={() => fileInput.current?.click()}>Files</button></div></PopoverContent></Popover>
      <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain" onChange={(event) => void upload(event.target.files?.[0])} />
      <input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={(event) => void upload(event.target.files?.[0])} />
      <input ref={photosInput} hidden type="file" accept="image/*" onChange={(event) => void upload(event.target.files?.[0])} />
      <textarea ref={textarea} disabled={viewOnly} aria-label={recipient ? t("meetingWorkspace.privateTo", { defaultValue: "Private message to {{name}}", name: person?.displayName }) : t("meetingWorkspace.messageMeeting", { defaultValue: "Message the meeting" })} placeholder={recipient ? t("meetingWorkspace.privatePlaceholder", { defaultValue: "Private message to {{name}}…", name: person?.displayName }) : t("meetingWorkspace.messagePlaceholder", { defaultValue: "Message the meeting…" })} value={draft} onChange={(event) => updateDraft(event.target.value)} onPaste={(event) => { if (event.clipboardData.files.length) { event.preventDefault(); void upload(event.clipboardData.files[0]); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <button type="button" className="meeting-icon-button meeting-send" aria-label="Send" title="Send" disabled={busy || viewOnly || !draft.trim()} onClick={() => void send()}><ArrowUp /></button></div>
    </div>}
  </section>;
}
