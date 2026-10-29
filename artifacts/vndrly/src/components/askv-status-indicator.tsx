import AskVAudioTrace from "./askv-audio-trace";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import WorkdayStatusSwitch from "@/components/workday-status-switch";
import "@/components/workday-controls.css";


export interface AskVStatusIndicatorProps {
  placement?: "default" | "top-strip";
}

export default function AskVStatusIndicator({ placement = "default" }: AskVStatusIndicatorProps) {
  const voice = useAskVVoiceSession();
  const { muted, setMuted } = voice;
  const unavailable = voice.availabilityStatus !== "available" || voice.state === "error";
  const connecting = !unavailable && !muted && voice.state === "connecting";
  const active = !unavailable && !muted && ["greeting", "listening", "thinking", "speaking", "wake-idle"].includes(voice.state);
  const label = unavailable ? "AskV is Unavailable" : connecting ? "AskV is Connecting" : active ? "AskV is Active" : "AskV is Muted";
  const actionTitle = unavailable ? "Retry AskV voice" : connecting ? "Stop AskV voice" : active ? "Mute AskV voice" : "Start AskV voice";

  const toggle = () => {
    setMuted(active || connecting);
  };
  return <div className={`${placement === "top-strip" ? "static text-[var(--brand-primary)]" : "askv-pane-brand-toggle relative text-[var(--brand-primary)]"} flex w-20 shrink-0 items-center justify-center`} data-testid="askv-status-toggle" title={actionTitle} data-placement={placement}>
    <WorkdayStatusSwitch active={active} label="" accessibilityLabel={label} onClick={toggle} />
    <div className={`pointer-events-none absolute ${placement === "top-strip" ? "top-[calc(50%-22px)] -left-1 right-[10px] h-11" : "top-[calc(50%+10px)] left-[18px] right-[18px]"}`} aria-hidden="true">
      <AskVAudioTrace active={active} shape={placement === "top-strip" ? "oval" : "line"} />
    </div>
  </div>;
}
