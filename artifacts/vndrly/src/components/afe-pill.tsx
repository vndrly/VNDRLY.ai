import type { ReactNode } from "react";
import PillBg from "@/components/pill-bg";
import { cn } from "@/lib/utils";
import afeBluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";

const AFE_PILL_ASPECT = 900 / 229;

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
        "group relative inline-flex h-[24px] min-w-[88px] select-none items-center align-middle",
        className,
      )}
      title={title}
      data-testid={dataTestId}
    >
      <PillBg
        src={afeBluePill}
        imageAspect={AFE_PILL_ASPECT}
        className="opacity-95 transition-opacity group-hover:opacity-100"
      />
      <PillBg src={pillGloss} stretch className="opacity-60" />
      <span
        className="relative z-10 flex h-full w-full items-center justify-center whitespace-nowrap px-3 text-xs font-bold text-white"
        style={{ textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
      >
        {children}
      </span>
    </span>
  );
}
