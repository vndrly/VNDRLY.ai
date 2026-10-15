import React from "react";
import BrandPillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
export function usePalette() {
  return {
    primary: "var(--brand-primary)",
    text: "hsl(var(--foreground))",
    card: "hsl(var(--card))",
  };
}
export function Frame({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: Record<string, unknown>;
}) {
  return (
    <div
      style={
        {
          display: "flex",
          flexDirection: "column",
          ...style,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
export function Paragraph({
  children,
  style,
  accessibilityLiveRegion,
}: {
  children: React.ReactNode;
  style?: Record<string, unknown>;
  accessibilityLiveRegion?: "polite" | "assertive" | "none";
}) {
  return (
    <p
      aria-live={
        accessibilityLiveRegion === "none" ? undefined : accessibilityLiveRegion
      }
      style={{ margin: 0, ...style } as React.CSSProperties}
    >
      {children}
    </p>
  );
}
export function Field({
  accessibilityLabel,
  placeholder,
  value,
  onChangeText,
  editable = true,
  multiline = false,
  style,
  keyboardType,
}: {
  accessibilityLabel?: string;
  placeholder?: string;
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  multiline?: boolean;
  style?: Record<string, unknown>;
  keyboardType?: string;
}) {
  const props = {
    "aria-label": accessibilityLabel,
    placeholder,
    value,
    disabled: !editable,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChangeText(e.target.value),
    style: style as React.CSSProperties,
  };
  return multiline ? (
    <Textarea {...props} />
  ) : (
    <Input
      {...props}
      inputMode={keyboardType === "numeric" ? "decimal" : undefined}
    />
  );
}
export function Pill({
  children,
  color = "brand",
  solid = false,
  disabled = false,
  onPress,
}: {
  children: React.ReactNode;
  color?: "brand" | "blue" | "green" | "red";
  solid?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <BrandPillButton
      tone={color}
      disabled={disabled}
      aria-pressed={solid}
      className={solid ? "ring-2 ring-[color:var(--brand-primary)]" : ""}
      onClick={onPress}
    >
      {children}
    </BrandPillButton>
  );
}
