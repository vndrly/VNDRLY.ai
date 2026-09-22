import { cn } from "@/lib/utils";

export default function AskVWaveform({ active, className }: { active: boolean; className?: string }) {
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
            "w-0.5 rounded-full bg-[color:var(--brand-primary)] transition-[height,opacity] motion-reduce:animate-none",
            active ? "animate-pulse opacity-100" : "opacity-40",
          )}
          style={{ height: active ? height : 4, animationDelay: `${index * 90}ms`, animationDuration: "650ms" }}
        />
      ))}
    </div>
  );
}
