import { CommsUnreadIcon, useCommsSeen } from "./comms-unread-icon";
import { subscribeSharedEventStream } from "@/lib/shared-notification-stream";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Check,
  Laptop,
  Maximize2,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import MeetingAudioRoom from "@/components/meeting-audio-room";
import { useMeetingSession } from "@/components/meeting-session-provider";
import {
  createWorkHubOperationId,
  workHubRequest,
} from "@/lib/work-hub-client";
import { workHubDeviceIdentity } from "@/hooks/use-work-hub-device-presence";
import { useWorkHubActiveAudio } from "@/hooks/use-work-hub-active-audio";
import WorkHubDeviceSettings from "./device-settings";
import VoicemailPlayback from "./voicemail-playback";
import { HubError, type DirectoryPerson } from "./collaboration";
import CallContactPicker from "./call-contact-picker";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  WorkHubCardTitle,
  WorkHubMiniCardButton,
  WorkHubPageHeading,
  WORK_HUB_CARD_CLASS,
  WORK_HUB_SUBCARD_CLASS,
} from "./chrome";
import "./calls.css";
type Call = {
  id: string;
  occurrenceId: string;
  status: string;
  incoming: boolean;
  callerUserId: number;
  recipientUserId: number;
  callerName: string;
  recipientName: string;
  createdAt: string;
};
type Mail = {
  id: string;
  senderUserId: number;
  senderName: string;
  durationMs: number;
  createdAt: string;
  readAt: string | null;
  transcript: string | null;
};
const missedStatuses = ["missed", "declined", "busy", "unavailable"];
const MIDCON_VENDOR_ID = 1054;
const callSettingsKey = ["work-hub", "call-settings"] as const;
const callLogIconButtonClass = "inline-grid size-11 shrink-0 place-items-center rounded-md border-0 bg-transparent text-[var(--brand-primary)] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-current disabled:opacity-40";
const callContactTextClass = "cursor-pointer rounded-sm text-left font-medium no-underline hover:text-[var(--brand-primary)] focus-visible:outline-2 focus-visible:outline-offset-2";
const callToolClass = "grid size-9 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-[var(--brand-primary)] hover:bg-white/10 aria-expanded:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1";
type CallLogEntry = { id: string; name: string; contactId: number; createdAt: string } & (
  { type: "Incoming" | "Outgoing" | "Missed"; call: Call } | { type: "Voicemail"; mail: Mail }
);
type Settings = { available: boolean; speedDial: number[] };
const formatCallTime = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
function VoicemailRecorder({
  callId,
  onSent,
}: {
  callId: string;
  onSent: () => void;
}) {
  const [recording, setRecording] = useState(false),
    [clip, setClip] = useState<Blob | null>(null),
    [error, setError] = useState<unknown>(null),
    [sending, setSending] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    started = useRef(0),
    duration = useRef(0),
    operationId = useRef(createWorkHubOperationId());
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  const start = async () => {
    try {
      setError(null);
      setClip(null);
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Recording requires microphone access in a current browser over HTTPS.",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      const type = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const media = new MediaRecorder(
          stream.current,
          type ? { mimeType: type } : undefined,
        ),
        chunks: Blob[] = [];
      recorder.current = media;
      operationId.current = createWorkHubOperationId();
      started.current = Date.now();
      media.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      media.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        duration.current = Math.min(120000, Date.now() - started.current);
        stream.current?.getTracks().forEach((t) => t.stop());
        setClip(new Blob(chunks, { type: media.mimeType }));
        setRecording(false);
      };
      media.start();
      setRecording(true);
      timer.current = setTimeout(
        () => media.state === "recording" && media.stop(),
        120000,
      );
    } catch (cause) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(cause);
    }
  };
  const send = async () => {
    if (!clip) return;
    setSending(true);
    setError(null);
    try {
      if (clip.size > 4 * 1024 * 1024)
        throw new Error(
          "This recording is larger than 4 MB. Record a shorter message.",
        );
      const response = await fetch(`/api/work-hub/calls/${callId}/voicemail`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": clip.type,
          "x-operation-id": operationId.current,
          "x-duration-ms": String(duration.current),
        },
        body: clip,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message ??
            "Voicemail could not be sent. Your recording is ready to retry.",
        );
      }
      setClip(null);
      onSent();
    } catch (cause) {
      setError(cause);
    } finally {
      setSending(false);
    }
  };
  return (
    <div data-work-hub-card className={`space-y-3 p-4 ${WORK_HUB_SUBCARD_CLASS}`}>
      <p className="font-medium">Leave a private voicemail</p>
      <p className="text-sm text-muted-foreground">
        Only the recipient can play this message. Up to two minutes.
      </p>
      <HubError error={error} />
      <div className="flex flex-wrap gap-2">
        {recording ? (
          <WorkHubMiniCardButton onClick={() => recorder.current?.stop()}>
            Stop recording
          </WorkHubMiniCardButton>
        ) : (
          <WorkHubMiniCardButton disabled={sending} onClick={() => void start()}>
            {clip ? "Record again" : "Record message"}
          </WorkHubMiniCardButton>
        )}
        {clip && (
          <WorkHubMiniCardButton disabled={sending} onClick={() => void send()}>
            {sending ? "Sending…" : "Send voicemail"}
          </WorkHubMiniCardButton>
        )}
      </div>
      {recording && <p role="status">Recording…</p>}
    </div>
  );
}
export function WorkHubCalls({ embedded = false, listOnly = false, dialOnly = false, toolbarTargetId, onActivate }: { embedded?: boolean; listOnly?: boolean; dialOnly?: boolean; toolbarTargetId?: string; onActivate?: () => void }) {
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setToolbarTarget(toolbarTargetId ? document.getElementById(toolbarTargetId) : null);
  }, [toolbarTargetId]);
  const { user } = useAuth();
  const callSeen = useCommsSeen(`${user?.userId}:${user?.activeMembershipId}`, "calls");
  const { t } = useTranslation();
  const search = new URLSearchParams(useSearch());
  const callId = search.get("callId");
  const voicemailId = search.get("voicemailId");
  const linkedPerson = search.get("person") ?? "";
  const devicesTitle = t("workHubDevices.title", { defaultValue: "Devices and audio backup" });
  const session = useMeetingSession();
  const { data: activeAudio } = useWorkHubActiveAudio();
  const queryClient = useQueryClient();
  const callDetailId = useId();
  const voicemailPlayer = useRef<HTMLAudioElement>(null);
  const voicemailPanel = useRef<HTMLElement>(null);
  const pendingDial = useRef<{
    recipientUserId: number;
    operationId: string;
  } | null>(null);
  const [person, setPerson] = useState(linkedPerson),
    [panel, setPanel] = useState<"dial" | "devices" | "log">(linkedPerson ? "dial" : "log"),
    [selected, setSelected] = useState<string | null>(null),
    [expandedDetail, setExpandedDetail] = useState<{ entryId: string; voicemailId?: string } | null>(null),
    [mailCall, setMailCall] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (callId) {
      setSelected(callId);
      setExpandedDetail({ entryId: `call-${callId}` });
    }
  }, [callId]);
  useEffect(() => {
    if (linkedPerson) {
      setPerson(linkedPerson);
      setPanel("dial");
    }
  }, [linkedPerson]);
  useEffect(()=>{if(voicemailId){setPanel("log");setExpandedDetail({entryId:`voicemail-${voicemailId}`,voicemailId});}},[voicemailId]);
  const listenToVoicemail = (mail: Mail, entryId = `voicemail-${mail.id}`) => {
    // Mount the player within the click so browsers can honor the user gesture.
    flushSync(() => setExpandedDetail({ entryId, voicemailId: mail.id }));
    void voicemailPlayer.current?.play().catch(() => setNotice("Press Play in the voicemail player to listen."));
  };
  const calls = useQuery<Call[]>({
    queryKey: ["work-hub", "calls"],
    queryFn: () => workHubRequest("/calls"),
    refetchInterval: 3000,
  });
  const voicemail = useQuery<Mail[]>({
    queryKey: ["work-hub", "voicemail"],
    queryFn: () => workHubRequest("/voicemail"),
    refetchInterval: 15000,
  });
  const settings = useQuery<Settings>({
    queryKey: callSettingsKey,
    queryFn: () => workHubRequest("/calls/settings"),
  });
  const people = useQuery<DirectoryPerson[]>({
    queryKey: ["work-hub", "call-people", user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest("/people?directory=calls"),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["work-hub", "calls"] });
    void queryClient.invalidateQueries({ queryKey: ["work-hub", "voicemail"] });
  };
  const change = useMutation({
    mutationFn: async ({
      path,
      method = "POST",
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) =>
      workHubRequest(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: async (_result, { path, method }) => {
      if (path === "/calls/settings") {
        await queryClient.invalidateQueries({ queryKey: callSettingsKey });
      } else {
        if (method === "DELETE" && path.startsWith("/voicemail/")) {
          const deletedId = path.slice("/voicemail/".length);
          setExpandedDetail(current => {
            if (current?.entryId === `voicemail-${deletedId}`) return null;
            if (current?.voicemailId === deletedId) return { entryId: current.entryId };
            return current;
          });
        }
        refresh();
      }
    },
  });
  const dial = useMutation({
    mutationFn: (recipientUserId: number) => {
      if (pendingDial.current?.recipientUserId !== recipientUserId)
        pendingDial.current = {
          recipientUserId,
          operationId: createWorkHubOperationId(),
        };
      return workHubRequest<Call>("/calls", {
        method: "POST",
        body: JSON.stringify(pendingDial.current),
      });
    },
    onSuccess: (row) => {
      pendingDial.current = null;
      setPanel(current => current === "dial" ? "log" : current);
      setSelected(row.id);
      setExpandedDetail({ entryId: `call-${row.id}` });
      setNotice("");
      if (["busy", "unavailable"].includes(row.status)) setMailCall(row.id);
      refresh();
    },
  });
  const active = calls.data?.find((c) => c.id === selected)
    ?? calls.data?.find((c) => c.status === "active")
    ?? calls.data?.find((c) => !c.incoming && c.status === "ringing");
  const callAudio = session?.occurrenceId === active?.occurrenceId ? session?.audio : undefined;
  const activeDeviceAudio = session?.occurrenceId === activeAudio?.occurrenceId ? session?.audio : undefined;
  const currentDeviceId = workHubDeviceIdentity(user?.userId)?.deviceId;
  const callAudioSource = activeAudio?.occurrenceId === active?.occurrenceId && activeAudio?.deviceId !== currentDeviceId ? activeAudio?.deviceId : undefined;
  const incoming =
    calls.data?.filter((c) => c.incoming && c.status === "ringing") ?? [];
  const history: CallLogEntry[] = [
    ...(calls.data ?? []).map((call): CallLogEntry => ({
      id: `call-${call.id}`,
      type: call.incoming ? (missedStatuses.includes(call.status) ? "Missed" : "Incoming") : "Outgoing",
      name: (call.incoming ? call.callerName : call.recipientName) ?? "Unknown contact",
      contactId: call.incoming ? call.callerUserId : call.recipientUserId,
      createdAt: call.createdAt,
      call,
    })),
    ...(voicemail.data ?? []).map((mail): CallLogEntry => ({
      id: `voicemail-${mail.id}`,
      type: "Voicemail",
      name: mail.senderName,
      contactId: mail.senderUserId,
      createdAt: mail.createdAt,
      mail,
    })),
  ];
  history.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const expandedEntry = history.find(entry => entry.id === expandedDetail?.entryId);
  const expandedCallId = expandedEntry && expandedEntry.type !== "Voicemail" ? expandedEntry.call.id : undefined;
  useEffect(()=>{if(expandedCallId && !callSeen.seen.includes(expandedCallId)) callSeen.markSeen(expandedCallId);},[expandedCallId]);
  const selectedMail = voicemail.data?.find(mail => mail.id === expandedDetail?.voicemailId)
    ?? (expandedEntry?.type === "Voicemail" ? expandedEntry.mail : null);
  const selectedMailId = selectedMail?.id;
  const voicemailSeconds = Math.round((selectedMail?.durationMs ?? 0) / 1000);
  useEffect(() => {
    if (selectedMailId) voicemailPanel.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedMailId]);
  const contactHistory = expandedEntry ? history.filter(entry => entry.contactId === expandedEntry.contactId) : [];
  const contactHistoryList = expandedEntry ? (
    <ul aria-label={`Call history with ${expandedEntry.name}`} className="max-h-60 divide-y overflow-y-auto border-y text-sm">
      {contactHistory.map(entry => (
        <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <span>{entry.type}</span>
          <div className="flex items-center gap-2">
            {entry.type === "Voicemail" && (
              <button type="button" className={`${callContactTextClass} inline-grid h-5 w-7 place-items-center border-0 bg-transparent text-[var(--brand-primary)] hover:brightness-125`} title="Listen"
                aria-label={`Listen to voicemail from ${entry.name}, ${formatCallTime(entry.createdAt)}`}
                onClick={() => listenToVoicemail(entry.mail, expandedEntry.id)}>
                <Play className="size-3.5" aria-hidden="true" />
              </button>
            )}
            <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">{formatCallTime(entry.createdAt)}</time>
          </div>
        </li>
      ))}
    </ul>
  ) : null;
  const historyLoading = calls.isLoading || voicemail.isLoading;
  const respond = (id: string, action: string) => {
    setSelected(id);
    const identity = action === "accept" ? workHubDeviceIdentity(user?.userId) : null;
    change.mutate({ path: `/calls/${id}/respond`, body: { action, ...(identity ?? {}) } });
  };
  useEffect(() => {
    // The overview shares the full Calls panel's query cache and live updates.
    if (listOnly || dialOnly || typeof EventSource === "undefined") return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const refreshCalls = (event: Event) => {
      try {
        const envelope = JSON.parse((event as MessageEvent<string>).data) as {
          subject?: { type?: unknown; id?: unknown };
        };
        if (envelope.subject?.type === "work_hub_voicemail") {
          void queryClient.invalidateQueries({ queryKey: ["work-hub", "voicemail"] });
          return;
        }
        if (envelope.subject?.type !== "work_hub_call" || typeof envelope.subject.id !== "string")
          return;
        const callId = envelope.subject.id;
        const type = event.type;
        const status =
          type === "work_hub.call.answered"
            ? "active"
            : type === "work_hub.call.declined"
              ? "declined"
              : type === "work_hub.call.missed"
                ? "missed"
                : "ended";
        queryClient.setQueryData<Call[]>(["work-hub", "calls"], (rows) =>
          rows?.map((call) =>
            call.id === callId ? { ...call, status } : call,
          ),
        );
        refresh();
      } catch {
        // Polling remains the fallback for malformed or interrupted events.
      }
    };
    const names = [
      "work_hub.call.answered",
      "work_hub.call.declined",
      "work_hub.call.ended",
      "work_hub.call.missed",
      "work_hub.voicemail.created",
      "work_hub.voicemail.read",
      "work_hub.voicemail.deleted",
    ];
    return subscribeSharedEventStream(`${base}/api/work-hub/events`,
      `${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}`,
      (_type, event) => refreshCalls(event), names, "work-hub-calls");
  }, [queryClient, listOnly, dialOnly, user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId]);
  const saveSpeedDialContact = (id: number, saved: boolean) => {
    change.mutate({
      path: "/calls/settings",
      method: "PUT",
      body: { speedDialContact: { id, saved } },
    });
  };
  const available = settings.data?.available ?? true;
  const liveCallControls = active && (
    <div className="space-y-2" data-call-ringing={active.status === "ringing" ? "" : undefined}>
      {active.status === "ringing" && <p role="status">Calling…</p>}
      {active.status === "active" && (session && currentDeviceId ? (
        <div className="flex flex-wrap items-center gap-2">
          {callAudio?.joined ? <>
            <WorkHubMiniCardButton onClick={() => void callAudio.toggleMute()}>{callAudio.muted ? "Unmute" : "Mute"}</WorkHubMiniCardButton>
            {callAudio.needsPlayback && <WorkHubMiniCardButton onClick={() => void callAudio.enablePlayback()}>Resume audio</WorkHubMiniCardButton>}
          </> : <>
            <WorkHubMiniCardButton disabled={callAudio?.connecting} onClick={() => session.connect(active.occurrenceId, undefined, active.id)}>
              {callAudio?.connecting ? "Connecting…" : "Join audio"}
            </WorkHubMiniCardButton>
            {callAudioSource && <WorkHubMiniCardButton disabled={callAudio?.connecting} onClick={() => session.connect(active.occurrenceId, callAudioSource, active.id)}>
              Take Over
            </WorkHubMiniCardButton>}
          </>}
        </div>
      ) : (
        <MeetingAudioRoom occurrenceId={active.occurrenceId} />
      ))}
      <WorkHubMiniCardButton onClick={() => respond(active.id, "end")}>End call</WorkHubMiniCardButton>
    </div>
  );
  const voicemailDetails = selectedMail && (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <VoicemailPlayback key={selectedMail.id} audioRef={voicemailPlayer}
          src={`/api/work-hub/voicemail/${selectedMail.id}/audio`}
          label={`Voicemail from ${selectedMail.senderName}`}
          durationMs={selectedMail.durationMs} onPlay={refresh} />
        <button
          type="button"
          className={`${callContactTextClass} inline-flex min-h-8 items-center gap-1.5 border-0 bg-transparent text-sm disabled:opacity-50`}
          disabled={change.isPending}
          onClick={() => change.mutate({ path: `/voicemail/${selectedMail.id}`, method: "DELETE" })}
        >
          Delete
          <Trash2 aria-hidden="true" className="size-3.5 text-[var(--brand-primary)]" />
        </button>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-xs text-muted-foreground">{voicemailSeconds} {voicemailSeconds === 1 ? "second" : "seconds"}</span>
        {selectedMail.transcript
          ? <p className="min-w-0 whitespace-pre-wrap break-words text-sm">{selectedMail.transcript}</p>
          : <WorkHubMiniCardButton disabled={change.isPending}
            onClick={() => change.mutate({ path: `/voicemail/${selectedMail.id}/transcribe`, body: {} })}>Transcribe</WorkHubMiniCardButton>}
      </div>
    </>
  );
  const startCallControls = (<section aria-label="Start a call" className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3><WorkHubCardTitle icon={Phone}>Start a call</WorkHubCardTitle></h3>
                {!dialOnly && panel === "log" && <button type="button" className={callToolClass + " shrink-0"} aria-label="Expand start a call panel" title="Expand start a call panel" onClick={() => setPanel("dial")}>
                  <Maximize2 className="size-5" aria-hidden="true" />
                </button>}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <CallContactPicker
                  people={people.data ?? []}
                  loading={people.isLoading}
                  value={person}
                  onChange={setPerson}
                  speedDial={settings.data?.speedDial ?? []}
                  speedDialBusy={!settings.data || change.isPending}
                  onToggleSpeedDial={saveSpeedDialContact}
                  sameCompanyFieldEmployeeLabel={user?.vendorId === MIDCON_VENDOR_ID ? "Gatekeeper" : undefined}
                />
                <WorkHubMiniCardButton disabled={!person || dial.isPending} onClick={() => dial.mutate(Number(person))}>
                  Call
                </WorkHubMiniCardButton>
              </div>
              <HubError error={dial.error} />
              {!dialOnly && panel === "dial" && <WorkHubMiniCardButton onClick={() => setPanel("log")}>Exit</WorkHubMiniCardButton>}
          </section>);
  const callsToolbar = (<div role="group" aria-label="Calls controls" className={toolbarTarget ? "flex items-center gap-1" : "flex items-center gap-1 rounded-t-xl border-b border-white/20 bg-black/10 px-4 py-1 md:px-5"}>
          {([
            ["log", "Call log", PhoneIncoming],
          ] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" className={callToolClass} aria-label={label} title={label}
              aria-pressed={panel === value} onClick={() => { setPanel(value); onActivate?.(); }}>
              <Icon className="size-5" aria-hidden="true" />
            </button>
          ))}
        </div>);
  const historyContent = <>
          {historyLoading && <p role="status">Loading call log…</p>}
          {history.length > 0 ? (
            <div className="hub-call-log-list overflow-x-auto border-y">
              <table className="w-full text-left text-sm" aria-label="Call log">
                <thead className="sr-only">
                  <tr>{["Type", "Name", "Time", "Action"].map(label => <th key={label} scope="col">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {history.map(entry => {
                    const call = entry.type === "Voicemail" ? null : entry.call;
                    const mail = entry.type === "Voicemail" ? entry.mail : null;
                    const expanded = expandedEntry?.id === entry.id;
                    const showVoicemail = expanded && selectedMail;
                    const ringing = call?.status === "ringing";
                    const callInProgress = ringing || call?.status === "active";
                    const showLiveControls = call && call.id === active?.id && callInProgress && !(call.incoming && ringing);
                    const showRecorder = call && call.id === mailCall;
                    const canLeaveVoicemail = call && !call.incoming && missedStatuses.includes(call.status);
                    const onSpeedDial = settings.data?.speedDial.includes(entry.contactId);
                    return <Fragment key={entry.id}>
                      <tr className="hub-call-log-row" data-call-ringing={ringing ? "" : undefined}>
                        <td className="w-px whitespace-nowrap px-2 py-2 font-medium sm:px-3">{entry.type}</td>
                        <td className="px-2 py-2 sm:px-3">
                          <button
                            type="button"
                            className={`${callContactTextClass} inline-flex max-w-full items-start gap-1.5`}
                            aria-description={onSpeedDial ? "On speed dial" : undefined}
                            aria-expanded={expanded}
                            aria-controls={expanded ? callDetailId : undefined}
                            onClick={() => setExpandedDetail(current => current?.entryId === entry.id ? null : { entryId: entry.id })}
                          >
                            <Star className={`mt-0.5 size-3.5 shrink-0 text-[var(--brand-primary)] ${onSpeedDial ? "fill-current" : "fill-none"}`} aria-hidden="true" />
                            <span className="min-w-0 break-words">
                              {entry.name}
                              {mail && !mail.readAt && <span className="sr-only">, new voicemail</span>}
                            </span>
                          </button>
                        </td>
                        <td className="px-2 py-2 text-xs text-muted-foreground sm:px-3">
                          <time dateTime={entry.createdAt}>{formatCallTime(entry.createdAt)}</time>
                        </td>
                        <td className="w-px px-2 py-2 text-right sm:px-3">
                          <div className="flex justify-end gap-1.5">
                            {mail && <button type="button" className={callLogIconButtonClass} title="Listen"
                              aria-label={`Listen to voicemail from ${entry.name}`} aria-expanded={expanded}
                              onClick={() => listenToVoicemail(mail)}>
                              <Play className="size-4" aria-hidden="true" />
                            </button>}
                            <button
                              type="button"
                              className={callLogIconButtonClass}
                              title="Return call"
                              aria-label={`Return call to ${entry.name}`}
                              disabled={!entry.contactId || dial.isPending || callInProgress}
                              onClick={() => dial.mutate(entry.contactId)}
                            >
                              <PhoneOutgoing className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {(expanded || showLiveControls || showRecorder) && (
                        <tr>
                          <td colSpan={4} className="px-2 sm:px-3">
                            <section
                              id={expanded ? callDetailId : undefined}
                              ref={showVoicemail ? voicemailPanel : undefined}
                              aria-label={showVoicemail ? "Selected voicemail" : undefined}
                              className="space-y-2 scroll-mt-16 rounded-xl border border-transparent p-3"
                            >
                              {showVoicemail && voicemailDetails}
                              {showLiveControls && liveCallControls}
                              {expanded && canLeaveVoicemail && (
                                <div className="flex justify-end">
                                  <WorkHubMiniCardButton className="shrink-0" onClick={() => setMailCall(call.id)}>
                                    Leave voicemail
                                  </WorkHubMiniCardButton>
                                </div>
                              )}
                              {showRecorder && (
                                <VoicemailRecorder
                                  callId={call.id}
                                  onSent={() => {
                                    setMailCall(null);
                                    setNotice("Private voicemail sent.");
                                    refresh();
                                  }}
                                />
                              )}
                              {expanded && contactHistoryList}
                            </section>
                          </td>
                        </tr>
                      )}
                    </Fragment>;
                  })}
                </tbody>
              </table>
            </div>
          ) : !historyLoading && <p className="rounded-lg border p-4 text-sm text-muted-foreground">No calls or voicemail yet.</p>}
  </>;
  if (listOnly) return <details className="hub-conversation-category">
    <summary><CommsUnreadIcon count={(voicemail.data ?? []).filter(mail => !mail.readAt).length + (calls.data ?? []).filter(call => call.incoming && ["missed","declined","busy","unavailable"].includes(call.status) && !callSeen.seen.includes(call.id)).length} label="missed calls and voicemails"><Phone className="h-4 w-4 text-[color:var(--brand-primary)]" aria-hidden="true" /></CommsUnreadIcon>Calls<span aria-label={`${history.length} call history entries`}>{history.length}</span></summary>
    <HubError error={calls.error ?? voicemail.error ?? dial.error ?? change.error} />
    {notice && <p role="status">{notice}</p>}
    {historyContent}
  </details>;
  return (
    <div className="space-y-5">
      {!embedded && <WorkHubPageHeading module="calls" title="Calls" />}
      <HubError
        error={
          calls.error ??
          voicemail.error ??
          settings.error ??
          people.error ??
          change.error ??
          (panel === "dial" ? null : dial.error)
        }
      />
      {notice && <p role="status">{notice}</p>}
      {!session?.floatingCalls && incoming.map((c) => (
        <div
          key={c.id}
          data-call-ringing=""
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary p-4"
        >
          <span>
            <PhoneIncoming className="mr-2 inline h-5 w-5" />
            {c.callerName} is calling
          </span>
          <div className="flex gap-2">
            <WorkHubMiniCardButton
              disabled={change.isPending}
              onClick={() => respond(c.id, "accept")}
            >
              Accept
            </WorkHubMiniCardButton>
            <WorkHubMiniCardButton
              disabled={change.isPending}
              onClick={() => respond(c.id, "decline")}
            >
              Decline
            </WorkHubMiniCardButton>
          </div>
        </div>
      ))}
      <section
        aria-label="Calls workspace"
        data-work-hub-card={embedded && toolbarTargetId ? undefined : true}
        className={embedded && toolbarTargetId ? "min-w-0 w-full" : WORK_HUB_CARD_CLASS}
      >
        {!dialOnly && (toolbarTarget ? createPortal(callsToolbar, toolbarTarget) : callsToolbar)}
        <div className={embedded && toolbarTargetId ? "p-3" : "p-4 md:p-5"}>
          {(dialOnly || panel === "dial") && startCallControls}
          {!dialOnly && panel === "devices" && <section aria-label={devicesTitle} className="space-y-4">
              <h3><WorkHubCardTitle icon={Laptop}>Detected audio devices</WorkHubCardTitle></h3>
              <WorkHubDeviceSettings embedded flat={Boolean(embedded && toolbarTargetId)} onExit={() => setPanel("log")} activeAudio={activeAudio} takeoverBusy={session?.audio?.connecting || session?.audio?.handoffBusy}
                onTakeOver={session ? source => session.connect(source.occurrenceId, source.deviceId, source.callId) : undefined}
                disconnecting={activeDeviceAudio?.disconnecting}
                onDisconnect={activeDeviceAudio?.joined ? () => void activeDeviceAudio.disconnect().finally(() => queryClient.invalidateQueries({ queryKey: ["work-hub", "active-audio"] })) : undefined} />
          </section>}
          {!dialOnly && panel === "log" &&
        <section
          aria-label="Call history"
          data-work-hub-card={embedded && toolbarTargetId ? undefined : true}
          className={embedded && toolbarTargetId ? "w-full min-w-0 space-y-4" : `w-full min-w-0 space-y-4 p-4 ${WORK_HUB_SUBCARD_CLASS}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <h3><WorkHubCardTitle icon={PhoneIncoming}>Call log</WorkHubCardTitle></h3>
            <button
              type="button"
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-sm border-0 bg-transparent text-sm font-medium no-underline hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50 ${available ? "text-green-500" : "text-gray-400"}`}
              disabled={!settings.data || change.isPending}
              aria-pressed={available}
              aria-label="Available for calls"
              onClick={() =>
                change.mutate({
                  path: "/calls/settings",
                  method: "PUT",
                  body: { available: !available },
                })
              }
            >
              {available && settings.data && <Check className="size-4" aria-hidden="true" />}
              {settings.data ? (available ? "Available" : "Away") : null}
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={callToolClass} aria-label="Start a call" title="Start a call">
                  <Phone className="size-5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="center" side="bottom" collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()} className="hub-start-call-flyout w-[min(23rem,calc(100vw-1.5rem))] p-3">
                {startCallControls}
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={callToolClass} aria-label={devicesTitle} title={devicesTitle}>
                  <Laptop className="size-5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()} className="hub-device-flyout w-[min(23rem,calc(100vw-1.5rem))] p-3">
                <section aria-label={devicesTitle} className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3><WorkHubCardTitle icon={Laptop}>Detected audio devices</WorkHubCardTitle></h3>
                    <button type="button" className={callToolClass + " shrink-0"} aria-label="Expand devices panel" title="Expand devices panel"
                      onClick={() => setPanel("devices")}>
                      <Maximize2 className="size-5" aria-hidden="true" />
                    </button>
                  </div>
                  <WorkHubDeviceSettings embedded flat activeAudio={activeAudio} takeoverBusy={session?.audio?.connecting || session?.audio?.handoffBusy}
                    onTakeOver={session ? source => session.connect(source.occurrenceId, source.deviceId, source.callId) : undefined}
                    disconnecting={activeDeviceAudio?.disconnecting}
                    onDisconnect={activeDeviceAudio?.joined ? () => void activeDeviceAudio.disconnect().finally(() => queryClient.invalidateQueries({ queryKey: ["work-hub", "active-audio"] })) : undefined} />
                </section>
              </PopoverContent>
            </Popover>
            </div>
          </div>
          {historyContent}
        </section>}
        </div>
      </section>
    </div>
  );
}
