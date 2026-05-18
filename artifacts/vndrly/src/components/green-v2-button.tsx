import { PillButton } from "@/components/pill";

interface GreenV2ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function GreenV2Button({ children, onClick, className, type = "button", disabled, ...props }: GreenV2ButtonProps) {
  return (
    <PillButton color="green" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
