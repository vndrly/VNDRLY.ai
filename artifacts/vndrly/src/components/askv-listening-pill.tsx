import type { ButtonHTMLAttributes } from "react";
import { PillColorLayer } from "@/components/png-pill-chrome";
import { pillGreen, PILL_IDLE } from "@/lib/pill-palette-assets";
import { PILL_HEIGHT_CLASS, PILL_HEIGHT_PX, PILL_LABEL_CLASS, PILL_WRAPPER_CLASS, pillLabelToneClass } from "@/lib/pill-doctrine";
import { cn } from "@/lib/utils";

/** Uses the Hotlist Live pill's exact image, cap rendering, height and label treatment. */
export default function AskVListeningPill({ active, waiting = false, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; waiting?: boolean }) {
  const label = active ? "V is listening" : waiting ? "Waiting for consent" : "Click to restart V";
  return <button {...props} type="button" aria-label={label} aria-pressed={active} data-color={active ? "green" : "grey"}
    className={cn(PILL_WRAPPER_CLASS, PILL_HEIGHT_CLASS, "shrink-0 self-center border-0 bg-transparent p-0 cursor-pointer disabled:cursor-default disabled:opacity-60 focus-visible:underline focus-visible:decoration-2", className)}
    style={{ height: PILL_HEIGHT_PX }}>
    <PillColorLayer src={active ? pillGreen : PILL_IDLE} />
    <span className={cn(PILL_LABEL_CLASS, "h-full gap-1.5", pillLabelToneClass(!active))}>{label}</span>
  </button>;
}
