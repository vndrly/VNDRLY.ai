import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import AskVListeningPill from "@/components/askv-listening-pill";
import AskVWaveform from "@/components/askv-waveform";

export interface AskVStatusIndicatorProps {
  placement?: "default" | "top-strip";
}

export default function AskVStatusIndicator({ placement = "default" }: AskVStatusIndicatorProps) {
  const voice = useAskVVoiceSession();
  const { muted, setMuted } = voice;
  const active = !muted;
  const label = active ? "Click to Mute V" : "Click to Start V";
  const voiceActive = !muted && (voice.state === "listening" || voice.state === "speaking");
  const toggle = () => {
    window.dispatchEvent(new CustomEvent("askv:open-panel"));
    setMuted(active);
  };
  return <div className="flex items-center gap-2">
    <AskVListeningPill active={active} startStop statusLabel={label} onClick={toggle} data-testid="askv-status-toggle" title={label}>
      {placement === "top-strip" && <AskVWaveform active={voiceActive} white className="h-4" />}
    </AskVListeningPill>
  </div>;
}
