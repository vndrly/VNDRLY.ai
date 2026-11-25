import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { readAskVWaveform } from "@/lib/askv-audio-waveform";

export default function AskVWaveform({ active, className, white = false }: { active: boolean; className?: string; white?: boolean }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) { setLevel(0); return; }
    const timer = window.setInterval(() => {
      const samples = readAskVWaveform();
      const energy = samples.reduce((sum, sample) => sum + sample * sample, 0);
      setLevel(samples.length ? Math.min(1, Math.sqrt(energy / samples.length) * 8) : 0);
    }, 80);
    return () => window.clearInterval(timer);
  }, [active]);
  return (
    <div
      className={cn("flex h-5 items-center justify-center gap-0.5", className)}
      data-testid="askv-waveform"
      data-active={active ? "true" : "false"}
      aria-label={active ? "Ask V voice activity" : "Ask V voice idle"}
      role="img"
    >
      {[8, 14, 20, 14, 8].map((height, index) => (
        <span
          key={`${height}-${index}`}
          aria-hidden="true"
          className={cn(
            "w-0.5 rounded-full transition-[height,opacity] motion-reduce:animate-none",
            white ? "bg-white" : "bg-[color:var(--brand-primary)]",
            active ? "opacity-100" : "opacity-40",
          )}
          style={{ height: active ? 4 + (height - 4) * level : 4 }}
        />
      ))}
    </div>
  );
}
