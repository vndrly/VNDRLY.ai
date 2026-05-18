import { cn } from "@/lib/utils";
import { PillButton } from "@/components/pill";

export default function PortalButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  testId,
  className = "",
  fullWidth = true,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  testId?: string;
  className?: string;
  height?: number;
  fullWidth?: boolean;
  idleColor?: string;
  hoverColor?: string;
  idleTextColor?: string;
  hoverTextColor?: string;
}) {
  return (
    <PillButton
      color="image"
      onClick={onClick}
      type={type === "reset" ? "button" : type}
      disabled={disabled}
      className={cn(fullWidth ? "w-full" : "", className)}
      data-testid={testId}
    >
      {children}
    </PillButton>
  );
}
