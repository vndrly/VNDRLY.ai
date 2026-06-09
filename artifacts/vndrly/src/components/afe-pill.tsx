import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import afeBluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import {
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";

interface AfePillProps {
  children: ReactNode;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

export default function AfePill({
  children,
  className,
  title,
  "data-testid": dataTestId,
}: AfePillProps) {
  return (
    <span
      className={cn(
        PILL_WRAPPER_CLASS,
        "pointer-events-none min-w-[88px]",
        className,
      )}
      style={{ height: PILL_HEIGHT_PX }}
      title={title}
      data-testid={dataTestId}
    >
      <PillColorLayer src={afeBluePill} />
      <PillGlossOverlay />
      <span
        className={cn(PILL_LABEL_CLASS, "text-white")}
        style={{ textShadow: PILL_TEXT_SHADOW }}
      >
        {children}
      </span>
    </span>
  );
}
