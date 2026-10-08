import React, { useEffect, useRef, useState } from "react";
import { AppState, Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { captureAuthScope, isAuthScopeCurrent, subscribeToken, subscribeUser } from "@/lib/auth";
import { createPttRecorder, uploadAudioBlob, type PttRecorder } from "@/lib/ptt";
import { transcribeLocalWorkDraft } from "@/lib/native-work-capture";

export default function NativeDictation({ value, onChange, disabled, onAudio }: {
  value: string; onChange(text: string): void; disabled: boolean;
  onAudio?: (objectPath: string, durationSeconds: number) => void;
}) {
  const { t, i18n } = useTranslation(), colors = useColors();
  const recorder = useRef<PttRecorder | null>(null), alive = useRef(true), inflight = useRef(false);
  const latest = useRef(value); latest.current = value;
  const [recording, setRecording] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [draft, setDraft] = useState<{ text: string; original: string; uri: string; durationSeconds: number; current(): boolean } | null>(null);
  useEffect(() => {
    const clear = () => { setDraft(null); setRecording(false); setBusy(false); const current = recorder.current; recorder.current = null; void current?.dispose(); };
    const user = subscribeUser(clear), token = subscribeToken(clear);
    const state = AppState.addEventListener("change", next => { if (next !== "active") clear(); });
    return () => { alive.current = false; user(); token(); state.remove(); void recorder.current?.dispose(); };
  }, []);
  if (Platform.OS !== "ios") return null;
  async function toggle() {
    if (inflight.current || disabled) return;
    inflight.current = true; setBusy(true); setError(false);
    const scope = captureAuthScope(), original = latest.current;
    try {
      if (!recorder.current || !recording) {
        await recorder.current?.dispose(); setDraft(null);
        const owned = await createPttRecorder({ deleteOnDispose: true });
        if (!alive.current || !isAuthScopeCurrent(scope)) { await owned.dispose(); return; }
        recorder.current = owned; await owned.start();
        if (alive.current && isAuthScopeCurrent(scope)) setRecording(true);
      } else {
        const audio = await recorder.current.stop(); setRecording(false);
        const text = await transcribeLocalWorkDraft(audio.uri, i18n.language.startsWith("es") ? "es-ES" : "en-US");
        if (alive.current && isAuthScopeCurrent(scope) && latest.current === original) setDraft({ ...audio, text: text.text, original, current: () => isAuthScopeCurrent(scope) });
        else await recorder.current?.dispose();
      }
    } catch { if (alive.current && isAuthScopeCurrent(scope)) { setError(true); setRecording(false); } await recorder.current?.dispose(); recorder.current = null; }
    finally { inflight.current = false; if (alive.current && isAuthScopeCurrent(scope)) setBusy(false); }
  }
  async function attachAudio() {
    if (!draft || !onAudio || !draft.current() || inflight.current) return;
    inflight.current = true; setBusy(true);
    const scope = captureAuthScope();
    try {
      const upload = await uploadAudioBlob(draft.uri, draft.durationSeconds, scope);
      if (alive.current && isAuthScopeCurrent(scope)) onAudio(upload.objectPath, draft.durationSeconds);
      await recorder.current?.dispose(); recorder.current = null; setDraft(null);
    } catch { if (alive.current && isAuthScopeCurrent(scope)) setError(true); }
    finally { inflight.current = false; if (alive.current && isAuthScopeCurrent(scope)) setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    <TogglePillButton disabled={disabled || busy} onPress={() => { void toggle(); }}>{t(recording ? "nativeDictation.stop" : "nativeDictation.start")}</TogglePillButton>
    {recording ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{t("nativeDictation.recording")}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.text }}>{t("nativeDictation.unavailable")}</Text> : null}
    {draft ? <>
      <Text style={{ color: colors.text }}>{t("nativeDictation.review")}</Text>
      <Text style={{ color: colors.text }}>{draft.text}</Text>
      <TogglePillButton disabled={disabled || busy} onPress={() => { if (draft.current() && latest.current === draft.original) onChange([draft.original, draft.text].filter(Boolean).join("\n")); }}>{t("nativeDictation.useText")}</TogglePillButton>
      {onAudio ? <TogglePillButton disabled={disabled || busy} onPress={() => { void attachAudio(); }}>{t("nativeDictation.attach")}</TogglePillButton> : null}
      <TogglePillButton disabled={busy} onPress={() => { setDraft(null); void recorder.current?.dispose(); recorder.current = null; }}>{t("nativeDictation.discard")}</TogglePillButton>
    </> : null}
  </View>;
}
