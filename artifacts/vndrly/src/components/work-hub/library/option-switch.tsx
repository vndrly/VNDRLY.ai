import React from "react";
import { Switch } from "@/components/ui/switch";
export default function OptionSwitch({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <Switch
        aria-label={label}
        checked={value}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </label>
  );
}
