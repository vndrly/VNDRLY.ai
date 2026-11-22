import { type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BrandedSelect } from "@/components/work-hub/chrome";
import { brandStyleVars, useBrand } from "@/hooks/use-brand";
import { cn } from "@/lib/utils";
import { embeddedIosGatePage } from "@/lib/gate-dashboard-session";
import "./gate-dashboard.css";

type Choice = { value: string; label: ReactNode; disabled?: boolean };

export function GateDropdown({ options, value, onValueChange, className, disabled, ...trigger }: {
  options: Choice[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
  "data-guidance-id"?: string;
}) {
  const brand = useBrand();
  if (!embeddedIosGatePage) {
    return <BrandedSelect {...trigger} className={className} value={value} disabled={disabled}
      onChange={event => onValueChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </BrandedSelect>;
  }
  // Radix reserves the empty string for an unselected value. Gate also uses it for "All".
  return <span className="relative block min-w-0">
    <Select value={":" + value} onValueChange={selected => onValueChange(selected.slice(1))} disabled={disabled}>
      <SelectTrigger {...trigger} className={cn("gate-dropdown-trigger", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="gate-dropdown-menu" style={brandStyleVars(brand)} align="start" collisionPadding={8}>
        {options.map(option => <SelectItem key={option.value} value={":" + option.value} disabled={option.disabled}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  </span>;
}
