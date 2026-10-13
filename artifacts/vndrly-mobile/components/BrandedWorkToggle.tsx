import React from "react";
import { View } from "react-native";
import SplitToggleHalf from "./SplitToggleHalf";
import { useBrand } from "@/hooks/use-brand";
import { pickTogglePillSrc, TOGGLE_IDLE_PILL_SRC } from "@/lib/pick-toggle-pill";
export default function BrandedWorkToggle({ active, onLabel, offLabel, onChange, disabled }: { active: boolean; onLabel: string; offLabel: string; onChange: (active: boolean) => void; disabled: boolean }) {
  const brand = useBrand();
  const activeSource = pickTogglePillSrc(brand.primary, brand.name);
  return <View style={{ flexDirection: "row", borderRadius: 999, overflow: "hidden" }}>
    {([true, false] as const).map((value, index) => <SplitToggleHalf key={String(value)} disabled={disabled} side={index === 0 ? "left" : "right"} pillSrc={active === value ? activeSource : TOGGLE_IDLE_PILL_SRC} greyPill={active !== value} accessibilityState={{ selected: active === value }} onPress={() => { if (!disabled && active !== value) onChange(value); }} textStyle={{ color: active === value ? "#ffffff" : "#374151" }}>
      {value ? onLabel : offLabel}
    </SplitToggleHalf>)}
  </View>;
}
