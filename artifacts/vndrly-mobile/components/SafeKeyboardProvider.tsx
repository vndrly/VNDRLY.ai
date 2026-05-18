import React from "react";
import { Platform } from "react-native";

import { isExpoGo } from "@/lib/runtime";

type Props = { children: React.ReactNode };

export default function SafeKeyboardProvider({ children }: Props) {
  if (isExpoGo || Platform.OS === "web") {
    return <>{children}</>;
  }
  const { KeyboardProvider } = require("react-native-keyboard-controller");
  return <KeyboardProvider>{children}</KeyboardProvider>;
}
