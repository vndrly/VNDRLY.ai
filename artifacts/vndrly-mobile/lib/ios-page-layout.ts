import { Platform } from "react-native";

/** Include the local iOS web preview, without changing Android or hosted web. */
export const iosPageLayout = Platform.OS === "ios" ||
  (Platform.OS === "web" && typeof window !== "undefined" && window.location.hostname === "localhost");
