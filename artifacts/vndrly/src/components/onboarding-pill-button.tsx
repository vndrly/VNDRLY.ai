import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface OnboardingPillButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  tone?: "primary" | "secondary";
  "data-testid"?: string;
}

export default function OnboardingPillButton({ children, onClick, className, type = "button", disabled, ...props }: OnboardingPillButtonProps) {
  return (
    <PillButton color="image" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
