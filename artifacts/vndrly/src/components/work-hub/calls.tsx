import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Voicemail,
  Star,
  X,
} from "lucide-react";
import BrandPillButton from "@/components/brand-pill-button";
import {
  PngPillButton,
  brandImagePillSrc,
} from "@/components/png-pill-rollover";
import { useBrand } from "@/hooks/use-brand";
import MeetingAudioRoom from "@/components/meeting-audio-room";
import {
  createWorkHubOperationId,
  workHubRequest,
} from "@/lib/work-hub-client";
import { HubError, PeoplePicker } from "./collaboration";
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
  senderName: string;
  durationMs: number;
  createdAt: string;
  readAt: string | null;
  transcript: string | null;
};
type Settings = { available: boolean; speedDial: number[] };
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
    <div className="space-y-3 rounded-lg border p-4">
      <p className="font-medium">Leave a private voicemail</p>
      <p className="text-sm text-muted-foreground">
        Only the recipient can play this message. Up to two minutes.
      </p>
      <HubError error={error} />
      <div className="flex flex-wrap gap-2">
        {recording ? (
          <BrandPillButton onClick={() => recorder.current?.stop()}>
            Stop recording
          </BrandPillButton>
        ) : (
          <BrandPillButton disabled={sending} onClick={() => void start()}>
            {clip ? "Record again" : "Record message"}
          </BrandPillButton>
        )}
        {clip && (
          <BrandPillButton disabled={sending} onClick={() => void send()}>
            {sending ? "Sending…" : "Send voicemail"}
          </BrandPillButton>
        )}
      </div>
      {recording && <p role="status">Recording…</p>}
    </div>
  );
}
export function WorkHubCalls() {
  const brand = useBrand();
  const queryClient = useQueryClient();
  const pendingDial = useRef<{
    recipientUserId: number;
    operationId: string;
  } | null>(null);
  const [filter, setFilter] = useState("all"),
    [person, setPerson] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [mailCall, setMailCall] = useState<string | null>(null),
    [notice, setNotice] = useState("");
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
    queryKey: ["work-hub", "call-settings"],
    queryFn: () => workHubRequest("/calls/settings"),
  });
  const people = useQuery<Array<{ id: number; displayName: string }>>({
    queryKey: ["work-hub", "call-people"],
    queryFn: () => workHubRequest("/people"),
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
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({
        queryKey: ["work-hub", "call-settings"],
      });
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
      setSelected(row.id);
      setNotice("");
      if (["busy", "unavailable"].includes(row.status)) setMailCall(row.id);
      refresh();
    },
  });
  const active = calls.data?.find((c) => c.id === selected);
  const incoming =
    calls.data?.filter((c) => c.incoming && c.status === "ringing") ?? [];
  const filtered =
    calls.data?.filter(
      (c) =>
        filter === "all" ||
        (filter === "incoming" && c.incoming) ||
        (filter === "outgoing" && !c.incoming) ||
        (filter === "missed" &&
          c.incoming &&
          ["missed", "declined", "busy", "unavailable"].includes(c.status)),
    ) ?? [];
  const orderedSpeedDial = [...(settings.data?.speedDial ?? [])].sort(
    (left, right) => {
      const latest = (contactId: number) =>
        Math.max(
          0,
          ...(calls.data ?? [])
            .filter((call) =>
              call.incoming
                ? call.callerUserId === contactId
                : call.recipientUserId === contactId,
            )
            .map((call) => new Date(call.createdAt).getTime()),
        );
      return latest(right) - latest(left);
    },
  );
  const respond = (id: string, action: string) => {
    setSelected(id);
    change.mutate({ path: `/calls/${id}/respond`, body: { action } });
  };
  const toggleSpeed = (id: number) => {
    const current = settings.data ?? { available: true, speedDial: [] };
    change.mutate({
      path: "/calls/settings",
      method: "PUT",
      body: {
        ...current,
        speedDial: current.speedDial.includes(id)
          ? current.speedDial.filter((x) => x !== id)
          : [...current.speedDial, id],
      },
    });
  };
  const brandPillSrc = brandImagePillSrc(brand.primary, brand.name);
  const available = settings.data?.available ?? true;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Phone className="h-5 w-5" /> Calls
        </h2>
      </div>
      <HubError
        error={
          calls.error ??
          voicemail.error ??
          settings.error ??
          change.error ??
          dial.error
        }
      />
      {notice && <p role="status">{notice}</p>}
      {incoming.map((c) => (
        <div
          key={c.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary bg-primary/5 p-4"
        >
          <span>
            <PhoneIncoming className="mr-2 inline h-5 w-5" />
            {c.callerName} is calling
          </span>
          <div className="flex gap-2">
            <BrandPillButton
              disabled={change.isPending}
              onClick={() => respond(c.id, "accept")}
            >
              Accept
            </BrandPillButton>
            <BrandPillButton
              disabled={change.isPending}
              onClick={() => respond(c.id, "decline")}
            >
              Decline
            </BrandPillButton>
          </div>
        </div>
      ))}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
        <aside
          aria-label="Start an internal call"
          className="w-full max-w-xs space-y-4 rounded-xl border bg-card p-4 shadow-sm"
        >
          <h3 className="font-semibold">Start an internal call</h3>
          <PngPillButton
            activeSrc={brandPillSrc}
            idleSrc={available ? brandPillSrc : undefined}
            disabled={!settings.data || change.isPending}
            aria-pressed={available}
            aria-label="Show me as available for calls"
            onClick={() =>
              change.mutate({
                path: "/calls/settings",
                method: "PUT",
                body: { ...settings.data, available: !available },
              })
            }
          >
            Show me as available for calls
          </PngPillButton>
          <div className="max-w-xs">
            <PeoplePicker value={person} onChange={setPerson} />
          </div>
          <div className="flex flex-wrap gap-2">
            <BrandPillButton
              disabled={!person || dial.isPending}
              onClick={() => dial.mutate(Number(person))}
            >
              Call
            </BrandPillButton>
            <BrandPillButton
              disabled={!person || change.isPending}
              onClick={() => toggleSpeed(Number(person))}
            >
              Toggle speed dial
            </BrandPillButton>
          </div>
          <h3 className="pt-3 font-semibold">Speed dial</h3>
          {orderedSpeedDial.map((id) => (
            <div className="flex items-center justify-between gap-2" key={id}>
              <span>
                <Star className="mr-2 inline h-4 w-4" />
                {people.data?.find((p) => p.id === id)?.displayName ??
                  "Saved contact"}
              </span>
              <div className="flex items-center gap-1">
                <BrandPillButton
                  disabled={dial.isPending}
                  onClick={() => dial.mutate(id)}
                >
                  Call
                </BrandPillButton>
                <button
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${people.data?.find((p) => p.id === id)?.displayName ?? "contact"} from speed dial`}
                  disabled={change.isPending}
                  onClick={() => toggleSpeed(id)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {!settings.data?.speedDial.length && (
            <p className="text-sm text-muted-foreground">
              Choose a contact to save here.
            </p>
          )}
        </aside>
        <section
          aria-label="Call history"
          className="w-full min-w-0 space-y-4 rounded-xl border bg-card p-4 shadow-sm"
        >
          {active && (
            <div className="space-y-3 rounded-xl border p-4">
              <p className="font-medium">
                {active.incoming ? active.callerName : active.recipientName} ·{" "}
                {active.status}
              </p>
              {active.status === "ringing" && !active.incoming && (
                <p role="status">Calling…</p>
              )}
              {active.status === "active" && (
                <MeetingAudioRoom occurrenceId={active.occurrenceId} />
              )}
              {["ringing", "active"].includes(active.status) && (
                <BrandPillButton onClick={() => respond(active.id, "end")}>
                  End call
                </BrandPillButton>
              )}
              {!active.incoming &&
                ["missed", "declined", "busy", "unavailable"].includes(
                  active.status,
                ) && (
                  <BrandPillButton onClick={() => setMailCall(active.id)}>
                    Leave voicemail
                  </BrandPillButton>
                )}
            </div>
          )}
          {mailCall && (
            <VoicemailRecorder
              key={mailCall}
              callId={mailCall}
              onSent={() => {
                setMailCall(null);
                setNotice("Private voicemail sent.");
                refresh();
              }}
            />
          )}
          <nav
            className="flex flex-wrap gap-2"
            aria-label="Call history filter"
          >
            {["all", "incoming", "outgoing", "missed", "voicemail"].map(
              (value) => (
                <PngPillButton
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  activeSrc={brandPillSrc}
                  idleSrc={filter === value ? brandPillSrc : undefined}
                  className="capitalize"
                >
                  {value}
                </PngPillButton>
              ),
            )}
          </nav>
          {calls.isLoading && <p role="status">Loading calls…</p>}
          {filter === "voicemail" ? (
            <div className="space-y-3">
              {voicemail.data?.map((mail) => (
                <article
                  key={mail.id}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <p className="font-medium">
                    <Voicemail className="mr-2 inline h-4 w-4" />
                    {mail.senderName}
                    {!mail.readAt && " · New"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(mail.createdAt).toLocaleString()} ·{" "}
                    {Math.round(mail.durationMs / 1000)} seconds
                  </p>
                  <audio
                    controls
                    preload="none"
                    src={`/api/work-hub/voicemail/${mail.id}/audio`}
                    onPlay={refresh}
                    aria-label={`Voicemail from ${mail.senderName}`}
                  />
                  {mail.transcript && (
                    <p className="whitespace-pre-wrap text-sm">
                      {mail.transcript}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {!mail.transcript && (
                      <BrandPillButton
                        disabled={change.isPending}
                        onClick={() =>
                          change.mutate({
                            path: `/voicemail/${mail.id}/transcribe`,
                            body: {},
                          })
                        }
                      >
                        Transcribe
                      </BrandPillButton>
                    )}
                    <BrandPillButton
                      disabled={change.isPending}
                      onClick={() =>
                        change.mutate({
                          path: `/voicemail/${mail.id}`,
                          method: "DELETE",
                        })
                      }
                    >
                      Delete
                    </BrandPillButton>
                  </div>
                </article>
              ))}
              {voicemail.data?.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  No voicemail.
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {filtered.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted"
                >
                  <span className="flex items-center gap-3">
                    {c.incoming ? (
                      <PhoneIncoming className="h-4 w-4" />
                    ) : (
                      <PhoneOutgoing className="h-4 w-4" />
                    )}
                    <span className="font-medium">
                      {c.incoming ? c.callerName : c.recipientName}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </span>
                  </span>
                  <span className="text-sm">{c.status}</span>
                </button>
              ))}
              {!calls.isLoading && !filtered.length && (
                <p className="p-4 text-sm text-muted-foreground">
                  No calls in this view.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
