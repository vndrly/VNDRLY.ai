import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import ImagePill from '@/components/image-pill';
import { pillGreenApproval1 } from "@/lib/pill-palette-assets";

export default function AskVStatusIndicator() {
  const { state, muted, error, availabilityStatus, setMuted } = useAskVVoiceSession();
  const unavailable = availabilityStatus !== "available" || !!error || state === "error";
  const label = muted ? "Unmute" : unavailable ? "Unavailable" : "Mute";
  if (!label) return null;
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-label={muted ? "Unmute AskV" : "Mute AskV"}
      title={muted ? "Unmute AskV" : "Mute AskV"}
      className="rounded-full border-0 bg-transparent p-0 transition-transform active:scale-[0.98]"
      data-testid="askv-status-toggle"
    >
      <ImagePill
        color={muted || unavailable ? 'red' : 'green'}
        activeSrc={!muted && !unavailable ? pillGreenApproval1 : undefined}
        data-testid="askv-status-indicator"
        aria-label={label}
        className="text-[11px]"
      >
        {label}
      </ImagePill>
    </button>
  );
}
