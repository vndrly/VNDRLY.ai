import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import AskVListeningPill from "@/components/askv-listening-pill";

export interface AskVStatusIndicatorProps {
  placement?: "default" | "top-strip";
}

export default function AskVStatusIndicator({ placement = "default" }: AskVStatusIndicatorProps) {
  const voice = useAskVVoiceSession();
  const { muted, setMuted } = voice;
  const active = !muted;
  const label = active ? "Click to Mute V" : "Click to Start V";
  return <AskVListeningPill active={active} startStop statusLabel={label} onClick={() => setMuted(active)} data-testid="askv-status-toggle" title={label} />;
}
