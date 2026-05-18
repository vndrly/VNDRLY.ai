import { PillButton } from "@/components/pill";

interface GreyButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function GreyButton({ children, onClick, className, type = "button", disabled, ...props }: GreyButtonProps) {
  return (
    <PillButton color="image" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
