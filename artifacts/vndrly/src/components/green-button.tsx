import { PillButton } from "@/components/pill";

interface GreenButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function GreenButton({ children, onClick, className, type = "button", disabled, ...props }: GreenButtonProps) {
  return (
    <PillButton color="green" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
