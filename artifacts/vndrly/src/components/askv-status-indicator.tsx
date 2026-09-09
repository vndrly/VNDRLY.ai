import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import { PillColorLayer } from "@/components/png-pill-chrome";
import AskVListeningPill from "@/components/askv-listening-pill";
import {
  LOGIN_BUTTON_IMAGE_ASPECT,
  LOGIN_GREEN_SQUARE_SRC,
  LOGIN_RED_SQUARE_SRC,
} from "@/lib/login-button-palette";

export interface AskVStatusIndicatorProps {
  placement?: "default" | "top-strip";
}

export default function AskVStatusIndicator({ placement = "default" }: AskVStatusIndicatorProps) {
  const voice = useAskVVoiceSession();
  const { muted, setMuted } = voice;
  if (placement === "top-strip") {
    const active = !muted && voice.availabilityStatus === "available" && ((voice.acrossVndrly && voice.wakeReady) || ["listening", "thinking", "speaking"].includes(voice.state));
    return <AskVListeningPill active={active} onClick={() => setMuted(active)} data-testid="askv-status-toggle" title={active ? "Pause V" : "Restart V"} />;
  }
  const label = muted ? "Go Live" : "Mute";
  const ariaLabel = muted ? "Go Live with AskV" : "Mute AskV";
  const color = muted ? "green" : "red";
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`group relative h-[34px] shrink-0 self-center appearance-none border-0 bg-transparent p-0 shadow-none outline-none transition-transform active:scale-[0.98] focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${
        "min-w-[74px] -translate-y-1"
      }`}
      data-testid="askv-status-toggle"
      data-color={color}
    >
      <PillColorLayer
        src={muted ? LOGIN_GREEN_SQUARE_SRC : LOGIN_RED_SQUARE_SRC}
        imageAspect={LOGIN_BUTTON_IMAGE_ASPECT}
        className="absolute inset-0 h-full w-full"
      />
      <span className="relative z-10 flex h-full items-center justify-center px-2 text-[11px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.75)]">
        {label}
      </span>
    </button>
  );
}
