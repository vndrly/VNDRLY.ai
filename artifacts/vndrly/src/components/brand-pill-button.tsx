import { PNG_PILL_COLORS } from "./png-pill-rollover";
import { cn } from "@/lib/utils";
import { hasVisiblePillLabel } from "@/lib/pill-action-label";
import "@/pages/vendor-profile.css";

interface BrandPillButtonProps extends React.AriaAttributes {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  href?: string;
  target?: string;
  rel?: string;
  tone?: "image" | "brand" | "blue" | "green" | "red" | "amber";
  hoverSrc?: string;
  height?: number;
  attention?: boolean;
  title?: string;
  role?: React.AriaRole;
  "data-testid"?: string;
}
/** Compatibility export for the current minicard action style. */
export default function BrandPillButton({
  children,
  onClick,
  className,
  type = "button",
  disabled,
  href,
  target,
  rel,
  tone = "image",
  hoverSrc: _hoverSrc,
  height = 44,
  attention = false,
  title,
  ...props
}: BrandPillButtonProps) {
  const shared = {
    ...props,
    title,
    className: cn(
      "vendor-mini-card-button",
      attention && !disabled && "animate-pulse motion-reduce:animate-none",
      className,
    ),
    style: {
      minHeight: Math.max(44, height),
      borderRadius: 8,
      borderWidth: 1,
      borderStyle: "solid" as const,
      "--mini-card-accent": PNG_PILL_COLORS[tone === "image" ? "brand" : tone],
    } as React.CSSProperties,
    "data-ui-button": "mini-card",
    "data-color": tone,
    "data-modal-pill-action": hasVisiblePillLabel(children) || undefined,
  };
  if (href !== undefined)
    return (
      <a
        {...shared}
        href={href}
        target={target}
        rel={rel}
        aria-disabled={disabled || undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
          else onClick?.();
        }}
      >
        {children}
      </a>
    );
  return (
    <button {...shared} type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
