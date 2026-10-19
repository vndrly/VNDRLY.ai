import React from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useColors } from "@/hooks/useColors";

export function Label({
  children,
  alert = false,
}: {
  children: React.ReactNode;
  alert?: boolean;
}) {
  const colors = useColors();
  return (
    <Text
      accessibilityRole={alert ? "alert" : undefined}
      style={{ color: alert ? colors.destructive : colors.foreground }}
    >
      {children}
    </Text>
  );
}
export function Panel({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {children}
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        {...props}
        style={[
          styles.input,
          { color: colors.foreground, borderColor: colors.border },
        ]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 12 },
  field: { gap: 6 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 44 },
});
