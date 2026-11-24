import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { ModalPressable as Pressable, ModalTextInput as TextInput } from "@/components/ModalDraft";
import { registerAskVControlAliases } from "@/lib/askv-client-tools";

type Props = {
  width: number;
  color: string;
  label: string;
  submitLabel: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
};

/** Native conversion of the web Work Hub home search form. */
export default function WorkHubHomeSearch({ width, color, label, submitLabel, value, onChangeText, onSubmit }: Props) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);
  useEffect(() => registerAskVControlAliases(["/work-hub", "/(tabs)/work-hub"], "search", () => {
    if (!inputRef.current) return false;
    inputRef.current.focus();
    return true;
  }), []);
  return <View accessibilityRole="search" style={{ width, height: 36, borderWidth: focused ? 2 : 1, borderColor: color, borderRadius: 999, backgroundColor: "#303236", overflow: "hidden", flexDirection: "row", alignItems: "center" }}>
    <TextInput ref={inputRef} accessibilityLabel={label} placeholder={label} placeholderTextColor="#a3a3a3" value={value} onChangeText={onChangeText} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSubmitEditing={onSubmit} returnKeyType="search" style={{ height: "100%", minWidth: 0, flex: 1, paddingHorizontal: 12, paddingVertical: 0, color: "#ececec", fontSize: 14 }} />
    <Pressable accessibilityRole="button" accessibilityLabel={submitLabel} onPress={onSubmit} style={{ height: "100%", paddingHorizontal: 12, borderLeftWidth: 1, borderLeftColor: color, justifyContent: "center" }}>
      <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
        <Circle cx={11} cy={11} r={8} />
        <Path d="m21 21-4.35-4.35" />
      </Svg>
    </Pressable>
  </View>;
}
