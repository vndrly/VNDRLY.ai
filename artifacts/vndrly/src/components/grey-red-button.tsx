import { PillButton } from "@/components/pill";

interface GreyRedButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function GreyRedButton({ children, onClick, className, type = "button", disabled, ...props }: GreyRedButtonProps) {
  return (
    <PillButton color="red" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
