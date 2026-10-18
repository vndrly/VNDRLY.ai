import React, { useState } from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import TogglePillButton from "./TogglePillButton";
import { useColors } from "@/hooks/useColors";
export default function FleetChoiceField({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Choose",
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?:string;
}) {
  const colors = useColors(),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  return (
    <View style={{ gap: 8, flexGrow: 1, minWidth: 200 }}>
      <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
      <TogglePillButton
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => {
          setSearch("");
          setOpen(true);
        }}
      >
        {options.find((item) => item.id === value)?.label ?? placeholder} ▾
      </TogglePillButton>
      <Modal visible={open} transparent onRequestClose={() => setOpen(false)}>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: 20,
            backgroundColor: colors.background,
          }}
        >
          <View
            style={{
              borderWidth: 2,
              borderColor: colors.primary,
              borderRadius: 12,
              padding: 16,
              gap: 12,
              backgroundColor: colors.card,
              maxHeight: "90%",
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "700" }}>
              {label}
            </Text>
            <TextInput
              accessibilityLabel={`Search ${label}`}
              placeholder="Search"
              value={search}
              onChangeText={setSearch}
              style={{
                color: colors.text,
                borderWidth: 2,
                borderColor: colors.primary,
                borderRadius: 8,
                padding: 12,
              }}
            />
            <ScrollView contentContainerStyle={{ gap: 10 }}>
              {options
                .filter((item) =>
                  item.label.toLowerCase().includes(search.toLowerCase()),
                )
                .map((item) => (
                  <TogglePillButton
                    key={item.id}
                    accessibilityLabel={item.label}
                    onPress={() => {
                      onChange(item.id);
                      setOpen(false);
                    }}
                  >
                    {item.label}
                  </TogglePillButton>
                ))}
            </ScrollView>
            <TogglePillButton onPress={() => setOpen(false)}>
              Cancel
            </TogglePillButton>
          </View>
        </View>
      </Modal>
    </View>
  );
}
