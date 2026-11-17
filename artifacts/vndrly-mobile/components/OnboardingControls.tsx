import React from "react";
import {
  Text,
  TextInput,
  Pressable,
  View,
  type TextProps,
  type TextInputProps,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from '@expo/vector-icons';
export function OnboardingText({ style, ...props }: TextProps) {
  const colors = useColors();
  return <Text {...props} style={[{ color: colors.text }, style]} />;
}
export function OnboardingInput({ style, ...props }: TextInputProps) {
  const colors = useColors();
  return (
    <TextInput
      placeholderTextColor={colors.mutedForeground}
      {...props}
      style={[
        {
          color: colors.text,
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 10,
          minHeight: 44,
          minWidth: 0,
          maxWidth: "100%",
        },
        style,
      ]}
    />
  );
}

export function BrandedOnboardingField({ label, ...props }: TextInputProps & { label: string }) {
  const { primary } = useColors();
  return (
    <View style={{ gap: 6, minWidth: 0, maxWidth: "100%" }}>
      <Text style={{ color: "#fff", fontSize: 12 }}>{label}</Text>
      <OnboardingInput
        {...props}
        accessibilityLabel={label}
        style={{ backgroundColor: "#303034", borderColor: primary, borderRadius: 9999, paddingHorizontal: 12 }}
      />
    </View>
  );
}

export function BrandedOnboardingSelect({label, value, onPress, testID, expanded}: {
  label: string; value: string; onPress: () => void; testID?: string; expanded?: boolean;
}) {
  const {primary} = useColors();
  return <View style={{gap:6,minWidth:0,maxWidth:'100%'}}>
    <Text style={{color:'#fff',fontSize:12}}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{expanded}}
      onPress={onPress} testID={testID} style={{minWidth:0,maxWidth:'100%',minHeight:44,borderWidth:1,borderColor:primary,
        borderRadius:9999,backgroundColor:'#303034',paddingVertical:10,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:8}}>
      <Text numberOfLines={2} style={{flex:1,minWidth:0,color:'#ececec',fontSize:14,lineHeight:20}}>{value}</Text>
      <Feather name="chevron-down" size={16} color={primary}/>
    </Pressable>
  </View>;
}
