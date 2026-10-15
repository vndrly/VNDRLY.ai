import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { type LibraryDelivery } from "@workspace/api-zod";
import { useTranslation } from "react-i18next";
import { useColors } from "@/hooks/useColors";
import OptionSwitch from "./OptionSwitch";
export default function DeliveryEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: LibraryDelivery;
  onChange: (value: LibraryDelivery) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(),
    colors = useColors(),
    [clock, setClock] = useState(
      `${String(value.briefing.hour).padStart(2, "0")}:${String(value.briefing.minute).padStart(2, "0")}`,
    ),
    label = { color: colors.text },
    field = {
      ...label,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 10,
      padding: 12,
    };
  return (
    <View
      style={{
        gap: 12,
        borderWidth: 2,
        borderColor: colors.primary,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <Text style={{ ...label, fontWeight: "700" }}>
        {t("workHubLibrary.remindersBriefings")}
      </Text>
      <OptionSwitch
        label={t("workHubLibrary.remindOutstanding")}
        value={value.reminderHours !== null}
        disabled={disabled}
        onChange={(enabled) =>
          onChange({ ...value, reminderHours: enabled ? 24 : null })
        }
      />
      {value.reminderHours !== null && (
        <TextInput
          accessibilityLabel={t("workHubLibrary.reminderHours")}
          value={String(value.reminderHours)}
          editable={!disabled}
          keyboardType="numeric"
          onChangeText={(v) => onChange({ ...value, reminderHours: Number(v) })}
          style={field}
        />
      )}
      <OptionSwitch
        label={t("workHubLibrary.dailyOwnerBrief")}
        value={value.briefing.enabled}
        disabled={disabled}
        onChange={(enabled) =>
          onChange({ ...value, briefing: { ...value.briefing, enabled } })
        }
      />
      {value.briefing.enabled && (
        <>
          <Text style={label}>{t("workHubLibrary.briefingTime")}</Text>
          <TextInput
            accessibilityLabel={t("workHubLibrary.briefingTime")}
            placeholder="HH:mm"
            value={clock}
            editable={!disabled}
            onChangeText={(v) => {
              setClock(v);
              const parts = v.match(/^(\d{2}):(\d{2})$/);
              onChange({
                ...value,
                briefing: {
                  ...value.briefing,
                  hour: parts ? Number(parts[1]) : NaN,
                  minute: parts ? Number(parts[2]) : NaN,
                },
              });
            }}
            style={field}
          />
          <OptionSwitch
            label={t("workHubLibrary.pushBriefing")}
            value={value.briefing.push}
            disabled={disabled}
            onChange={(push) =>
              onChange({ ...value, briefing: { ...value.briefing, push } })
            }
          />
        </>
      )}
      <OptionSwitch
        label={t("workHubLibrary.escalateOverdue")}
        value={value.escalationHours !== null}
        disabled={disabled}
        onChange={(enabled) =>
          onChange({ ...value, escalationHours: enabled ? 24 : null })
        }
      />
      {value.escalationHours !== null && (
        <TextInput
          accessibilityLabel={t("workHubLibrary.escalationHours")}
          value={String(value.escalationHours)}
          editable={!disabled}
          keyboardType="numeric"
          onChangeText={(v) =>
            onChange({ ...value, escalationHours: Number(v) })
          }
          style={field}
        />
      )}
    </View>
  );
}
