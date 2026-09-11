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

type Session = {
  valid: boolean;
  token: string | null | undefined;
  stop: (message?: string, notifyLeave?: boolean) => void;
  toggle: () => void;
  consent: () => void;
};
type JoinInfo = { userId: number; iceServers: any[]; recordingAllowed: boolean; policyVersion: number; consentAccepted?: boolean };
type Signal = { sequence: number; fromUserId: number; kind: string; payload: any };
// The installed package's EventTarget declaration omits these inherited APIs.
type NativeEvents = {
  addEventListener: (name: string, listener: (event: any) => void) => void;
  removeEventListener: (name: string, listener: (event: any) => void) => void;
};
const cancelled = () => Object.assign(new Error("Audio session stopped"), { name: "AbortError" });

/** Audio stays on the existing VNDRLY signaling service and native WebRTC. */
export default function WorkHubAudioRoom({ occurrenceId }: { occurrenceId: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(true);
  const [recording, setRecording] = useState(false);
  const [consented, setConsented] = useState(false);
  const [policy, setPolicy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const current = useRef<Session | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const leaving = useRef<AbortController | null>(null);

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
    const nativePeers = new Set<number>();
    const pendingIce = new Map<number, any[]>();
    let local: MediaStream | null = null;
    let native: NativeMeetingAudioSession | null = null;
    let capturePending: Promise<void> | null = null;
    let cleanup: Promise<void> | null = null;
    let releaseLease: (() => Promise<void>) | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let joinedServer = false, localMuted = true, presencePending = false, consentPending = false;
    let accepted = false, recordingPolicy: number | null = null, recordingActive = false;
    let nativeTranscribing = false, nativeTranscriptionPending = false;
    const trackListeners: Array<() => void> = [];
    const session: Session = { valid: true, token: getCachedToken() ?? undefined, stop: () => {}, toggle: () => {}, consent: () => {} };
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
    // Called INSIDE the coordinator's serialized handoff. Never wait for the
    // lease release (or all of join, which may itself be waiting for a lease).
    // Only actual native acquisition can still produce a microphone to clean up.
    const stopOwned = (message?: string): Promise<void> => {
      if (cleanup) return cleanup;
      session.valid = false;
      const failures: unknown[] = [];
      local?.getTracks().forEach(track => { try { track.enabled = false; } catch (cause) { failures.push(cause); } });
      controller.abort();
      if (interval !== null) clearInterval(interval);
      interval = null;
      if (current.current === session) {
        current.current = null;
        if (mounted.current) {
          setJoined(false); setBusy(false); setMuted(true); setRecording(false); setConsented(false); setPolicy(null);
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
        void apiFetch(`/api/work-hub/meetings/${occurrenceId}/leave`, { method: "POST", body: "{}", signal: leaveController.signal }).catch(() => undefined);
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
      const result = await apiFetch<T>(`/api/work-hub/meetings/${occurrenceId}/${path}`, {
        signal: controller.signal,
        ...(payload === undefined ? {} : { method: "POST", body: JSON.stringify(payload) }),
      });
      check();
      return result;
    };
    const signal = (id: number, kind: string, payload: any) => request("signal", { toUserId: id, kind, payload });
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
      void request("presence", { muted: next }).then(async () => {
        check(); localMuted = next;
        local?.getAudioTracks().forEach(track => { check(); track.enabled = !next; });
        if (native) await native.setMuted(next);
        setMuted(next);
        reconcileNativeTranscription();
      }).catch(failure).finally(() => { presencePending = false; });
    };
    session.consent = () => {
      if (!live() || recordingPolicy === null || consentPending) return;
      const next = !accepted; consentPending = true;
      void request("consent", { policyVersion: recordingPolicy, response: next ? "accepted" : "declined" }).then(() => {
        check(); accepted = next; setConsented(next); reconcileNativeTranscription();
      }).catch(failure).finally(() => { consentPending = false; });
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
      const info = await request<JoinInfo>("join", {}); check(); joinedServer = true;
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
          const state = await request<{ presentUserIds: number[]; recordingState: string }>("audio-state"); check();
          if (!state.presentUserIds.includes(info.userId)) {
            session.stop(t("meetingWorkspace.audio.sessionEnded"));
            return;
          }
          recordingActive = state.recordingState === "active";
          setRecording(recordingActive); setError(""); reconcileNativeTranscription();
          if (native) {
            for (const id of nativePeers) if (!state.presentUserIds.includes(id)) { nativePeers.delete(id); await native.removePeer(id); check(); }
            for (const id of state.presentUserIds) {
              check(); if (id <= info.userId || nativePeers.has(id)) continue;
              nativePeers.add(id); await native.createOffer(id); check();
            }
          }
          for (const [id, peer] of peers) if (!state.presentUserIds.includes(id)) {
            peers.delete(id); pendingIce.delete(id); peer.close();
          }
          for (const id of state.presentUserIds) {
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
            if (native) {
              nativePeers.add(item.fromUserId);
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

  const consentLabel = consented ? t("meetingWorkspace.audio.withdrawConsent") : t("meetingWorkspace.audio.giveConsent");
  const primaryLabel = busy ? t("meetingWorkspace.audio.joining")
    : joined ? muted ? t("meetingWorkspace.audio.unmute") : t("meetingWorkspace.audio.mute")
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
    {consentControl}
    <View style={{ flexDirection: "row", gap: 20 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={primaryLabel}
        accessibilityHint={t(joined ? "meetingWorkspace.audio.toggleHint" : "meetingWorkspace.audio.joinHint")}
        style={{ minHeight: 44, justifyContent: "center" }} disabled={busy}
        onPress={joined ? () => current.current?.toggle() : join}>
        <Text style={{ color: colors.primary, padding: 10 }}>{primaryLabel}</Text>
      </Pressable>
      {(joined || busy) && <Pressable accessibilityRole="button" accessibilityLabel={t("meetingWorkspace.audio.leave")}
        accessibilityHint={t("meetingWorkspace.audio.leaveHint")} style={{ minHeight: 44, justifyContent: "center" }}
        onPress={() => current.current?.stop(undefined, true)}>
        <Text style={{ color: colors.destructive, padding: 10 }}>{t("meetingWorkspace.audio.leave")}</Text>
      </Pressable>}
    </View>
  </View>;
}
