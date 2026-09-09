import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { apiFetch } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

/** Audio stays on the existing VNDRLY signaling service and native WebRTC. */
export default function WorkHubAudioRoom({ occurrenceId }: { occurrenceId: string }) {
  const colors = useColors();
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(true);
  const [recording, setRecording] = useState(false);
  const [consented, setConsented] = useState(false);
  const [policy, setPolicy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const active = useRef(false);
  const generation = useRef(0);
  const stream = useRef<any>(null);
  const peers = useRef(new Map<number, any>());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const request = <T,>(path: string, payload?: unknown) => apiFetch<T>(`/api/work-hub/meetings/${occurrenceId}/${path}`, payload === undefined ? undefined : { method: "POST", body: JSON.stringify(payload) });
  const stop = () => {
    generation.current++;
    active.current = false;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    peers.current.forEach(peer => peer.close());
    peers.current.clear();
    stream.current?.getTracks().forEach((track: any) => track.stop());
    stream.current = null;
  };
  useEffect(() => () => { stop(); void request("leave", {}).catch(() => undefined); }, [occurrenceId]);
  const leave = () => { stop(); setJoined(false); setMuted(true); setRecording(false); void request("leave", {}).catch(e => setError(String(e.message))); };
  const join = async () => {
    setBusy(true); setError("");
    const version = ++generation.current;
    try {
      const rtc = await import("react-native-webrtc");
      const local = await rtc.mediaDevices.getUserMedia({ audio: true, video: false });
      if (generation.current !== version) { local.getTracks().forEach(track => track.stop()); return; }
      stream.current = local;
      local.getAudioTracks().forEach(track => { track.enabled = false; });
      const info = await request<{ userId: number; iceServers: any[]; recordingAllowed: boolean; policyVersion: number; consentAccepted?: boolean }>("join", {});
      if (generation.current !== version) return;
      setPolicy(info.recordingAllowed ? info.policyVersion : null); setConsented(info.consentAccepted ?? false);
      // The consenting web host captures the mixed room audio.
      active.current = true; setJoined(true);
      const pending = new Map<number, any[]>();
      let cursor = 0, polling = false;
      const signal = (toUserId: number, kind: string, payload: any) => request("signal", { toUserId, kind, payload });
      const peerFor = (id: number) => {
        if (peers.current.has(id)) return peers.current.get(id);
        const peer: any = new rtc.RTCPeerConnection({ iceServers: info.iceServers ?? [] });
        local.getTracks().forEach(track => peer.addTrack(track, local));
        peer.addEventListener("icecandidate", (event: any) => { if (event.candidate && active.current) void signal(id, "ice", event.candidate.toJSON()).catch(e => setError(e.message)); });
        peer.addEventListener("connectionstatechange", () => { if (peer.connectionState === "failed") setError("Audio connection interrupted. Leave and rejoin."); });
        peers.current.set(id, peer); return peer;
      };
      timer.current = setInterval(async () => {
        if (polling || !active.current) return;
        polling = true;
        try {
          const state = await request<{ presentUserIds: number[]; recordingState: string }>("audio-state");
          if (!active.current || generation.current !== version) return;
          setRecording(state.recordingState === "active");
          for (const [id, peer] of peers.current) if (!state.presentUserIds.includes(id)) { peer.close(); peers.current.delete(id); pending.delete(id); }
          for (const id of state.presentUserIds) {
            if (id <= info.userId || peers.current.has(id)) continue;
            const peer = peerFor(id); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await signal(id, "offer", offer);
          }
          const signals = await request<Array<{ sequence: number; fromUserId: number; kind: string; payload: any }>>(`signals?since=${cursor}`);
          if (!active.current || generation.current !== version) return;
          for (const item of signals) {
            if (!state.presentUserIds.includes(item.fromUserId)) { cursor = Math.max(cursor, item.sequence); continue; }
            const peer = peerFor(item.fromUserId);
            if (item.kind === "offer") { await peer.setRemoteDescription(new rtc.RTCSessionDescription(item.payload)); const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await signal(item.fromUserId, "answer", answer); }
            else if (item.kind === "answer") await peer.setRemoteDescription(new rtc.RTCSessionDescription(item.payload));
            else if (peer.remoteDescription) await peer.addIceCandidate(new rtc.RTCIceCandidate(item.payload));
            else pending.set(item.fromUserId, [...(pending.get(item.fromUserId) ?? []), item.payload]);
            if (peer.remoteDescription) { for (const candidate of pending.get(item.fromUserId) ?? []) await peer.addIceCandidate(new rtc.RTCIceCandidate(candidate)); pending.delete(item.fromUserId); }
            cursor = Math.max(cursor, item.sequence);
          }
        } catch (cause: any) { if (active.current) setError(cause.message ?? "Could not connect audio"); }
        finally { polling = false; }
      }, 1200);
    } catch (cause: any) { stop(); setError(cause.message ?? "Internal audio is unavailable in this build"); }
    finally { setBusy(false); }
  };
  const toggle = () => { const next = !muted; stream.current?.getAudioTracks().forEach((track: any) => { track.enabled = !next; }); setMuted(next); void request("presence", { muted: next }).catch(e => setError(e.message)); };
  const consentControl = joined && policy !== null ? <Pressable accessibilityRole="button" onPress={() => { const next = !consented; void request("consent", { policyVersion: policy, response: next ? "accepted" : "declined" }).then(() => setConsented(next)).catch(e => setError(e.message)); }}><Text style={{ color: colors.primary }}>{consented ? "Withdraw recording consent" : "Consent to host recording and transcription"}</Text></Pressable> : null;
  return <View style={{ gap: 10 }}><Text style={{ color: colors.text }}>Internal audio · {recording ? "Recording active" : "Recording off"}</Text>{!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}{consentControl}<View style={{ flexDirection: "row", gap: 20 }}><Pressable accessibilityRole="button" disabled={busy} onPress={joined ? toggle : join}><Text style={{ color: colors.primary, padding: 10 }}>{busy ? "Joining…" : joined ? muted ? "Unmute" : "Mute" : "Join audio"}</Text></Pressable>{joined && <Pressable accessibilityRole="button" onPress={leave}><Text style={{ color: colors.destructive, padding: 10 }}>Leave</Text></Pressable>}</View></View>;
}
