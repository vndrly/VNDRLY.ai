import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import redPill from "@assets/900x229_red_Pill_v2_1777847855327.png";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";

export type ImagePillColor = "amber" | "blue" | "green" | "red" | "grey";

const PILL_IMAGE: Record<ImagePillColor, string> = {
  amber: amberPill,
  blue: bluePill,
  green: greenPill,
  red: redPill,
  grey: pillBase,
};

const PILL_ASPECT = 900 / 229;

interface ImagePillProps {
  color?: ImagePillColor;
  rest?: boolean;
  height?: number;
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}

export default function ImagePill({
  color = "grey",
  rest = false,
  height = 24,
  className,
  children,
  "data-testid": dataTestId,
}: ImagePillProps) {
  const effectiveColor: ImagePillColor = rest ? "grey" : color;
  const isLight = effectiveColor === "grey";
  return (
    <span
      className={cn(
        "group relative inline-flex items-center min-w-[70px] align-middle select-none pointer-events-none",
        className,
      )}
      style={{ height: `${height}px` }}
      data-testid={dataTestId}
    >
      <PillBg
        src={PILL_IMAGE[effectiveColor]}
        imageAspect={PILL_ASPECT}
        className="opacity-70 group-hover:opacity-100 transition-opacity"
      />
      <PillBg
        src={pillGloss}
        stretch
        className="opacity-60"
      />
      <span
        className={cn(
          "relative z-10 flex items-center justify-center w-full h-full px-3 text-xs font-bold whitespace-nowrap",
          isLight ? "text-neutral-700" : "text-white",
        )}
        style={isLight ? undefined : { textShadow: "0 2px 4px rgba(0,0,0,0.9)" }}
      >
        {children}
      </span>
    </span>
  );
}
