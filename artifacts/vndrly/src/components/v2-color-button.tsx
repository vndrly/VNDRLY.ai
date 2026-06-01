import { PngPillButton as PillButton, type PngPillColor as PillColor } from "@/components/png-pill-rollover";

export type V2Color = "blue" | "green" | "red" | "amber" | "orange" | "grey";

const V2_TO_PILL: Record<V2Color, PillColor | "image"> = {
  blue: "blue",
  green: "green",
  red: "red",
  amber: "amber",
  orange: "amber",
  grey: "image",
};

interface V2ColorButtonProps {
  children: React.ReactNode;
  color: V2Color;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  compact?: boolean;
  brandTint?: boolean;
  "data-testid"?: string;
}

export default function V2ColorButton({ children, color, onClick, className, type = "button", disabled, ...props }: V2ColorButtonProps) {
  return (
    <PillButton color={V2_TO_PILL[color]} onClick={onClick} type={type} disabled={disabled} className={className} data-testid={props["data-testid"]}>
      {children}
    </PillButton>
  );
}
