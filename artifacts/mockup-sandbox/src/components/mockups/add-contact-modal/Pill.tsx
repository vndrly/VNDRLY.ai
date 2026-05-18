import amberLeft from "@assets/36_Amber_Pill_Left_1776736120526.png";
import amberCenter from "@assets/36_Amber_Pill_Center_1776736120527.png";
import amberRight from "@assets/36_Amber_Pill_Right_1776736120527.png";

export type PillColor = "amber";

const CAPS: Record<PillColor, { left: string; center: string; right: string }> = {
  amber: { left: amberLeft, center: amberCenter, right: amberRight },
};

type Size = "sm" | "md";

const SIZE: Record<Size, { h: number; px: number; text: string }> = {
  sm: { h: 28, px: 14, text: "text-[11px]" },
  md: { h: 40, px: 18, text: "text-sm" },
};

export function Pill({
  color = "amber",
  children,
  onClick,
  size = "sm",
  fullWidth = false,
  className = "",
}: {
  color?: PillColor;
  children: React.ReactNode;
  onClick?: () => void;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
}) {
  const s = SIZE[size];
  const cap = CAPS[color];
  const capW = s.h / 2;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center justify-center font-semibold text-white drop-shadow-sm transition-transform active:scale-[0.98] ${s.text} ${
        fullWidth ? "w-full" : ""
      } ${className}`}
      style={{ height: s.h, padding: 0, background: "transparent", border: 0 }}
    >
      <span className="pointer-events-none absolute inset-0 flex" aria-hidden>
        <img
          src={cap.left}
          alt=""
          style={{ height: s.h, width: capW, flex: "0 0 auto", display: "block" }}
        />
        <img
          src={cap.center}
          alt=""
          style={{
            height: s.h,
            flex: "1 1 auto",
            display: "block",
            objectFit: "fill",
            width: "100%",
          }}
        />
        <img
          src={cap.right}
          alt=""
          style={{ height: s.h, width: capW, flex: "0 0 auto", display: "block" }}
        />
      </span>
      <span
        className="relative z-10 inline-flex items-center gap-1.5 whitespace-nowrap"
        style={{ paddingLeft: s.px, paddingRight: s.px }}
      >
        {children}
      </span>
    </button>
  );
}
