import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import ImagePill from '@/components/image-pill';

const LABELS: Record<string, string> = {
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  "wake-idle": "Wake enabled",
  muted: "Muted",
};

export default function AskVStatusIndicator() {
  const { state, muted, acrossVndrly, wakeReady, error, availabilityStatus } = useAskVVoiceSession();
  const label = muted
    ? "Muted"
    : availabilityStatus === 'permission_denied' ? 'Microphone blocked'
      : availabilityStatus === 'unsupported_browser' ? 'Browser unsupported'
      : availabilityStatus === 'missing_configuration' ? 'Voice not configured'
      : availabilityStatus === 'disabled_for_account' ? 'Voice access unavailable'
      : error ? "Voice unavailable"
      : wakeReady && acrossVndrly ? "Listening for AskV"
      : state === "connecting" ? "Connecting"
      : state === "error" ? "Voice unavailable"
      : state === "wake-idle" ? "Voice idle" : LABELS[state];
  if (!label) return null;
  return (
    <ImagePill
      color={muted || state === 'error' ? 'red' : state === 'listening' || wakeReady ? 'green' : 'amber'}
      data-testid="askv-status-indicator"
      aria-label={label}
      className="text-[11px]"
    >
      {label}
    </ImagePill>
  );
}
