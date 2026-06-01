import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface AmberButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function AmberButton({ children, onClick, className, type = "button", disabled, ...props }: AmberButtonProps) {
  return (
    <PillButton color="amber" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
