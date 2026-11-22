import type React from "react";
import type {
  GestureResponderEvent,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import TogglePillButton from "./TogglePillButton";

export interface BluePillButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
  height?: number;
}

/** Compatibility export for the shared native minicard action. */
export default function BluePillButton(props: BluePillButtonProps) {
  return <TogglePillButton {...props} color="blue" />;
}
