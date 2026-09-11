import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BrandPillButton from "@/components/brand-pill-button";
import { createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";
import { transcribeAskVRecording } from "@/lib/askv-transcribe";

type JoinResult = { roomId: string; userId: number; participants: Array<{ userId: number; role: string }>; iceServers: RTCIceServer[]; recordingAllowed: boolean; policyVersion: number; consentAccepted?: boolean };
type Signal = { id: string; sequence: number; fromUserId: number; kind: "offer" | "answer" | "ice"; payload: any; createdAt: number };

export default function MeetingAudioRoom({ occurrenceId }: { occurrenceId: string }) {
  const { t } = useTranslation();
  const [joined, setJoined] = useState<JoinResult | null>(null);
  const [muted, setMuted] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const iceServers = useRef<RTCIceServer[]>([]);
  const pendingIce = useRef(new Map<number, RTCIceCandidateInit[]>());
  const captureActive = useRef(false);
  const audioElements = useRef(new Map<number, HTMLAudioElement>());
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : t("meetingWorkspace.webAudio.operationFailed", { defaultValue: "Audio operation failed. Please retry." }));
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<number, RTCPeerConnection>());
  const remote = useRef(new Map<number, MediaStream>());
  const cursor = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const mixer = useRef<AudioContext | null>(null);
  const mixedStream = useRef<MediaStream | null>(null);
  const destination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sources = useRef(new Map<MediaStream, MediaStreamAudioSourceNode>());
  const uploads = useRef(new Set<Promise<void>>());
  const flushing = useRef(false);
  const connectRecordingStream = (stream: MediaStream) => {
    if (!mixer.current || !destination.current || sources.current.has(stream)) return;
    const source = mixer.current.createMediaStreamSource(stream);
    source.connect(destination.current); sources.current.set(stream, source);
  };
  const joinedAt = useRef(0);
  const sendSignal = (toUserId: number, kind: Signal["kind"], payload: unknown) => workHubRequest(`/meetings/${occurrenceId}/signal`, { method: "POST", body: JSON.stringify({ toUserId, kind, payload }) });
  const peerFor = (userId: number) => {
    const existing = peers.current.get(userId); if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: iceServers.current });
    local.current?.getTracks().forEach((track) => peer.addTrack(track, local.current!));
    peer.onicecandidate = (event) => { if (event.candidate) void sendSignal(userId, "ice", event.candidate.toJSON()).catch(report); };
    peer.ontrack = (event) => { const stream = event.streams[0] ?? new MediaStream([event.track]); remote.current.set(userId, stream); connectRecordingStream(stream); const audio = audioElements.current.get(userId) ?? new Audio(); audio.autoplay = true; audio.srcObject = stream; audioElements.current.set(userId, audio); void audio.play().catch(() => report(new Error(t("meetingWorkspace.webAudio.playbackBlocked", { defaultValue: "Audio playback was blocked. Use Resume audio." })))); };
    peer.onconnectionstatechange = () => { if (peer.connectionState === "failed") report(new Error(t("meetingWorkspace.webAudio.connectionFailed", { defaultValue: "Audio connection failed. Rejoin the call; restrictive networks require the VNDRLY relay." }))); };
    peers.current.set(userId, peer); return peer;
  };
  const join = async () => {
    setBusy(true); setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") throw new Error(t("meetingWorkspace.webAudio.browserRequired", { defaultValue: "Use a current browser over HTTPS for internal audio." }));
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      local.current.getAudioTracks().forEach((track) => { track.enabled = false; });
      const result = await workHubRequest<JoinResult>(`/meetings/${occurrenceId}/join`, { method: "POST", body: "{}" }); iceServers.current = result.iceServers ?? []; cursor.current = 0; setJoined(result); setConsented(result.consentAccepted ?? false);
      joinedAt.current = Date.now();
    } catch (cause) { local.current?.getTracks().forEach(track => track.stop()); local.current = null; report(cause); }
    finally { setBusy(false); }
  };
  const stopCapture = async (flush = false) => {
    flushing.current = true;
    if (!flush) captureActive.current = false;
    const media = recorder.current;
    if (media?.state === "recording") await new Promise<void>(resolve => { media.addEventListener("stop", () => resolve(), { once: true }); media.stop(); });
    if (flush) await Promise.allSettled([...uploads.current]);
    captureActive.current = false; recorder.current = null;
    sources.current.forEach(source => source.disconnect()); sources.current.clear();
    await mixer.current?.close(); mixer.current = null; destination.current = null; mixedStream.current = null;
    flushing.current = false;
  };
  const startCapture = () => {
    if (!local.current || recorder.current || flushing.current || typeof MediaRecorder === "undefined") return;
    if (!joined?.participants.some(p => p.userId === joined.userId && p.role === "host")) return;
    const context = new AudioContext(); destination.current = context.createMediaStreamDestination();
    mixer.current = context; mixedStream.current = destination.current.stream;
    for (const stream of [local.current, ...remote.current.values()]) connectRecordingStream(stream);
    void context.resume().catch(report);
    captureActive.current = true;
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
    const chunk = () => {
      if (!captureActive.current || !local.current || flushing.current) return;
      const media = new MediaRecorder(mixedStream.current!, mimeType ? { mimeType } : undefined); recorder.current = media;
      const startsAtMs = Date.now() - joinedAt.current;
      const timer = window.setTimeout(() => { if (media.state === "recording") media.stop(); }, 20_000);
      media.ondataavailable = event => {
        if (!event.data.size || !captureActive.current) return;
        const upload = (async () => {
        try {
          const id = createWorkHubOperationId();
          const endsAtMs = Date.now() - joinedAt.current;
          const audioBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(event.data); });
          await workHubRequest(`/meetings/${occurrenceId}/audio-chunks`, { method: "POST", body: JSON.stringify({ id, audioBase64, contentType: event.data.type || mimeType, startsAtMs, endsAtMs }) });
          const text = await transcribeAskVRecording(event.data);
          if (text) await workHubRequest(`/meetings/${occurrenceId}/transcript`, { method: "POST", body: JSON.stringify({ id, text, startsAtMs, endsAtMs }) });
        } catch (cause) { report(cause); }
        })();
        uploads.current.add(upload); void upload.finally(() => uploads.current.delete(upload));
      };
      media.onstop = () => { window.clearTimeout(timer); if (recorder.current === media) recorder.current = null; chunk(); };
      media.start();
    };
    chunk();
  };
  useEffect(() => {
    if (!joined) return;
    let polling = false; let cancelled = false;
    const poll = window.setInterval(async () => {
      if (polling) return; polling = true;
      try {
        const state = await workHubRequest<{ recordingState: string; presentUserIds: number[] }>(`/meetings/${occurrenceId}/audio-state`);
        if (cancelled) return;
        for (const [id, peer] of peers.current) if (!state.presentUserIds.includes(id)) { peer.close(); peers.current.delete(id); remote.current.delete(id); pendingIce.current.delete(id); const audio = audioElements.current.get(id); if (audio) { audio.pause(); audio.srcObject = null; audioElements.current.delete(id); } }
        setCapture(state.recordingState === "active");
        if (state.recordingState === "active" && consented) startCapture(); else stopCapture();
        for (const id of state.presentUserIds) {
          if (id === joined.userId || peers.current.has(id) || id < joined.userId) continue;
          const peer = peerFor(id); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await sendSignal(id, "offer", offer);
        }
        const signals = await workHubRequest<Signal[]>(`/meetings/${occurrenceId}/signals?since=${cursor.current}`);
        if (cancelled) return;
        for (const signal of signals) {
          if (!state.presentUserIds.includes(signal.fromUserId)) { cursor.current = signal.sequence; continue; }
          const peer = peerFor(signal.fromUserId);
          if (signal.kind === "offer") { await peer.setRemoteDescription(signal.payload); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await sendSignal(signal.fromUserId, "answer", answer); }
          else if (signal.kind === "answer") await peer.setRemoteDescription(signal.payload);
          else if (signal.kind === "ice") { if (peer.remoteDescription) await peer.addIceCandidate(signal.payload); else pendingIce.current.set(signal.fromUserId, [...(pendingIce.current.get(signal.fromUserId) ?? []), signal.payload]); }
          if (peer.remoteDescription) { for (const ice of pendingIce.current.get(signal.fromUserId) ?? []) await peer.addIceCandidate(ice); pendingIce.current.delete(signal.fromUserId); }
          cursor.current = Math.max(cursor.current, signal.sequence);
        }
      } catch (cause) { report(cause); } finally { polling = false; }
    }, 1200);
    return () => { cancelled = true; window.clearInterval(poll); };
  }, [joined, occurrenceId, consented]);
  useEffect(() => () => { stopCapture(); peers.current.forEach((peer) => peer.close()); audioElements.current.forEach(audio => { audio.pause(); audio.srcObject = null; }); local.current?.getTracks().forEach((track) => track.stop()); void workHubRequest(`/meetings/${occurrenceId}/leave`, { method: "POST", body: "{}", keepalive: true }).catch(() => undefined); }, [occurrenceId]);
  const leave = async () => { await stopCapture(true); peers.current.forEach((peer) => peer.close()); peers.current.clear(); audioElements.current.forEach(audio => { audio.pause(); audio.srcObject = null; }); audioElements.current.clear(); local.current?.getTracks().forEach((track) => track.stop()); local.current = null; setJoined(null); setMuted(true); setCapture(false); void workHubRequest(`/meetings/${occurrenceId}/leave`, { method: "POST", body: "{}" }).catch(report); };
  const toggleMute = () => { const next = !muted; local.current?.getAudioTracks().forEach((track) => { track.enabled = !next; }); setMuted(next); void workHubRequest(`/meetings/${occurrenceId}/presence`, { method: "POST", body: JSON.stringify({ muted: next }) }).catch(report); };
  const toggleHand = () => { const next = !handRaised; setHandRaised(next); void workHubRequest(`/meetings/${occurrenceId}/presence`, { method: "POST", body: JSON.stringify({ handRaised: next }) }).catch(report); };
  return <section aria-label={t("meetingWorkspace.webAudio.region", { defaultValue: "Meeting audio controls" })} className="rounded-lg border p-4"><p className="mb-3 text-sm">{t("meetingWorkspace.webAudio.description", { defaultValue: "VNDRLY internal audio · invited participants only" })}</p><p role="status" className="mb-3 text-sm">{capture ? t("meetingWorkspace.webAudio.active", { defaultValue: "Recording and transcription are active." }) : t("meetingWorkspace.webAudio.off", { defaultValue: "Recording and transcription are off." })}</p>{error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}{!joined ? <BrandPillButton tone="green" disabled={busy} onClick={() => void join()}>{busy ? t("meetingWorkspace.webAudio.joining", { defaultValue: "Joining…" }) : t("meetingWorkspace.webAudio.join", { defaultValue: "Join audio" })}</BrandPillButton> : <div className="flex flex-wrap gap-2"><BrandPillButton tone={muted ? "brand" : "green"} onClick={toggleMute}>{muted ? t("meetingWorkspace.webAudio.unmute", { defaultValue: "Unmute" }) : t("meetingWorkspace.webAudio.mute", { defaultValue: "Mute" })}</BrandPillButton><BrandPillButton tone={handRaised ? "amber" : "brand"} onClick={toggleHand}>{handRaised ? t("meetingWorkspace.webAudio.lowerHand", { defaultValue: "Lower hand" }) : t("meetingWorkspace.webAudio.raiseHand", { defaultValue: "Raise hand" })}</BrandPillButton><BrandPillButton tone="brand" onClick={() => audioElements.current.forEach(audio => void audio.play().catch(report))}>{t("meetingWorkspace.webAudio.resume", { defaultValue: "Resume audio" })}</BrandPillButton>{joined.recordingAllowed && <BrandPillButton tone={consented ? "green" : "brand"} onClick={() => { const next = !consented; if (!next) stopCapture(); void workHubRequest(`/meetings/${occurrenceId}/consent`, { method: "POST", body: JSON.stringify({ policyVersion: joined.policyVersion, response: next ? "accepted" : "declined" }) }).then(() => setConsented(next)).catch(report); }}>{consented ? t("meetingWorkspace.webAudio.withdraw", { defaultValue: "Withdraw recording consent" }) : t("meetingWorkspace.webAudio.consent", { defaultValue: "Consent to recording" })}</BrandPillButton>}{joined.recordingAllowed && joined.participants.some(x => x.userId === joined.userId && x.role === "host") && <BrandPillButton tone={capture ? "red" : "brand"} disabled={busy} onClick={() => { setBusy(true); void (async () => { if (capture) await stopCapture(true); await workHubRequest(`/meetings/${occurrenceId}/recording`, { method: "POST", body: JSON.stringify({ enabled: !capture }) }); setCapture(!capture); })().catch(report).finally(() => setBusy(false)); }}>{capture ? t("meetingWorkspace.webAudio.stop", { defaultValue: "Stop recording" }) : t("meetingWorkspace.webAudio.start", { defaultValue: "Start recording" })}</BrandPillButton>}<BrandPillButton tone="red" onClick={leave}>{t("meetingWorkspace.webAudio.leave", { defaultValue: "Leave" })}</BrandPillButton></div>}</section>;
}
