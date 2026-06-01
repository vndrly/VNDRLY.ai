import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface PurpleButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function PurpleButton({ children, onClick, className, type = "button", disabled, ...props }: PurpleButtonProps) {
  return (
    <PillButton color="image" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
