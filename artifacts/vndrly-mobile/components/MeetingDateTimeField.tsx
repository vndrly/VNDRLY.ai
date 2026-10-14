import React, { useState } from "react";
import { Platform, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import TogglePillButton from "./TogglePillButton";
import { useColors } from "@/hooks/useColors";
export default function MeetingDateTimeField({
  mode,
  label,
  value,
  onChange,
}: {
  mode: "date" | "time";
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const colors = useColors(),
    [open, setOpen] = useState(false);
  const date = new Date();
  if (mode === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    date.setFullYear(y, m - 1, d);
  }
  if (mode === "time" && /^\d{2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(":").map(Number);
    date.setHours(h, m, 0, 0);
  }
  return (
    <View style={{ gap: 6, flex: 1 }}>
      <Text style={{ color: colors.text }}>{label}</Text>
      {Platform.OS === "web" ? (
        React.createElement("input", {
          type: mode,
          value,
          "aria-label": label,
          onInput: (e: React.FormEvent<HTMLInputElement>) =>
            onChange(e.currentTarget.value),
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value),
          style: {
            width: "100%",
            boxSizing: "border-box",
            border: `2px solid ${colors.primary}`,
            borderRadius: 10,
            padding: 12,
            color: colors.text,
            backgroundColor: colors.card,
            colorScheme: "dark",
            fontSize: 16,
          },
        })
      ) : (
        <>
          <TogglePillButton
            color="brand"
            accessibilityLabel={label}
            onPress={() => setOpen((v) => !v)}
          >
            {value || label}
          </TogglePillButton>
          {open && (
            <DateTimePicker
              mode={mode}
              value={date}
              onChange={(_, selected) => {
                setOpen(false);
                if (selected)
                  onChange(
                    mode === "date"
                      ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}`
                      : `${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`,
                  );
              }}
            />
          )}
        </>
      )}
    </View>
  );
}
