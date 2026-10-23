import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import AmberButton from "@/components/AmberButton";
import { useColors } from "@/hooks/useColors";
import type { SiteContext } from "@/lib/guest";
import { buildHostOptions, canSubmitCheckIn } from "@/lib/visitorCheckin";

export const GATE_MOBILE_CONTROL_METRICS = { compactHeight: 36, pillRadius: 999, tallMinHeight: 72, tallRadius: 12 } as const;

export interface VisitorHostPickerProps {
  ctx: SiteContext;
  hostKey: string | null;
  onSelectHost: (key: string) => void;
  purpose: string;
  onPurposeChange: (v: string) => void;
  duration: string;
  onDurationChange: (v: string) => void;
  busy: boolean;
  platePhotoAttached?: boolean;
  vehiclePhotoAttached?: boolean;
  onCapturePlatePhoto?: () => void;
  onCaptureVehiclePhoto?: () => void;
  onSubmit: () => void;
  onChangeSite: () => void;
  extraSubmitDisabled?: boolean;
  showSubmit?: boolean;
  hideHost?: boolean;
  lockSite?: boolean;
  notes?: string;
  onNotesChange?: (v: string) => void;
  durationChips?: Array<{ id: string; minutes: number; label: string }>;
  labels: {
    changeSite: string;
    whoVisiting: string;
    noHosts: string;
    purpose: string;
    purposePlaceholder: string;
    expectedMinutes: string;
    vehicleEvidence?: string;
    capturePlatePhoto?: string;
    captureVehiclePhoto?: string;
    attached?: string;
    checkIn: string;
    geofenceNote: string;
    notes?: string;
    notesPlaceholder?: string;
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
  platePhotoAttached = false,
  vehiclePhotoAttached = false,
  onCapturePlatePhoto,
  onCaptureVehiclePhoto,
  onSubmit,
  onChangeSite,
  extraSubmitDisabled = false,
  showSubmit = true,
  hideHost = false,
  lockSite = false,
  notes,
  onNotesChange,
  durationChips,
  labels,
}: VisitorHostPickerProps) {
  const colors = useColors();
  const hostOptions = buildHostOptions(ctx);
  const submitDisabled =
    (hideHost ? busy : !canSubmitCheckIn(hostKey, ctx, busy)) || extraSubmitDisabled;

  return (
    <View
      testID="host-picker-card"
      style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card, marginTop: 16 }]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{ctx.site.name}</Text>
        {!lockSite ? (
          <TouchableOpacity onPress={onChangeSite} testID="change-site-btn">
            <Text style={[styles.linkText, { color: colors.primary }]}>{labels.changeSite}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={[styles.muted, { color: colors.mutedForeground }]}>{ctx.site.address}</Text>

      {!hideHost ? <><Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>{labels.whoVisiting}</Text>
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
      )}</> : null}

      <Text style={[styles.label, { color: colors.foreground, marginTop: 14 }]}>{labels.purpose}</Text>
      <TextInput
        testID="purpose-input"
        value={purpose}
        onChangeText={onPurposeChange}
        style={[styles.tallInput, { borderColor: colors.primary, color: "#374151", backgroundColor: "#ffffff" }]}
        placeholderTextColor="#6b7280"
        placeholder={labels.purposePlaceholder}
        multiline
      />

      {onNotesChange ? (
        <>
          <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>
            {labels.notes ?? "Notes"}
          </Text>
          <TextInput
            testID="notes-input"
            value={notes ?? ""}
            onChangeText={onNotesChange}
            style={[styles.tallInput, { borderColor: colors.primary, color: "#374151", backgroundColor: "#ffffff" }]}
            placeholderTextColor="#6b7280"
            placeholder={labels.notesPlaceholder}
            multiline
          />
        </>
      ) : null}

      <Text style={[styles.label, { color: colors.foreground, marginTop: 12 }]}>{labels.expectedMinutes}</Text>
      {durationChips && durationChips.length > 0 ? (
        <View style={styles.chipRow}>
          {durationChips.map((chip) => (
            <TouchableOpacity
              key={chip.id}
              testID={`duration-chip-${chip.id}`}
              onPress={() => onDurationChange(String(chip.minutes))}
              style={[
                styles.chip,
                {
                  borderColor: duration === String(chip.minutes) ? colors.primary : colors.border,
                  backgroundColor: duration === String(chip.minutes) ? colors.accent : "transparent",
                },
              ]}
            >
              <Text style={[styles.chipLabel, { color: colors.foreground }]}>{chip.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <TextInput
        testID="duration-input"
        value={duration}
        onChangeText={onDurationChange}
        keyboardType="number-pad"
        style={[styles.compactInput, { borderColor: colors.primary, color: "#374151", backgroundColor: "#ffffff" }]}
      />

      {(onCapturePlatePhoto || onCaptureVehiclePhoto) && (
        <View style={styles.evidenceSection}>
          <Text style={[styles.label, { color: colors.foreground }]}>
            {labels.vehicleEvidence ?? "Vehicle evidence"}
          </Text>
          <View style={styles.evidenceRow}>
            {onCapturePlatePhoto ? (
              <TouchableOpacity
                testID="capture-plate-photo-btn"
                onPress={onCapturePlatePhoto}
                disabled={busy}
                style={[styles.evidenceButton, { borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
              >
                <Feather
                  name={platePhotoAttached ? "check-circle" : "camera"}
                  size={16}
                  color={platePhotoAttached ? colors.primary : colors.mutedForeground}
                />
                <Text style={[styles.evidenceLabel, { color: colors.foreground }]}>
                  {labels.capturePlatePhoto ?? "Plate photo"}
                  {platePhotoAttached ? ` ${labels.attached ?? "attached"}` : ""}
                </Text>
              </TouchableOpacity>
            ) : null}
            {onCaptureVehiclePhoto ? (
              <TouchableOpacity
                testID="capture-vehicle-photo-btn"
                onPress={onCaptureVehiclePhoto}
                disabled={busy}
                style={[styles.evidenceButton, { borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
              >
                <Feather
                  name={vehiclePhotoAttached ? "check-circle" : "truck"}
                  size={16}
                  color={vehiclePhotoAttached ? colors.primary : colors.mutedForeground}
                />
                <Text style={[styles.evidenceLabel, { color: colors.foreground }]}>
                  {labels.captureVehiclePhoto ?? "Vehicle photo"}
                  {vehiclePhotoAttached ? ` ${labels.attached ?? "attached"}` : ""}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}

      {showSubmit ? (
        <>
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
        </>
      ) : null}
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
  compactInput: { borderWidth: 2, borderRadius: GATE_MOBILE_CONTROL_METRICS.pillRadius, height: GATE_MOBILE_CONTROL_METRICS.compactHeight, paddingHorizontal: 12, paddingVertical: 0, fontFamily: "Inter_400Regular", fontSize: 14 },
  tallInput: { borderWidth: 2, borderRadius: GATE_MOBILE_CONTROL_METRICS.tallRadius, minHeight: GATE_MOBILE_CONTROL_METRICS.tallMinHeight, paddingHorizontal: 12, paddingVertical: 8, fontFamily: "Inter_400Regular", fontSize: 14, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: { borderWidth: 2, borderRadius: GATE_MOBILE_CONTROL_METRICS.pillRadius, height: GATE_MOBILE_CONTROL_METRICS.compactHeight, paddingHorizontal: 10, paddingVertical: 4, justifyContent: "center" },
  chipLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  evidenceSection: { marginTop: 14 },
  evidenceRow: { flexDirection: "row", gap: 8 },
  evidenceButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 2, borderRadius: GATE_MOBILE_CONTROL_METRICS.pillRadius, height: GATE_MOBILE_CONTROL_METRICS.compactHeight, paddingHorizontal: 10, paddingVertical: 4 },
  evidenceLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, textAlign: "center" },
  linkText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  note: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 10, textAlign: "center" },
});
