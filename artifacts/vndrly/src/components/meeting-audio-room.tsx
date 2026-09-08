import { useEffect, useRef, useState } from "react";
import BrandPillButton from "@/components/brand-pill-button";
import { workHubRequest } from "@/lib/work-hub-client";
import { transcribeAskVRecording } from "@/lib/askv-transcribe";

type JoinResult = { roomId: string; userId: number; participants: Array<{ userId: number; role: string }> };
type Signal = { id: string; fromUserId: number; kind: "offer" | "answer" | "ice"; payload: any; createdAt: number };

export default function MeetingAudioRoom({ occurrenceId }: { occurrenceId: string }) {
  const [joined, setJoined] = useState<JoinResult | null>(null);
  const [muted, setMuted] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<number, RTCPeerConnection>());
  const remote = useRef(new Map<number, MediaStream>());
  const cursor = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const joinedAt = useRef(0);
  const sendSignal = (toUserId: number, kind: Signal["kind"], payload: unknown) => workHubRequest(`/meetings/${occurrenceId}/signal`, { method: "POST", body: JSON.stringify({ toUserId, kind, payload }) });
  const peerFor = (userId: number) => {
    const existing = peers.current.get(userId); if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    local.current?.getTracks().forEach((track) => peer.addTrack(track, local.current!));
    peer.onicecandidate = (event) => { if (event.candidate) void sendSignal(userId, "ice", event.candidate.toJSON()); };
    peer.ontrack = (event) => { remote.current.set(userId, event.streams[0]); const audio = document.getElementById(`meeting-audio-${userId}`) as HTMLAudioElement | null; if (audio) audio.srcObject = event.streams[0]; };
    peers.current.set(userId, peer); return peer;
  };
  const join = async () => {
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      local.current.getAudioTracks().forEach((track) => { track.enabled = false; });
      const result = await workHubRequest<JoinResult>(`/meetings/${occurrenceId}/join`, { method: "POST", body: "{}" }); setJoined(result);
      joinedAt.current = Date.now();
      if (typeof MediaRecorder !== "undefined") {
        const mediaRecorder = new MediaRecorder(local.current);
        mediaRecorder.ondataavailable = async (event) => {
          if (!event.data.size) return;
          try {
            const text = await transcribeAskVRecording(event.data); if (!text) return;
            const endsAtMs = Date.now() - joinedAt.current;
            await workHubRequest(`/meetings/${occurrenceId}/transcript`, { method: "POST", body: JSON.stringify({ text, startsAtMs: Math.max(0, endsAtMs - 20_000), endsAtMs }) });
          } catch { /* the next segment can still be transcribed */ }
        };
        mediaRecorder.start(20_000); recorder.current = mediaRecorder;
      }
      for (const participant of result.participants.filter((item) => item.userId !== result.userId && result.userId < item.userId)) {
        const peer = peerFor(participant.userId); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await sendSignal(participant.userId, "offer", offer);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The audio room could not open."); }
  };
  useEffect(() => {
    if (!joined) return;
    const poll = window.setInterval(async () => {
      try {
        const signals = await workHubRequest<Signal[]>(`/meetings/${occurrenceId}/signals?since=${cursor.current}`);
        for (const signal of signals) {
          cursor.current = Math.max(cursor.current, signal.createdAt); const peer = peerFor(signal.fromUserId);
          if (signal.kind === "offer") { await peer.setRemoteDescription(signal.payload); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await sendSignal(signal.fromUserId, "answer", answer); }
          else if (signal.kind === "answer") await peer.setRemoteDescription(signal.payload);
          else if (signal.kind === "ice") await peer.addIceCandidate(signal.payload);
        }
      } catch { /* retry on the next short poll */ }
    }, 1200);
    return () => window.clearInterval(poll);
  }, [joined, occurrenceId]);
  useEffect(() => () => { peers.current.forEach((peer) => peer.close()); if (recorder.current?.state === "recording") recorder.current.stop(); local.current?.getTracks().forEach((track) => track.stop()); }, []);
  const leave = () => { peers.current.forEach((peer) => peer.close()); peers.current.clear(); if (recorder.current?.state === "recording") recorder.current.stop(); recorder.current = null; local.current?.getTracks().forEach((track) => track.stop()); local.current = null; setJoined(null); setMuted(true); };
  const toggleMute = () => { const next = !muted; local.current?.getAudioTracks().forEach((track) => { track.enabled = !next; }); setMuted(next); void workHubRequest(`/meetings/${occurrenceId}/presence`, { method: "POST", body: JSON.stringify({ muted: next }) }); };
  const toggleHand = () => { const next = !handRaised; setHandRaised(next); void workHubRequest(`/meetings/${occurrenceId}/presence`, { method: "POST", body: JSON.stringify({ handRaised: next }) }); };
  return <section className="rounded-lg border p-4"><p className="mb-3 text-sm">VNDRLY secure audio · invited participants only · transcription is active and visible to invitees.</p>{error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}{!joined ? <BrandPillButton tone="green" onClick={() => void join()}>Join audio</BrandPillButton> : <div className="flex flex-wrap gap-2"><BrandPillButton tone={muted ? "brand" : "green"} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</BrandPillButton><BrandPillButton tone={handRaised ? "amber" : "brand"} onClick={toggleHand}>{handRaised ? "Lower hand" : "Raise hand"}</BrandPillButton><BrandPillButton tone="red" onClick={leave}>Leave</BrandPillButton>{joined.participants.filter((participant) => participant.userId !== joined.userId).map((participant) => <audio key={participant.userId} id={`meeting-audio-${participant.userId}`} autoPlay />)}</div>}</section>;
}
