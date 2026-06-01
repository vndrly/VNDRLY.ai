import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface BlueButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  href?: string;
  target?: string;
  rel?: string;
  attention?: boolean;
  title?: string;
  "data-testid"?: string;
}

export default function BlueButton({
  children,
  onClick,
  className,
  type = "button",
  disabled,
  href,
  target,
  rel,
  attention = false,
  title,
  ...props
}: BlueButtonProps) {
  const handleClick = href
    ? () => {
        if (disabled) return;
        if (target === "_blank") {
          window.open(href, "_blank", rel ?? "noopener,noreferrer");
        } else {
          window.location.href = href;
        }
        onClick?.();
      }
    : onClick;
  return (
    <PillButton
      color="blue"
      onClick={handleClick}
      type={type}
      disabled={disabled}
      attention={attention}
      title={title}
      className={className}
      data-testid={props["data-testid"]}
    >
      {children}
    </PillButton>
  );
}
