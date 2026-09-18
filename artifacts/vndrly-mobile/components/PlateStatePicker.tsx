import React, { useEffect, useId, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  normalizePlateState,
  orderPlateStates,
  US_PLATE_STATES,
  type PlateStateCode,
} from "@workspace/plate-state";
import { useTranslation } from "react-i18next";

import { useColors } from "@/hooks/useColors";

export const PLATE_STATE_PICKER_VISUALS = { compactHeight: 36, pillRadius: 999, borderWidth: 2, lightSurface: "#ffffff" } as const;

export interface PlateStatePickerProps {
  value: PlateStateCode | null;
  onChange: (state: PlateStateCode) => void;
  preferredStates: readonly (PlateStateCode | string | null | undefined)[];
  disabled?: boolean;
  error?: string;
}

export function PlateStatePicker({
  value,
  onChange,
  preferredStates,
  disabled = false,
  error,
}: PlateStatePickerProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedState = useMemo(
    () => US_PLATE_STATES.find((state) => state.code === value) ?? null,
    [value],
  );
  const states = useMemo(
    () => orderPlateStates(preferredStates, query),
    [preferredStates, query],
  );
  const preferredCodes = useMemo(() => {
    const codes = new Set<PlateStateCode>();
    for (const candidate of preferredStates) {
      const code = normalizePlateState(candidate);
      if (code) codes.add(code);
    }
    return codes;
  }, [preferredStates]);
  const preferredOptions = states.filter((state) => preferredCodes.has(state.code));
  const remainingOptions = states.filter((state) => !preferredCodes.has(state.code));
  const selectLabel = t("plateStatePicker.select");
  const triggerLabel = selectedState
    ? t("plateStatePicker.selected", {
        state: selectedState.name,
        code: selectedState.code,
      })
    : selectLabel;

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery("");
    }
  }, [disabled]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const selectState = (state: PlateStateCode) => {
    if (disabled) return;
    onChange(state);
    close();
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={triggerLabel}
        accessibilityHint={error
          ? t("plateStatePicker.errorHint", { error })
          : t("plateStatePicker.openHint")}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        testID="plate-state-picker-trigger"
        style={[
          styles.trigger,
          {
            backgroundColor: PLATE_STATE_PICKER_VISUALS.lightSurface,
            borderColor: error ? colors.destructive : colors.primary,
            opacity: disabled ? 0.55 : 1,
          },
        ]}
      >
        <Text style={[styles.triggerText, { color: selectedState ? "#374151" : "#6b7280" }]}>
          {selectedState
            ? `${selectedState.name} (${selectedState.code})`
            : selectLabel}
        </Text>
        <Text accessibilityElementsHidden style={[styles.chevron, { color: colors.mutedForeground }]}>
          ▾
        </Text>
      </Pressable>
      {error ? (
        <Text
          nativeID={errorId}
          accessibilityRole="alert"
          style={[styles.error, { color: colors.destructive }]}
        >
          {error}
        </Text>
      ) : null}

      {open ? (
        <Modal transparent animationType="slide" onRequestClose={close} visible>
          <View style={styles.backdrop}>
            <View
              role="dialog"
              aria-label={t("plateStatePicker.label")}
              accessibilityViewIsModal
              style={[styles.dialog, { backgroundColor: "#ffffff", borderColor: colors.primary }]}
            >
              <View style={styles.dialogHeader}>
                <Text style={[styles.title, { color: colors.foreground }]}>
                  {t("plateStatePicker.label")}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("plateStatePicker.closePicker")}
                  onPress={close}
                  style={styles.closeButton}
                >
                  <Text style={[styles.closeText, { color: colors.primary }]}>
                    {t("plateStatePicker.close")}
                  </Text>
                </Pressable>
              </View>
              <TextInput
                role="searchbox"
                accessibilityLabel={t("plateStatePicker.search")}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setQuery}
                placeholder={t("plateStatePicker.search")}
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.search,
                  { borderColor: colors.primary, color: "#374151", backgroundColor: "#ffffff" },
                ]}
                value={query}
              />
              <ScrollView
                accessibilityLabel={t("plateStatePicker.options")}
                keyboardShouldPersistTaps="handled"
                style={styles.options}
              >
                {states.length === 0 ? (
                  <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                    {t("plateStatePicker.noResults")}
                  </Text>
                ) : null}
                {preferredOptions.length > 0 ? (
                  <View>
                    <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
                      {t("plateStatePicker.preferred")}
                    </Text>
                    {preferredOptions.map((state) => {
                      const isSelected = state.code === value;
                      return (
                        <Pressable
                          key={state.code}
                          accessibilityRole="button"
                          accessibilityLabel={t("plateStatePicker.option", {
                            state: state.name,
                            code: state.code,
                          })}
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => selectState(state.code)}
                          style={[
                            styles.option,
                            {
                              backgroundColor: isSelected ? colors.primary : "#ffffff",
                              borderColor: colors.primary,
                            },
                          ]}
                        >
                          <Text style={[styles.optionText, { color: isSelected ? "#ffffff" : "#374151" }]}>
                            {state.name} ({state.code})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {remainingOptions.length > 0 ? (
                  <View>
                    <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
                      {t("plateStatePicker.all")}
                    </Text>
                    {remainingOptions.map((state) => {
                      const isSelected = state.code === value;
                      return (
                        <Pressable
                          key={state.code}
                          accessibilityRole="button"
                          accessibilityLabel={t("plateStatePicker.option", {
                            state: state.name,
                            code: state.code,
                          })}
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => selectState(state.code)}
                          style={[
                            styles.option,
                            {
                              backgroundColor: isSelected ? colors.primary : "#ffffff",
                              borderColor: colors.primary,
                            },
                          ]}
                        >
                          <Text style={[styles.optionText, { color: isSelected ? "#ffffff" : "#374151" }]}>
                            {state.name} ({state.code})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

export default PlateStatePicker;

const styles = StyleSheet.create({
  container: { gap: 6 },
  trigger: {
    alignItems: "center",
    borderRadius: PLATE_STATE_PICKER_VISUALS.pillRadius,
    borderWidth: PLATE_STATE_PICKER_VISUALS.borderWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: PLATE_STATE_PICKER_VISUALS.compactHeight,
    paddingHorizontal: 14,
  },
  triggerText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 16 },
  chevron: { fontSize: 18, marginLeft: 12 },
  error: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 },
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    flex: 1,
    justifyContent: "flex-end",
  },
  dialog: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    maxHeight: "85%",
    padding: 18,
  },
  dialogHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  title: { fontFamily: "Inter_700Bold", fontSize: 20 },
  closeButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  closeText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 15, paddingVertical: 18, textAlign: "center" },
  groupLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, paddingHorizontal: 12, paddingVertical: 8 },
  search: {
    borderRadius: 999,
    borderWidth: 2,
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  options: { marginTop: 12 },
  option: {
    borderBottomWidth: 1,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  optionText: { fontFamily: "Inter_400Regular", fontSize: 16 },
});
