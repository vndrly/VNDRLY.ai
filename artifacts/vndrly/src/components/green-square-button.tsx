import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface GreenSquareButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function GreenSquareButton({ children, onClick, className, type = "button", disabled, ...props }: GreenSquareButtonProps) {
  return (
    <PillButton color="green" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
