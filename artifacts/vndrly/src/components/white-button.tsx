import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface WhiteButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function WhiteButton({ children, onClick, className, type = "button", disabled, ...props }: WhiteButtonProps) {
  return (
    <PillButton color="image" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
