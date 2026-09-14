import React, { useState } from "react";
import { Text, View } from "react-native";
import TogglePillButton from "@/components/TogglePillButton";
import { useColors } from "@/hooks/useColors";
import { ImplementationASurface } from "./Surface";

export function SafetyResponse() {
  const colors = useColors();
  const [draft, setDraft] = useState(false);
  return <ImplementationASurface description="Stress-aware incident reporting and acknowledged escalation.">
    {draft ? <View accessibilityLiveRegion="assertive" style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 14, gap: 6 }}><Text style={{ color: colors.text, fontWeight: "700" }}>Incident draft ready</Text><Text style={{ color: colors.mutedForeground }}>Ask V will check immediate safety before notifying the configured chain.</Text></View> : <TogglePillButton color="brand" accessibilityLabel="Report a safety incident" onPress={() => setDraft(true)}>Report an incident</TogglePillButton>}
  </ImplementationASurface>;
}
