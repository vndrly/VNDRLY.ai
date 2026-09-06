import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { AskVWakeEvents } from './AskVWake.types';

declare class AskVWakeModule extends NativeModule<AskVWakeEvents> {
  /** Empty modelDirectory selects models bundled with the native app. */
  start(options: { modelDirectory: string }): Promise<void>;
  stop(): Promise<void>;
  /** false hands the same microphone's PCM to the active voice session. */
  setDetectionEnabled(enabled: boolean): Promise<void>;
}

// Expo Go, Android and older installed builds have no native detector.
export default requireOptionalNativeModule<AskVWakeModule>('AskVWake');
