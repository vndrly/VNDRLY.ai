import React from "react";
import { Platform, View } from "react-native";

import { isExpoGo } from "@/lib/runtime";

type Props = { children: React.ReactNode };

export default function SafeKeyboardProvider({ children }: Props) {
  if (isExpoGo || Platform.OS === "web") {
    return <>{children}</>;
  }
  try {
    const { KeyboardProvider } = require("react-native-keyboard-controller");
    return (
      <KeyboardProvider>
        <View style={{ flex: 1 }}>{children}</View>
      </KeyboardProvider>
    );
  } catch {
    return <View style={{ flex: 1 }}>{children}</View>;
  }
}
