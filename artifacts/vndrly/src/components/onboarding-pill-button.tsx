import { cn } from "@/lib/utils";

interface OnboardingPillButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  tone?: "primary" | "secondary";
  "data-testid"?: string;
}

export default function OnboardingPillButton({ children, onClick, className, type = "button", disabled, tone = "primary", ...props }: OnboardingPillButtonProps) {
  return (
    <button onClick={onClick} type={type} disabled={disabled} className={cn("vendor-mini-card-button onboarding-mini-card", tone === "primary" && "onboarding-mini-card-primary", className)} data-testid={props["data-testid"]}>
      {children}
    </button>
  );
}
