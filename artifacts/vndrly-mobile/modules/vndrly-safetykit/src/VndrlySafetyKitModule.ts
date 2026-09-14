import { NativeModule, requireOptionalNativeModule } from "expo";
import type { NativeSafetyCapability, VndrlySafetyKitEvents } from "./VndrlySafetyKit.types";

declare class VndrlySafetyKitModule extends NativeModule<VndrlySafetyKitEvents> {
  getCapability(): Promise<NativeSafetyCapability>;
  startMonitoring(): Promise<boolean>;
  stopMonitoring(): Promise<void>;
  openEmergencyDialer(): Promise<void>;
}

export default requireOptionalNativeModule<VndrlySafetyKitModule>("VndrlySafetyKit");
