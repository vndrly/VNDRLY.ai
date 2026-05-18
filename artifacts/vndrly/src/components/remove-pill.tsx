import { cn } from "@/lib/utils";
import PillBg from "@/components/pill-bg";
import pillBase from "@assets/Vndrly_900x229_Light_Grey_Pill1_1777664658767.png";
import pillRed from "@assets/900x229_red_Pill_v2_1777847855327.png";
import pillGloss from "@assets/900x229_overlay_v2_1777664185377.png";

const PILL_ASPECT = 900 / 229;

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
        "relative h-[24px] min-w-[70px] cursor-pointer group/removepill inline-flex items-center select-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      data-testid={props["data-testid"]}
    >
      <PillBg
        src={pillBase}
        imageAspect={PILL_ASPECT}
        className="opacity-90 group-hover/removepill:opacity-0 transition-opacity duration-200"
      />
      <PillBg
        src={pillRed}
        imageAspect={PILL_ASPECT}
        className="opacity-0 group-hover/removepill:opacity-100 transition-opacity duration-200"
      />
      <PillBg
        src={pillGloss}
        stretch
        className="opacity-60"
      />
      <span
        className={cn(
          "relative z-10 flex items-center justify-center gap-1.5 px-3 h-full w-full text-xs font-bold whitespace-nowrap transition-colors",
          "text-gray-700 group-hover/removepill:text-white",
          "group-hover/removepill:[text-shadow:0_2px_4px_rgba(0,0,0,0.9)]",
        )}
      >
        {children}
      </span>
    </button>
  );
}
