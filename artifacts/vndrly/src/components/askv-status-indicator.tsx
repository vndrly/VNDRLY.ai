import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import AskVListeningPill from "@/components/askv-listening-pill";
import AskVWaveform from "@/components/askv-waveform";

export interface AskVStatusIndicatorProps {
  placement?: "default" | "top-strip";
}

export default function AskVStatusIndicator({ placement = "default" }: AskVStatusIndicatorProps) {
  const voice = useAskVVoiceSession();
  const { muted, setMuted } = voice;
  const unavailable = voice.availabilityStatus !== "available" || voice.state === "error";
  const active = !unavailable && !muted && ["connecting", "greeting", "listening", "thinking", "speaking", "wake-idle"].includes(voice.state);
  const label = unavailable ? "AskV is Unavailable" : active ? "AskV is Active" : "AskV is Muted";
  const actionTitle = unavailable ? "Retry AskV voice" : active ? "Mute AskV voice" : "Start AskV voice";
  const voiceActive = active;
  const toggle = () => {
    window.dispatchEvent(new CustomEvent("askv:open-panel"));
    setMuted(active);
  };
  return <div className="flex items-center gap-2">
    <AskVListeningPill active={active} tone={unavailable ? "grey" : active ? "green" : "red"} statusLabel={label} onClick={toggle} data-testid="askv-status-toggle" title={actionTitle}>
      {placement === "top-strip" && <AskVWaveform active={voiceActive} white className="h-4" />}
    </AskVListeningPill>
  </div>;
}
