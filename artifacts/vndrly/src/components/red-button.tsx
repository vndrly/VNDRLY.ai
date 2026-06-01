import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface RedButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function RedButton({ children, onClick, className, type = "button", disabled, ...props }: RedButtonProps) {
  return (
    <PillButton color="red" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
