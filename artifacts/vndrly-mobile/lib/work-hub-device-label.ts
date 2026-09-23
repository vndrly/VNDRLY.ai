import * as Device from "expo-device";
import { Platform } from "react-native";

export function workHubDeviceLabel() {
  if (Platform.OS === "web") return "Browser preview";
  const model = Device.modelName?.trim();
  if (model) return model;
  if (Platform.OS === "ios") return "iPhone or iPad";
  if (Platform.OS === "android") return "Android device";
  return "Mobile device";
}

export function workHubDeviceClass() {
  if (Platform.OS === "web") return "desktop";
  return Device.deviceType === Device.DeviceType.TABLET ? "tablet" : "phone";
}
