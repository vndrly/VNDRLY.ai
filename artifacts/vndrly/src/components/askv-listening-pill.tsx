import type { ButtonHTMLAttributes } from "react";
import { PillColorLayer } from "@/components/png-pill-chrome";
import { pillGreen, pillGreenApproval1, pillRed, PILL_IDLE } from "@/lib/pill-palette-assets";
import { PILL_HEIGHT_CLASS, PILL_HEIGHT_PX, PILL_LABEL_CLASS, PILL_WRAPPER_CLASS, pillLabelToneClass } from "@/lib/pill-doctrine";
import { cn } from "@/lib/utils";

/** Uses the Hotlist Live pill's exact image, cap rendering, height and label treatment. */
export default function AskVListeningPill({ active, waiting = false, statusLabel, startStop = false, tone, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; waiting?: boolean; statusLabel?: string; startStop?: boolean; tone?: "green" | "red" | "grey" }) {
  const label = statusLabel ?? (active ? "V is listening" : waiting ? "Waiting for consent" : "Click to restart V");
  const color = tone ?? (startStop ? (active ? "red" : "green") : (active ? "green" : "grey"));
  const pillSrc = tone === "red" ? pillRed : tone === "green" ? pillGreenApproval1 : tone === "grey" ? PILL_IDLE : startStop ? (active ? pillRed : pillGreenApproval1) : (active ? pillGreen : PILL_IDLE);
  return <button {...props} type="button" aria-label={label} aria-pressed={active} data-color={color}
    className={cn(PILL_WRAPPER_CLASS, PILL_HEIGHT_CLASS, "shrink-0 self-center border-0 bg-transparent p-0 cursor-pointer disabled:cursor-default disabled:opacity-60 focus-visible:outline-none", className)}
    style={{ height: PILL_HEIGHT_PX }}>
    <PillColorLayer src={pillSrc} />
    <span className={cn(PILL_LABEL_CLASS, "h-full gap-1.5", pillLabelToneClass(startStop ? false : !active))}>{label}{children}</span>
  </button>;
}
