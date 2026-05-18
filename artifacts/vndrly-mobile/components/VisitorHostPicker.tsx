import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import AmberButton from "@/components/AmberButton";
import { useColors } from "@/hooks/useColors";
import type { SiteContext } from "@/lib/guest";
import { buildHostOptions, canSubmitCheckIn } from "@/lib/visitorCheckin";

export interface VisitorHostPickerProps {
  ctx: SiteContext;
  hostKey: string | null;
  onSelectHost: (key: string) => void;
  purpose: string;
  onPurposeChange: (v: string) => void;
  duration: string;
  onDurationChange: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
  onChangeSite: () => void;
  labels: {
    changeSite: string;
    whoVisiting: string;
    noHosts: string;
    purpose: string;
    purposePlaceholder: string;
    expectedMinutes: string;
    checkIn: string;
    geofenceNote: string;
  };
}

export default function VisitorHostPicker({
  ctx,
  hostKey,
  onSelectHost,
  purpose,
  onPurposeChange,
  duration,
  onDurationChange,
  busy,
  onSubmit,
  onChangeSite,
  labels,
}: VisitorHostPickerProps) {
  const colors = useColors();
  const hostOptions = buildHostOptions(ctx);
  const submitDisabled = !canSubmitCheckIn(hostKey, ctx, busy);

  return (
    <View
      testID="host-picker-card"
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card, marginTop: 16 }]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{ctx.site.name}</Text>
        <TouchableOpacity onPress={onChangeSite} testID="change-site-btn">
          <Text style={[styles.linkText, { color: colors.primary }]}>{labels.changeSite}</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.muted, { color: colors.mutedForeground }]}>{ctx.site.address}</Text>

      <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>{labels.whoVisiting}</Text>
      {hostOptions.length === 0 ? (
        <Text testID="no-hosts" style={[styles.muted, { color: colors.mutedForeground }]}>{labels.noHosts}</Text>
      ) : (
        hostOptions.map((opt) => {
          const selected = hostKey === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              testID={`host-option-${opt.key}`}
              onPress={() => onSelectHost(opt.key)}
              style={[
                styles.hostOption,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.accent : "transparent",
                },
              ]}
            >
              <Feather
                name={selected ? "check-circle" : "circle"}
                size={18}
                color={selected ? colors.primary : colors.mutedForeground}
              />
              <Text style={[styles.hostLabel, { color: colors.foreground }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })
      )}

      <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>{labels.purpose}</Text>
      <TextInput
        testID="purpose-input"
        value={purpose}
        onChangeText={onPurposeChange}
        style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
        placeholderTextColor={colors.mutedForeground}
        placeholder={labels.purposePlaceholder}
      />

      <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>{labels.expectedMinutes}</Text>
      <TextInput
        testID="duration-input"
        value={duration}
        onChangeText={onDurationChange}
        keyboardType="number-pad"
        style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background }]}
      />

      <AmberButton
        testID="check-in-btn"
        onPress={onSubmit}
        loading={busy}
        disabled={submitDisabled}
        height={48}
        style={{ marginTop: 16 }}
      >
        {labels.checkIn}
      </AmberButton>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>{labels.geofenceNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 16 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, marginBottom: 6 },
  muted: { fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 },
  label: { fontFamily: "Inter_500Medium", fontSize: 13, marginBottom: 6 },
  hostOption: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8 },
  hostLabel: { fontFamily: "Inter_500Medium", fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Inter_400Regular", fontSize: 16 },
  linkText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  note: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 10, textAlign: "center" },
});
