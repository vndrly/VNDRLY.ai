import { cn } from "@/lib/utils";
import amberPill from "@assets/900x229_Amber_Pill_v4_1778504507024.png";
import bluePill from "@assets/NewPillPallet_0001s_0017_900x229_blue_Pill.png";
import greenPill from "@assets/NewPillPallet_0001s_0051_900x229_green_Pill_v3.png";
import redPill from "@assets/900x229_red_Pill_v2_1777847855327.png";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import {
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";

export type ImagePillColor = "amber" | "blue" | "green" | "red" | "grey";

const PILL_IMAGE: Record<ImagePillColor, string> = {
  amber: amberPill,
  blue: bluePill,
  green: greenPill,
  red: redPill,
  grey: pillBase,
};

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
  height = PILL_HEIGHT_PX,
  className,
  children,
  "data-testid": dataTestId,
}: ImagePillProps) {
  const effectiveColor: ImagePillColor = rest ? "grey" : color;
  const isLight = effectiveColor === "grey";
  return (
    <span
      className={cn(
        PILL_WRAPPER_CLASS,
        "pointer-events-none min-w-[70px]",
        className,
      )}
      style={{ height: `${height}px` }}
      data-testid={dataTestId}
    >
      <PillColorLayer src={PILL_IMAGE[effectiveColor]} />
      <PillGlossOverlay />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          isLight ? "text-neutral-700" : "text-white",
        )}
        style={isLight ? undefined : { textShadow: PILL_TEXT_SHADOW }}
      >
        {children}
      </span>
    </span>
  );
}
