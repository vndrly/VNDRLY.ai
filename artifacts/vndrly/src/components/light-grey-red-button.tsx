import { PillButton } from "@/components/pill";

interface LightGreyRedButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function LightGreyRedButton({ children, onClick, className, type = "button", disabled, ...props }: LightGreyRedButtonProps) {
  return (
    <PillButton color="red" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
