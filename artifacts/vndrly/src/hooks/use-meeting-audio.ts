import { useCallback, useEffect, useRef, useState } from "react";
import { createWorkHubOperationId, workHubRequest } from "@/lib/work-hub-client";
import type { MeetingSnapshot } from "@/lib/meeting-types";
import { useMeetingTranscription } from "./use-meeting-transcription";

type MeetingPeer = { userId: number; deviceId: string; connectionId: string };
type MeetingIdentity = { deviceId: string; connectionId: string };
type Join = MeetingIdentity & { userId: number; startedAt: string; iceServers: RTCIceServer[]; peerConnections: MeetingPeer[] };
type Signal = { sequence: number; fromUserId: number; fromDeviceId?: string; kind: "offer" | "answer" | "ice"; payload: RTCSessionDescriptionInit & RTCIceCandidateInit };
type Peer = { userId: number; connection: RTCPeerConnection; audio: HTMLAudioElement; pendingIce: RTCIceCandidateInit[] };

const DEVICE_STORAGE_KEY = "vndrly.workHubDeviceId";
function browserDeviceId() {
  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) return existing;
  const created = createWorkHubOperationId(); window.localStorage.setItem(DEVICE_STORAGE_KEY, created); return created;
}

export function useMeetingAudio(occurrenceId: string, snapshot: MeetingSnapshot | undefined) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  const peers = useRef(new Map<string, Peer>());
  const stream = useRef<MediaStream | null>(null);
  const transcription = useMeetingTranscription(occurrenceId, snapshot, joined, muted, stream);
  const { stopTranscription } = transcription;
  const analyser = useRef<{ context: AudioContext; node: AnalyserNode } | null>(null);
  const lease = useRef<Join | null>(null);
  const state = useRef(snapshot); state.current = snapshot;
  const mutedRef = useRef(true);
  const cursor = useRef(0);
  const alive = useRef(true);
  const joining = useRef(false);
  const identity = useRef<MeetingIdentity>({ deviceId: browserDeviceId(), connectionId: createWorkHubOperationId() });
  const lastDeviceHeartbeat = useRef(0);
  const closePeer = (id: string) => {
    const peer = peers.current.get(id); if (!peer) return;
    peer.connection.close(); peer.audio.pause(); peer.audio.srcObject = null; peers.current.delete(id);
  };
  const cleanup = useCallback(() => {
    stopTranscription();
    lease.current = null;
    peers.current.forEach((_, id) => closePeer(id));
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
    void analyser.current?.context.close(); analyser.current = null;
    mutedRef.current = true;
  }, [stopTranscription]);
  const leave = useCallback(async () => {
    cleanup(); setJoined(false); setMuted(true);
    try { await workHubRequest(`/meetings/${occurrenceId}/leave`, { method: "POST", body: JSON.stringify(identity.current), keepalive: true }); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "The connection closed."); }
  }, [cleanup, occurrenceId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const wasJoined = Boolean(lease.current); cleanup();
      if (wasJoined) void workHubRequest(`/meetings/${occurrenceId}/leave`, { method: "POST", body: JSON.stringify(identity.current), keepalive: true }).catch(() => undefined);
    };
  }, [cleanup, occurrenceId]);

  const join = async () => {
    if (joining.current || lease.current) return;
    joining.current = true; setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access requires a secure connection and a supported browser.");
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!alive.current) { input.getTracks().forEach((track) => track.stop()); return; }
      stream.current = input; input.getAudioTracks().forEach((track) => { track.enabled = false; });
      await workHubRequest("/devices/register", { method: "POST", body: JSON.stringify({ deviceId: identity.current.deviceId, friendlyName: navigator.platform || "Web browser", deviceClass: /Mobi|Android/i.test(navigator.userAgent) ? "phone" : "desktop", capabilities: { microphone: true, speaker: true, fileSelection: true } }) });
      await workHubRequest(`/devices/${identity.current.deviceId}/heartbeat`, { method: "POST", body: JSON.stringify({ connectionId: identity.current.connectionId, foreground: document.visibilityState === "visible", microphonePermission: "granted", surface: { path: window.location.pathname, entityType: "meeting", entityId: occurrenceId, updatedAt: Date.now() } }) });
      lastDeviceHeartbeat.current = Date.now();
      const result = await workHubRequest<Join>(`/meetings/${occurrenceId}/join`, { method: "POST", body: JSON.stringify(identity.current) });
      if (!alive.current) { cleanup(); await workHubRequest(`/meetings/${occurrenceId}/leave`, { method: "POST", body: JSON.stringify(identity.current), keepalive: true }); return; }
      const context = new AudioContext(); const node = context.createAnalyser(); node.fftSize = 256;
      context.createMediaStreamSource(input).connect(node); analyser.current = { context, node };
      lease.current = result; cursor.current = 0; setMuted(true); mutedRef.current = true; setJoined(true);
    } catch (cause) { cleanup(); if (alive.current) setError(cause instanceof Error ? cause.message : "Audio could not connect."); }
    finally { joining.current = false; }
  };

  useEffect(() => {
    if (!joined) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sendSignal = (peer: MeetingPeer, kind: Signal["kind"], payload: unknown) => workHubRequest(`/meetings/${occurrenceId}/signal`, { method: "POST", body: JSON.stringify({ ...identity.current, toUserId: peer.userId, toDeviceId: peer.connectionId, kind, payload }) });
    function peerFor(target: MeetingPeer) {
      const existing = peers.current.get(target.connectionId); if (existing) return existing;
      const connection = new RTCPeerConnection({ iceServers: lease.current?.iceServers ?? [] });
      const audio = new Audio(); audio.autoplay = true;
      const peer: Peer = { userId: target.userId, connection, audio, pendingIce: [] };
      peers.current.set(target.connectionId, peer);
      stream.current?.getTracks().forEach((track) => connection.addTrack(track, stream.current!));
      connection.onicecandidate = (event) => { if (event.candidate && !stopped) void sendSignal(target, "ice", event.candidate.toJSON()).catch(() => undefined); };
      connection.ontrack = (event) => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => { if (!stopped) setNeedsPlayback(true); });
      };
      return peer;
    }
    async function poll() {
      try {
        if (!lease.current || stopped) return;
        const data = state.current;
        if (data?.occurrence.status === "ended" || data?.participants.find((p) => p.userId === lease.current!.userId)?.removedAt) {
          await leave(); return;
        }
        const samples = new Uint8Array(128); analyser.current?.node.getByteTimeDomainData(samples);
        const speaking = Boolean(analyser.current && !mutedRef.current && samples.some((value) => Math.abs(value - 128) > 8));
        if (Date.now() - lastDeviceHeartbeat.current > 15_000) {
          await workHubRequest(`/devices/${identity.current.deviceId}/heartbeat`, { method: "POST", body: JSON.stringify({ connectionId: identity.current.connectionId, foreground: document.visibilityState === "visible", microphonePermission: "granted", surface: { path: window.location.pathname, entityType: "meeting", entityId: occurrenceId, updatedAt: Date.now() } }) });
          lastDeviceHeartbeat.current = Date.now();
        }
        await workHubRequest(`/meetings/${occurrenceId}/presence`, { method: "POST", body: JSON.stringify({ ...identity.current, muted: mutedRef.current, speaking }) });
        if (stopped) return;
        const audioState = await workHubRequest<{ presentUserIds: number[]; peerConnections: MeetingPeer[]; recordingState: string }>(`/meetings/${occurrenceId}/audio-state?deviceId=${identity.current.deviceId}&connectionId=${identity.current.connectionId}`);
        const others = audioState.peerConnections ?? lease.current.peerConnections ?? [];
        for (const id of peers.current.keys()) if (!others.some(person => person.connectionId === id)) closePeer(id);
        for (const person of others) {
          if (!peers.current.has(person.connectionId) && identity.current.connectionId < person.connectionId) {
            const { connection } = peerFor(person);
            const offer = await connection.createOffer(); await connection.setLocalDescription(offer);
            await sendSignal(person, "offer", offer);
          }
        }
        const result = await workHubRequest<{ sequence: number; signals: Signal[] }>(`/meetings/${occurrenceId}/signals?after=${cursor.current}&deviceId=${identity.current.deviceId}&connectionId=${identity.current.connectionId}`);
        if (stopped) return;
        let deferred = false;
        for (const signal of result.signals) {
          const source = others.find((p) => p.connectionId === signal.fromDeviceId) ?? others.find((p) => p.userId === signal.fromUserId);
          if (!source) { deferred = true; break; }
          const peer = peerFor(source);
          if (signal.kind === "ice") {
            if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(signal.payload);
            else peer.pendingIce.push(signal.payload);
          } else {
            await peer.connection.setRemoteDescription(signal.payload);
            for (const candidate of peer.pendingIce.splice(0)) await peer.connection.addIceCandidate(candidate);
            if (signal.kind === "offer") {
              const answer = await peer.connection.createAnswer(); await peer.connection.setLocalDescription(answer);
              await sendSignal(source, "answer", answer);
            }
          }
          cursor.current = signal.sequence;
        }
        if (!deferred) cursor.current = result.sequence;
        setError(null);
      } catch (cause) {
        if (!stopped) {
          const message = cause instanceof Error ? cause.message : "Audio is reconnecting.";
          setError(message);
          if (/no longer have access|meeting has ended/i.test(message)) { cleanup(); setJoined(false); setMuted(true); return; }
        }
      } finally { if (!stopped && lease.current) timer = setTimeout(() => void poll(), 1200); }
    }
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [joined, occurrenceId, cleanup, leave]);

  const toggleMute = async () => {
    const next = !mutedRef.current; mutedRef.current = next; setMuted(next);
    if (next) stopTranscription();
    stream.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    if (!next) await analyser.current?.context.resume();
    try { await workHubRequest(`/meetings/${occurrenceId}/presence`, { method: "POST", body: JSON.stringify({ ...identity.current, muted: next }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update microphone."); }
  };
  const enablePlayback = async () => {
    const results = await Promise.allSettled([...peers.current.values()].map((p) => p.audio.play()));
    setNeedsPlayback(results.some((r) => r.status === "rejected"));
  };
  return { joined, muted, join, leave, toggleMute, error, needsPlayback, enablePlayback, stream, ...transcription };
}
