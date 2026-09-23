import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { askVMicrophone } from "@workspace/askv-wake";
import type { MediaStream, RTCPeerConnection } from "react-native-webrtc";
import { apiFetch } from "@/lib/api";
import { getCachedToken, getToken, subscribeToken, subscribeUser } from "@/lib/auth";
import { isAskVAppActive, requestAskVMicrophonePermission, subscribeAskVAppState } from "@/lib/askv-audio-session";
import { useColors } from "@/hooks/useColors";
import { createNativeMeetingAudioSession, type NativeMeetingAudioSession } from "@/lib/native-meeting-audio";
import { getDeviceId } from "@/lib/deviceId";
import { workHubDeviceClass, workHubDeviceLabel } from "@/lib/work-hub-device-label";

type Session = {
  valid: boolean;
  token: string | null | undefined;
  stop: (message?: string, notifyLeave?: boolean) => void;
  toggle: () => void;
  forceMute: () => void;
  consent: () => void;
  moveAudio: () => void;
  cancelFailover: () => void;
};
type MeetingPeer = { userId: number; deviceId: string; connectionId: string };
type MeetingIdentity = { deviceId: string; connectionId: string };
type JoinInfo = MeetingIdentity & { userId: number; iceServers: any[]; recordingAllowed: boolean; policyVersion: number; consentAccepted?: boolean; peerConnections?: MeetingPeer[] };
type Signal = { sequence: number; fromUserId: number; fromDeviceId?: string; kind: string; payload: any };
type ServerAudioLease = { token: string; generation: number; expiresAt: string };
type ServerAudioState = { deviceId: string; generation: number; active: boolean; expiresAt: string; pendingDeviceId: string | null };
// The installed package's EventTarget declaration omits these inherited APIs.
type NativeEvents = {
  addEventListener: (name: string, listener: (event: any) => void) => void;
  removeEventListener: (name: string, listener: (event: any) => void) => void;
};
const cancelled = () => Object.assign(new Error("Audio session stopped"), { name: "AbortError" });
function newConnectionId() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map(value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

/** Audio stays on the existing VNDRLY signaling service and native WebRTC. */
export default function WorkHubAudioRoom({ occurrenceId, hostMuted = false, hostMuteGeneration = 0 }: { occurrenceId: string; hostMuted?: boolean; hostMuteGeneration?: number }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(true);
  const [recording, setRecording] = useState(false);
  const [consented, setConsented] = useState(false);
  const [policy, setPolicy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [audioOnAnotherDevice, setAudioOnAnotherDevice] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [failoverCountdown, setFailoverCountdown] = useState<number | null>(null);
  const current = useRef<Session | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const leaving = useRef<AbortController | null>(null);
  const pollingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mounted.current = true;
    const stopForAuth = () => {
      leaving.current?.abort();
      current.current?.stop(t("meetingWorkspace.audio.accountChanged"));
    };
    const unsubscribeToken = subscribeToken(token => {
      const session = current.current;
      // getToken may publish the first cached token before startup captures.
      if (session && session.token === undefined && token) session.token = token;
      else if (session && session.token !== token) stopForAuth();
      else if (!session) leaving.current?.abort();
    });
    const unsubscribeUser = subscribeUser(user => { if (!user) stopForAuth(); });
    const appState = subscribeAskVAppState(() => {}, () => current.current?.stop(t("meetingWorkspace.audio.appInactive")));
    return () => {
      current.current?.stop(undefined, true);
      if (pollingTimer.current !== null) clearInterval(pollingTimer.current);
      pollingTimer.current = null;
      generation.current++;
      mounted.current = false;
      unsubscribeToken(); unsubscribeUser(); appState.remove();
    };
  }, [occurrenceId, t]);

  const join = async () => {
    // The ref closes the gap before React renders disabled={busy}.
    if (current.current || !mounted.current) return;
    if (!isAskVAppActive()) { setError(t("meetingWorkspace.audio.openApp")); return; }
    leaving.current?.abort();
    const version = ++generation.current;
    setBusy(true); setError(""); setMuted(true); setConsented(false); setPolicy(null);
    const controller = new AbortController();
    const peers = new Map<number, RTCPeerConnection>();
    const nativePeers = new Map<number, string>();
    const pendingIce = new Map<number, any[]>();
    let local: MediaStream | null = null;
    let native: NativeMeetingAudioSession | null = null;
    let capturePending: Promise<void> | null = null;
    let cleanup: Promise<void> | null = null;
    let releaseLease: (() => Promise<void>) | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let joinedServer = false, localMuted = true, presencePending = false, consentPending = false;
    let accepted = false, recordingPolicy: number | null = null, recordingActive = false;
    let identity: MeetingIdentity | null = null, lastDeviceHeartbeat = 0, lastAudioLeaseRenewal = 0;
    let serverAudioLease: ServerAudioLease | null = null;
    let failoverDeadline: { generation: number; at: number } | null = null;
    let cancelledFailoverGeneration: number | null = null;
    let failoverStarting = false;
    let failoverAttempt = 0;
    const peerConnectionByUser = new Map<number, MeetingPeer>();
    let nativeTranscribing = false, nativeTranscriptionPending = false;
    const trackListeners: Array<() => void> = [];
    const session: Session = { valid: true, token: getCachedToken() ?? undefined, stop: () => {}, toggle: () => {}, forceMute: () => {}, consent: () => {}, moveAudio: () => {}, cancelFailover: () => {} };
    current.current = session;
    const live = () => session.valid && current.current === session && mounted.current;
    const check = () => { if (!live()) throw cancelled(); };
    const disposeLocal = () => {
      const failures: unknown[] = [];
      trackListeners.splice(0).forEach(remove => { try { remove(); } catch (cause) { failures.push(cause); } });
      const stream = local; local = null;
      if (stream) {
        for (const track of stream.getTracks()) {
          try { track.enabled = false; } catch (cause) { failures.push(cause); }
          try { track.stop(); } catch (cause) { failures.push(cause); }
        }
        try { stream.release(); } catch (cause) { failures.push(cause); }
      }
      if (failures.length) throw failures[0];
    };
    async function releaseServerAudio() {
      const owned = serverAudioLease; serverAudioLease = null;
      if (!owned || !identity || session.token !== getCachedToken()) return;
      await apiFetch(`/api/work-hub/meetings/${occurrenceId}/audio-lease`, { method: "DELETE", body: JSON.stringify({ ...identity, token: owned.token, generation: owned.generation }) }).catch(() => undefined);
    }
    // Called INSIDE the coordinator's serialized handoff. Never wait for the
    // lease release (or all of join, which may itself be waiting for a lease).
    // Only actual native acquisition can still produce a microphone to clean up.
    const stopOwned = (message?: string): Promise<void> => {
      if (cleanup) return cleanup;
      session.valid = false;
      const failures: unknown[] = [];
      local?.getTracks().forEach(track => { try { track.enabled = false; } catch (cause) { failures.push(cause); } });
      void releaseServerAudio();
      controller.abort();
      if (interval !== null) clearInterval(interval);
      if (pollingTimer.current === interval) pollingTimer.current = null;
      interval = null;
      if (current.current === session) {
        current.current = null;
        if (mounted.current) {
          setJoined(false); setBusy(false); setMuted(true); setRecording(false); setConsented(false); setPolicy(null); setAudioOnAnotherDevice(false); setHandoffBusy(false); setFailoverCountdown(null);
          if (message) setError(message);
        }
      }
      for (const peer of peers.values()) { try { peer.close(); } catch (cause) { failures.push(cause); } }
      peers.clear(); pendingIce.clear();
      nativePeers.clear();
      const ownedNative = native; native = null;
      const nativeCleanup = ownedNative?.stop().catch(cause => { failures.push(cause); });
      try { disposeLocal(); } catch (cause) { failures.push(cause); }
      cleanup = (async () => {
        await Promise.all([capturePending, nativeCleanup]);
        if (failures.length) throw failures[0];
      })();
      return cleanup;
    };
    const release = () => {
      const ownedRelease = releaseLease; releaseLease = null;
      return ownedRelease?.();
    };
    session.stop = (message, notifyLeave = false) => {
      const shouldLeave = session.valid && joinedServer && notifyLeave && session.token === getCachedToken();
      const stopped = stopOwned(message);
      // Cleanup failure must block handoff; the coordinator retains its owner.
      void stopped.then(release).catch(() => {
        if (mounted.current && generation.current === version) setError(t("meetingWorkspace.audio.releaseFailed"));
      });
      if (shouldLeave) {
        const leaveController = new AbortController(); leaving.current = leaveController;
        void apiFetch(`/api/work-hub/meetings/${occurrenceId}/leave`, { method: "POST", body: JSON.stringify(identity ?? {}), signal: leaveController.signal }).catch(() => undefined);
      }
    };
    const failure = (cause: any) => {
      if (!live()) return;
      const message = cause?.message === "askv.microphoneDenied"
        ? t("meetingWorkspace.audio.permissionDenied")
        : cause?.message ?? t("meetingWorkspace.audio.connectFailed");
      if ([401, 403, 404, 410].includes(cause?.status)) session.stop(t("meetingWorkspace.audio.accessAvailable", { message }));
      else setError(message);
    };
    const request = async <T,>(path: string, payload?: unknown): Promise<T> => {
      check();
      const body = payload === undefined ? undefined : identity ? { ...(payload as Record<string, unknown>), ...identity } : payload;
      const result = await apiFetch<T>(`/api/work-hub/meetings/${occurrenceId}/${path}`, {
        signal: controller.signal,
        ...(identity ? { headers: { "x-vndrly-device-id": identity.deviceId, "x-vndrly-connection-id": identity.connectionId } } : {}),
        ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
      });
      check();
      return result;
    };
    const signal = (id: number, kind: string, payload: any) => {
      const target = peerConnectionByUser.get(id);
      if (!target) return Promise.reject(new Error("Participant device is no longer connected"));
      return request("signal", { toUserId: id, toDeviceId: target.connectionId, kind, payload });
    };
    const reconcileNativeTranscription = () => {
      if (!native || recordingPolicy === null || nativeTranscriptionPending || !live()) return;
      const shouldTranscribe = !localMuted && accepted && recordingActive;
      if (nativeTranscribing === shouldTranscribe) return;
      nativeTranscriptionPending = true;
      void native.setTranscription(shouldTranscribe, recordingPolicy).then(() => {
        check(); nativeTranscribing = shouldTranscribe;
      }).catch(failure).finally(() => {
        nativeTranscriptionPending = false;
        if (live()) reconcileNativeTranscription();
      });
    };
    session.toggle = () => {
      if (!live() || presencePending) return;
      const next = !localMuted;
      // Mute is immediate; unmute waits for the authenticated presence write.
      local?.getAudioTracks().forEach(track => { track.enabled = false; });
      if (native) {
        if (nativeTranscribing && recordingPolicy !== null) void native.setTranscription(false, recordingPolicy).catch(failure);
        void native.setMuted(true).catch(failure); nativeTranscribing = false;
      }
      localMuted = true; setMuted(true); presencePending = true;
      void (async () => {
        if (!next) {
          serverAudioLease = await request<ServerAudioLease>("audio-lease", {});
          lastAudioLeaseRenewal = Date.now();
        }
        if (next && native) await native.setMuted(true);
        await request("presence", { muted: next });
        if (next) await releaseServerAudio();
        check(); localMuted = next;
        local?.getAudioTracks().forEach(track => { check(); track.enabled = !next; });
        if (native) await native.setMuted(next, next ? 0 : serverAudioLease?.generation, next ? undefined : serverAudioLease?.expiresAt);
        setMuted(next);
        reconcileNativeTranscription();
      })().catch(async cause => { await releaseServerAudio(); failure(cause); }).finally(() => { presencePending = false; });
    };
    session.forceMute = () => {
      if (!live()) return;
      local?.getAudioTracks().forEach(track => { track.enabled = false; });
      if (native) {
        if (nativeTranscribing && recordingPolicy !== null) void native.setTranscription(false, recordingPolicy).catch(failure);
        void native.setMuted(true).catch(failure); nativeTranscribing = false;
      }
      localMuted = true; setMuted(true);
      void (async () => {
        if (native) await native.setMuted(true);
        await releaseServerAudio();
        if (!presencePending) {
          presencePending = true;
          await request("presence", { muted: true }).catch(failure).finally(() => { presencePending = false; });
        }
      })().catch(failure);
    };
    session.consent = () => {
      if (!live() || recordingPolicy === null || consentPending) return;
      const next = !accepted; consentPending = true;
      void request("consent", { policyVersion: recordingPolicy, response: next ? "accepted" : "declined" }).then(() => {
        check(); accepted = next; setConsented(next); reconcileNativeTranscription();
      }).catch(failure).finally(() => { consentPending = false; });
    };
    session.moveAudio = () => {
      if (!live() || !identity) return;
      setHandoffBusy(true); setError("");
      void request("audio-handoff/request", {}).then(() => request<ServerAudioLease>("audio-handoff/accept", {})).then(async acquired => {
        check(); serverAudioLease = acquired; lastAudioLeaseRenewal = Date.now(); localMuted = false; setMuted(false); setAudioOnAnotherDevice(false);
        local?.getAudioTracks().forEach(track => { check(); track.enabled = true; });
        if (native) await native.setMuted(false, acquired.generation, acquired.expiresAt);
        await request("presence", { muted: false });
        reconcileNativeTranscription();
      }).catch(failure).finally(() => { if (live()) setHandoffBusy(false); });
    };
    session.cancelFailover = () => {
      const generation = failoverDeadline?.generation;
      failoverAttempt++;
      cancelledFailoverGeneration = generation ?? cancelledFailoverGeneration;
      failoverDeadline = null; setFailoverCountdown(null);
      if (generation) void request("audio-failover/cancel", { expectedGeneration: generation }).catch(() => undefined);
    };

    try {
      const token = await getToken(); check();
      if (!token) throw new Error(t("meetingWorkspace.audio.signIn"));
      session.token = token;
      releaseLease = await askVMicrophone.acquire("work-hub-audio", () => stopOwned(t("meetingWorkspace.audio.otherMicrophone")));
      if (!live()) { await release(); return; }
      await requestAskVMicrophonePermission(check); check();
      native = createNativeMeetingAudioSession({
        occurrenceId, generation: version,
        audioAuthorization: () => serverAudioLease && identity ? { ...identity, token: serverAudioLease.token, generation: serverAudioLease.generation } : null,
        onSignal: event => { if (live()) void signal(event.toUserId, event.kind, event.payload).catch(failure); },
        onError: code => { if (live()) session.stop(t("meetingWorkspace.audio.nativeStopped", { code })); },
      });
      const rtc = native ? null : await import("react-native-webrtc"); check();
      let captureError: unknown;
      if (rtc) capturePending = rtc.mediaDevices.getUserMedia({ audio: true, video: false }).then(stream => {
        local = stream;
        // A cancelled acquisition must enter exception-safe disposal before any
        // native setter can throw; stopOwned may already be waiting on this result.
        if (!live()) { disposeLocal(); return; }
        stream.getAudioTracks().forEach(track => { track.enabled = false; });
        stream.getAudioTracks().forEach(track => {
          const ended = () => session.stop(t("meetingWorkspace.audio.microphoneDisconnected"));
          const events = track as typeof track & NativeEvents;
          events.addEventListener("ended", ended);
          trackListeners.push(() => events.removeEventListener("ended", ended));
        });
      }, cause => { captureError = cause; });
      await capturePending; check();
      if (captureError) throw captureError;
      identity = { deviceId: await getDeviceId(), connectionId: newConnectionId() }; check();
      await apiFetch("/api/work-hub/devices/register", { method: "POST", body: JSON.stringify({ deviceId: identity.deviceId, friendlyName: workHubDeviceLabel(), deviceClass: workHubDeviceClass(), capabilities: { microphone: true, speaker: true, fileSelection: true, pushNotifications: true } }), signal: controller.signal }); check();
      await apiFetch(`/api/work-hub/devices/${identity.deviceId}/heartbeat`, { method: "POST", body: JSON.stringify({ connectionId: identity.connectionId, foreground: true, microphonePermission: "granted", surface: { path: `/work-hub/meetings/${occurrenceId}`, entityType: "meeting", entityId: occurrenceId, updatedAt: Date.now() } }), signal: controller.signal }); check();
      lastDeviceHeartbeat = Date.now();
      const info = await request<JoinInfo>("join", {}); check(); joinedServer = true;
      for (const peer of info.peerConnections ?? []) if (!peerConnectionByUser.has(peer.userId)) peerConnectionByUser.set(peer.userId, peer);
      if (native) await native.start({ sourceId: `meeting-${info.userId}-${version}`, iceServers: info.iceServers ?? [] });
      recordingPolicy = info.recordingAllowed ? info.policyVersion : null; accepted = info.consentAccepted ?? false;
      setPolicy(recordingPolicy); setConsented(accepted); setJoined(true); setBusy(false);
      let cursor = 0, polling = false;
      const peerFor = (id: number): RTCPeerConnection => {
        if (!rtc) throw new Error("Native meeting peer expected");
        check();
        const existing = peers.get(id); if (existing) return existing;
        const peer = new rtc.RTCPeerConnection({ iceServers: info.iceServers ?? [] }) as RTCPeerConnection & NativeEvents;
        peers.set(id, peer);
        local!.getTracks().forEach(track => { check(); peer.addTrack(track, local!); });
        peer.addEventListener("icecandidate", event => {
          if (event.candidate && live() && peers.get(id) === peer) void signal(id, "ice", event.candidate.toJSON()).catch(failure);
        });
        peer.addEventListener("connectionstatechange", () => {
          if (live() && peers.get(id) === peer && ["failed", "closed"].includes(peer.connectionState)) session.stop(t("meetingWorkspace.audio.connectionInterrupted"));
        });
        return peer;
      };
      interval = setInterval(async () => {
        if (polling || !live()) return;
        polling = true;
        try {
          if (identity && Date.now() - lastDeviceHeartbeat > 15_000) {
            await apiFetch(`/api/work-hub/devices/${identity.deviceId}/heartbeat`, { method: "POST", body: JSON.stringify({ connectionId: identity.connectionId, foreground: true, microphonePermission: "granted", surface: { path: `/work-hub/meetings/${occurrenceId}`, entityType: "meeting", entityId: occurrenceId, updatedAt: Date.now() } }), signal: controller.signal }); check();
            lastDeviceHeartbeat = Date.now();
          }
          if (!localMuted && serverAudioLease && Date.now() - lastAudioLeaseRenewal > 8_000) {
            const owned = serverAudioLease;
            try {
              serverAudioLease = await apiFetch<ServerAudioLease>(`/api/work-hub/meetings/${occurrenceId}/audio-lease`, { method: "PUT", body: JSON.stringify({ ...identity, token: owned.token, generation: owned.generation }), signal: controller.signal }); check();
              if (native) await native.setMuted(false, serverAudioLease.generation, serverAudioLease.expiresAt);
            } catch (cause) { session.forceMute(); throw cause; }
            lastAudioLeaseRenewal = Date.now();
          }
          const state = await request<{ presentUserIds: number[]; peerConnections?: MeetingPeer[]; recordingState: string; audioOwnership?: ServerAudioState | null; automaticBackupDeviceId?: string | null }>("audio-state"); check();
          setAudioOnAnotherDevice(Boolean(state.audioOwnership?.active && state.audioOwnership.deviceId !== identity?.deviceId));
          if (serverAudioLease && state.audioOwnership && (state.audioOwnership.deviceId !== identity?.deviceId || state.audioOwnership.generation !== serverAudioLease.generation)) {
            serverAudioLease = null; localMuted = true; setMuted(true);
            local?.getAudioTracks().forEach(track => { track.enabled = false; });
            if (native) await native.setMuted(true);
          }
          if (identity && state.audioOwnership && !state.audioOwnership.active && state.automaticBackupDeviceId === identity.deviceId && cancelledFailoverGeneration !== state.audioOwnership.generation) {
            if ((!failoverDeadline || failoverDeadline.generation !== state.audioOwnership.generation) && !failoverStarting) {
              failoverStarting = true;
              try {
                const prepared = await request<{ expectedGeneration: number; readyAt: string }>("audio-failover/prepare", { expectedGeneration: state.audioOwnership.generation });
                failoverDeadline = { generation: prepared.expectedGeneration, at: new Date(prepared.readyAt).getTime() };
              } finally { failoverStarting = false; }
            }
            const deadline = failoverDeadline;
            if (!deadline) return;
            const remaining = Math.max(0, Math.ceil((deadline.at - Date.now()) / 1_000)); setFailoverCountdown(remaining);
            if (remaining === 0 && !failoverStarting) {
              failoverStarting = true;
              const attempt = ++failoverAttempt;
              try {
                const acquired = await request<ServerAudioLease>("audio-failover/activate", { expectedGeneration: deadline.generation });
                if (attempt !== failoverAttempt || cancelledFailoverGeneration === deadline.generation) {
                  serverAudioLease = acquired;
                  await releaseServerAudio();
                  return;
                }
                serverAudioLease = acquired; lastAudioLeaseRenewal = Date.now(); localMuted = false; setMuted(false); setAudioOnAnotherDevice(false);
                local?.getAudioTracks().forEach(track => { track.enabled = true; });
                if (native) await native.setMuted(false, acquired.generation, acquired.expiresAt);
                await request("presence", { muted: false });
              } finally { failoverDeadline = null; failoverStarting = false; setFailoverCountdown(null); }
            }
          } else if (!state.audioOwnership || state.audioOwnership.active || state.automaticBackupDeviceId !== identity?.deviceId) { failoverDeadline = null; setFailoverCountdown(null); }
          const priorPeerConnections = new Map(peerConnectionByUser);
          peerConnectionByUser.clear();
          const discoveredPeers = state.peerConnections ?? info.peerConnections ?? state.presentUserIds.filter(userId => userId !== info.userId).map(userId => ({ userId, deviceId: `legacy:${userId}`, connectionId: `legacy:${userId}` }));
          for (const peer of discoveredPeers) if (!peerConnectionByUser.has(peer.userId)) peerConnectionByUser.set(peer.userId, peer);
          for (const [id, prior] of priorPeerConnections) {
            const next = peerConnectionByUser.get(id);
            if (next && next.connectionId === prior.connectionId) continue;
            if (nativePeers.has(id)) { nativePeers.delete(id); if (native) { await native.removePeer(id); check(); } }
            const peer = peers.get(id); if (peer) { peers.delete(id); pendingIce.delete(id); peer.close(); }
          }
          if (!state.presentUserIds.includes(info.userId)) {
            session.stop(t("meetingWorkspace.audio.sessionEnded"));
            return;
          }
          recordingActive = state.recordingState === "active";
          setRecording(recordingActive); setError(""); reconcileNativeTranscription();
          if (native) {
            for (const [id] of nativePeers) if (!state.presentUserIds.includes(id)) { nativePeers.delete(id); await native.removePeer(id); check(); }
            for (const [id, target] of peerConnectionByUser) {
              check(); if (id <= info.userId || nativePeers.get(id) === target.connectionId) continue;
              nativePeers.set(id, target.connectionId); await native.createOffer(id); check();
            }
          }
          for (const [id, peer] of peers) if (!state.presentUserIds.includes(id)) {
            peers.delete(id); pendingIce.delete(id); peer.close();
          }
          for (const id of peerConnectionByUser.keys()) {
            check(); if (id <= info.userId || peers.has(id)) continue;
            const peer = peerFor(id);
            const offer = await peer.createOffer(); check();
            await peer.setLocalDescription(offer); check();
            await signal(id, "offer", offer); check();
          }
          const signals = await request<Signal[]>(`signals?since=${cursor}`); check();
          for (const item of signals) {
            check();
            if (!state.presentUserIds.includes(item.fromUserId)) { cursor = Math.max(cursor, item.sequence); continue; }
            const source = peerConnectionByUser.get(item.fromUserId);
            if (item.fromDeviceId && source?.connectionId !== item.fromDeviceId) { cursor = Math.max(cursor, item.sequence); continue; }
            if (native) {
              if (source) nativePeers.set(item.fromUserId, source.connectionId);
              await native.applySignal(item.fromUserId, item.kind, item.payload); check();
              cursor = Math.max(cursor, item.sequence); continue;
            }
            if (!rtc) throw new Error("Native meeting peer expected");
            const peer = peerFor(item.fromUserId);
            if (item.kind === "offer") {
              await peer.setRemoteDescription(new rtc.RTCSessionDescription(item.payload)); check();
              const answer = await peer.createAnswer(); check();
              await peer.setLocalDescription(answer); check();
              await signal(item.fromUserId, "answer", answer); check();
            } else if (item.kind === "answer") {
              await peer.setRemoteDescription(new rtc.RTCSessionDescription(item.payload)); check();
            } else if (peer.remoteDescription) {
              await peer.addIceCandidate(new rtc.RTCIceCandidate(item.payload)); check();
            } else pendingIce.set(item.fromUserId, [...(pendingIce.get(item.fromUserId) ?? []), item.payload]);
            if (peer.remoteDescription) {
              for (const candidate of pendingIce.get(item.fromUserId) ?? []) {
                check(); await peer.addIceCandidate(new rtc.RTCIceCandidate(candidate)); check();
              }
              pendingIce.delete(item.fromUserId);
            }
            cursor = Math.max(cursor, item.sequence);
          }
        } catch (cause) { failure(cause); }
        finally { polling = false; }
      }, 1200);
      pollingTimer.current = interval;
    } catch (cause: any) {
      if (live()) {
        const message = cause?.message === "askv.microphoneDenied"
          ? t("meetingWorkspace.audio.permissionDenied")
          : cause?.code === "NATIVE_MEETING_AUDIO_UNAVAILABLE" ? t("meetingWorkspace.audio.nativeUnavailable") : cause?.message ?? t("meetingWorkspace.audio.unavailable");
        session.stop(message);
      }
    } finally {
      if (live()) setBusy(false);
      else void release()?.catch(() => undefined);
    }
  };

  useEffect(() => {
    if (hostMuted) current.current?.forceMute();
  }, [hostMuteGeneration, hostMuted]);

  const consentLabel = consented ? t("meetingWorkspace.audio.withdrawConsent") : t("meetingWorkspace.audio.giveConsent");
  const primaryLabel = busy ? t("meetingWorkspace.audio.joining")
    : joined ? hostMuted ? t("meetingWorkspace.mutedByHost", { defaultValue: "Muted by host" }) : muted ? t("meetingWorkspace.audio.unmute") : t("meetingWorkspace.audio.mute")
    : t("meetingWorkspace.audio.join");
  const consentControl = joined && policy !== null ? (
    <Pressable accessibilityRole="button" accessibilityLabel={consentLabel}
      accessibilityHint={t("meetingWorkspace.audio.consentHint")}
      style={{ minHeight: 44, justifyContent: "center" }} onPress={() => current.current?.consent()}>
      <Text style={{ color: colors.primary }}>{consentLabel}</Text>
    </Pressable>
  ) : null;
  return <View style={{ gap: 10 }}>
    <Text style={{ color: colors.text }}>{t("meetingWorkspace.audio.status", {
      state: recording ? t("meetingWorkspace.audio.recordingActive") : t("meetingWorkspace.audio.recordingOff"),
    })}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
    {failoverCountdown !== null && <View accessibilityRole="alert"><Text style={{ color: colors.text }}>{t("meetingWorkspace.audio.failoverCountdown", { count: failoverCountdown, defaultValue: "Audio device disconnected. This microphone will turn on in {{count}} seconds." })}</Text><Pressable accessibilityRole="button" onPress={() => current.current?.cancelFailover()}><Text style={{ color: colors.destructive, padding: 10 }}>{t("meetingWorkspace.audio.cancelFailover", { defaultValue: "Keep microphone off" })}</Text></Pressable></View>}
    {consentControl}
    <View style={{ flexDirection: "row", gap: 20 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={primaryLabel}
        accessibilityHint={t(joined ? "meetingWorkspace.audio.toggleHint" : "meetingWorkspace.audio.joinHint")}
        style={{ minHeight: 44, justifyContent: "center" }} disabled={busy || (joined && hostMuted)}
        onPress={joined ? () => current.current?.toggle() : join}>
        <Text style={{ color: colors.primary, padding: 10 }}>{primaryLabel}</Text>
      </Pressable>
      {(joined || busy) && <Pressable accessibilityRole="button" accessibilityLabel={t("meetingWorkspace.audio.leave")}
        accessibilityHint={t("meetingWorkspace.audio.leaveHint")} style={{ minHeight: 44, justifyContent: "center" }}
        onPress={() => current.current?.stop(undefined, true)}>
        <Text style={{ color: colors.destructive, padding: 10 }}>{t("meetingWorkspace.audio.leave")}</Text>
      </Pressable>}
      {joined && audioOnAnotherDevice && <Pressable accessibilityRole="button" disabled={handoffBusy || hostMuted} accessibilityLabel={t("meetingWorkspace.audio.moveHere", { defaultValue: "Move audio here" })} onPress={() => current.current?.moveAudio()}><Text style={{ color: colors.primary, padding: 10 }}>{handoffBusy ? t("meetingWorkspace.audio.moving", { defaultValue: "Moving audio…" }) : t("meetingWorkspace.audio.moveHere", { defaultValue: "Move audio here" })}</Text></Pressable>}
    </View>
  </View>;
}
