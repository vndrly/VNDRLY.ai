import React from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useBrand } from "@/hooks/use-brand";
import { useColors } from "@/hooks/useColors";

export default function TicketWorkAction({ label, icon, active, disabled, loading, onPress, testID }: {
  label: string; icon: React.ComponentProps<typeof Feather>["name"];
  active?: boolean; disabled?: boolean; loading?: boolean;
  onPress: () => void; testID: string;
}) {
  const brand = useBrand();
  const colors = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
    testID={testID} disabled={disabled || loading} onPress={onPress}
    style={({pressed}) => ({ flexDirection: "row", alignItems: "center", gap: 7,
      minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2,
      borderColor: disabled ? colors.border : brand.primary,
      backgroundColor: active ? `${brand.primary}28` : colors.card,
      opacity: disabled ? 0.5 : pressed ? 0.75 : 1 })}>
    {loading ? <ActivityIndicator size="small" color={brand.primary}/> : <Feather name={icon} size={18} color={disabled ? colors.mutedForeground : brand.primary}/>}
    <Text style={{color:colors.foreground,fontFamily:"Inter_600SemiBold",fontSize:13}}>{label}</Text>
  </Pressable>;
}
