import * as Notifications from "expo-notifications";
import * as Location from "expo-location";
import NativeSystem from "../modules/vndrly-system-surfaces/src/VndrlySystemSurfacesModule";
export async function readNativeDeviceReadiness() {
  const [notification, location, background, conditions] = await Promise.all([
    Notifications.getPermissionsAsync(), Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync(),
    typeof NativeSystem?.getDeviceConditions === "function" ? NativeSystem.getDeviceConditions() : Promise.resolve(null),
  ]);
  return { notifications: notification.granted, location: location.granted, backgroundLocation: background.granted,
    lowPower: conditions?.lowPowerMode === true || (conditions?.batteryLevel != null && conditions.batteryLevel >= 0 && conditions.batteryLevel < 0.2),
    backgroundRefresh: conditions?.backgroundRefreshAvailable ?? null };
}
export async function requestNativeLocationPermissions(background: boolean) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.granted && background) return Location.requestBackgroundPermissionsAsync();
  return foreground;
}
