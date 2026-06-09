import { cn } from "@/lib/utils";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import pillRed from "@assets/900x229_red_Pill_v2_1777847855327.png";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";

interface RemovePillProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function RemovePill({
  children,
  onClick,
  className,
  type = "button",
  disabled,
  ...props
}: RemovePillProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        PILL_WRAPPER_CLASS,
        PILL_HEIGHT_CLASS,
        "group/removepill min-w-[70px] cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{ height: PILL_HEIGHT_PX }}
      data-testid={props["data-testid"]}
    >
      <PillColorLayer
        src={pillBase}
        className="group-hover/removepill:opacity-0"
      />
      <PillColorLayer
        src={pillRed}
        className="opacity-0 group-hover/removepill:opacity-100"
      />
      <PillGlossOverlay />
      <span
        className={cn(
          PILL_LABEL_CLASS,
          "h-full gap-1.5 transition-colors",
          "text-gray-700 group-hover/removepill:text-white",
          "group-hover/removepill:[text-shadow:0_2px_4px_rgba(0,0,0,0.9)]",
        )}
      >
        {children}
      </span>
    </button>
  );
}
