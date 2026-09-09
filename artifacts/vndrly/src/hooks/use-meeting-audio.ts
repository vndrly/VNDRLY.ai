import { useCallback, useEffect, useRef, useState } from "react";
import { workHubRequest } from "@/lib/work-hub-client";
import type { MeetingSnapshot } from "@/lib/meeting-types";

type Join = { userId: number; startedAt: string; iceServers: RTCIceServer[] };
type Signal = { sequence: number; fromUserId: number; kind: "offer" | "answer" | "ice"; payload: RTCSessionDescriptionInit & RTCIceCandidateInit };
type Peer = { connection: RTCPeerConnection; audio: HTMLAudioElement; pendingIce: RTCIceCandidateInit[]; generation?: number };

export function useMeetingAudio(occurrenceId: string, snapshot: MeetingSnapshot | undefined) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  const peers = useRef(new Map<number, Peer>());
  const stream = useRef<MediaStream | null>(null);
  const analyser = useRef<{ context: AudioContext; node: AnalyserNode } | null>(null);
  const lease = useRef<Join | null>(null);
  const state = useRef(snapshot); state.current = snapshot;
  const mutedRef = useRef(true);
  const cursor = useRef(0);
  const alive = useRef(true);
  const joining = useRef(false);
  const closePeer = (id: number) => {
    const peer = peers.current.get(id); if (!peer) return;
    peer.connection.close(); peer.audio.pause(); peer.audio.srcObject = null; peers.current.delete(id);
  };
  const cleanup = useCallback(() => {
    lease.current = null;
    peers.current.forEach((_, id) => closePeer(id));
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
    void analyser.current?.context.close(); analyser.current = null;
    mutedRef.current = true;
  }, []);
  const leave = useCallback(async () => {
    cleanup(); setJoined(false); setMuted(true);
    try { await workHubRequest(`/meetings/${occurrenceId}/leave`, { method: "POST", body: "{}", keepalive: true }); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "The connection closed."); }
  }, [cleanup, occurrenceId]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const wasJoined = Boolean(lease.current); cleanup();
      if (wasJoined) void workHubRequest(`/meetings/${occurrenceId}/leave`, { method: "POST", body: "{}", keepalive: true }).catch(() => undefined);
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
      const result = await workHubRequest<Join>(`/meetings/${occurrenceId}/join`, { method: "POST", body: "{}" });
      if (!alive.current) { cleanup(); await workHubRequest(`/meetings/${occurrenceId}/leave`, { method: "POST", body: "{}", keepalive: true }); return; }
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
    const sendSignal = (id: number, kind: Signal["kind"], payload: unknown) => workHubRequest(`/meetings/${occurrenceId}/signal`, { method: "POST", body: JSON.stringify({ toUserId: id, kind, payload }) });
    function peerFor(id: number) {
      const existing = peers.current.get(id); if (existing) return existing;
      const connection = new RTCPeerConnection({ iceServers: lease.current?.iceServers ?? [] });
      const audio = new Audio(); audio.autoplay = true;
      const peer: Peer = { connection, audio, pendingIce: [], generation: state.current?.participants.find((p) => p.userId === id)?.joinedAt };
      peers.current.set(id, peer);
      stream.current?.getTracks().forEach((track) => connection.addTrack(track, stream.current!));
      connection.onicecandidate = (event) => { if (event.candidate && !stopped) void sendSignal(id, "ice", event.candidate.toJSON()).catch(() => undefined); };
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
        await workHubRequest(`/meetings/${occurrenceId}/presence`, { method: "POST", body: JSON.stringify({ muted: mutedRef.current, speaking }) });
        if (stopped) return;
        const others = data?.participants.filter((p) => p.present && !p.removedAt && p.userId !== lease.current?.userId) ?? [];
        for (const [id, peer] of peers.current) {
          const person = others.find((p) => p.userId === id);
          if (!person || person.joinedAt !== peer.generation) closePeer(id);
        }
        for (const person of others) {
          if (!peers.current.has(person.userId) && lease.current!.userId < person.userId) {
            const { connection } = peerFor(person.userId);
            const offer = await connection.createOffer(); await connection.setLocalDescription(offer);
            await sendSignal(person.userId, "offer", offer);
          }
        }
        const result = await workHubRequest<{ sequence: number; signals: Signal[] }>(`/meetings/${occurrenceId}/signals?after=${cursor.current}`);
        if (stopped) return;
        let deferred = false;
        for (const signal of result.signals) {
          if (!others.some((p) => p.userId === signal.fromUserId)) { deferred = true; break; }
          const peer = peerFor(signal.fromUserId);
          if (signal.kind === "ice") {
            if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(signal.payload);
            else peer.pendingIce.push(signal.payload);
          } else {
            await peer.connection.setRemoteDescription(signal.payload);
            for (const candidate of peer.pendingIce.splice(0)) await peer.connection.addIceCandidate(candidate);
            if (signal.kind === "offer") {
              const answer = await peer.connection.createAnswer(); await peer.connection.setLocalDescription(answer);
              await sendSignal(signal.fromUserId, "answer", answer);
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
    stream.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    if (!next) await analyser.current?.context.resume();
    try { await workHubRequest(`/meetings/${occurrenceId}/presence`, { method: "POST", body: JSON.stringify({ muted: next }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update microphone."); }
  };
  const enablePlayback = async () => {
    const results = await Promise.allSettled([...peers.current.values()].map((p) => p.audio.play()));
    setNeedsPlayback(results.some((r) => r.status === "rejected"));
  };
  return { joined, muted, join, leave, toggleMute, error, needsPlayback, enablePlayback, stream };
}
