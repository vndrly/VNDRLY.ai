import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

interface AmberButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  hoverTextClass?: string;
  hoverTextShadowClass?: string;
  "data-testid"?: string;
}

export default function AmberButton({ children, onClick, className, type = "button", disabled, hoverTextClass, hoverTextShadowClass, ...props }: AmberButtonProps) {
  return (
    <PillButton color="amber" onClick={onClick} type={type} disabled={disabled} className={className} hoverTextClass={hoverTextClass} hoverTextShadowClass={hoverTextShadowClass} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
