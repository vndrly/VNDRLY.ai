import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { isExpoGo } from "./runtime";

const taskName = "vndrly-fast-pass-location";
const bindingKey = "vndrly.fast-pass.location";

async function retireFastPassLocation() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(taskName)) {
      await Location.stopLocationUpdatesAsync(taskName);
    }
  } finally {
    await SecureStore.deleteItemAsync(bindingKey);
  }
}

if (Platform.OS !== "web" && !isExpoGo && !TaskManager.isTaskDefined(taskName)) {
  // Older installs can wake this task before the app UI mounts.
  TaskManager.defineTask(taskName, () => retireFastPassLocation().catch(() => undefined));
  void retireFastPassLocation().catch(() => undefined);
}
