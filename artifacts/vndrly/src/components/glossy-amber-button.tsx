import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface GlossyAmberButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  "data-testid"?: string;
}

export default function GlossyAmberButton({ children, onClick, className, type = "button", disabled, ...props }: GlossyAmberButtonProps) {
  return (
    <PillButton color="amber" onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
