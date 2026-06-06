declare module "expo-av" {
  export enum InterruptionModeIOS {
    MixWithOthers = 0,
    DoNotMix = 1,
    DuckOthers = 2,
  }

  export enum InterruptionModeAndroid {
    DoNotMix = 1,
    DuckOthers = 2,
  }

  export namespace Audio {
    class Recording {
      prepareToRecordAsync(options: unknown): Promise<void>;
      startAsync(): Promise<void>;
      stopAndUnloadAsync(): Promise<void>;
      getURI(): string | null;
    }
    class Sound {
      playAsync(): Promise<void>;
      unloadAsync(): Promise<void>;
    }
    const RecordingOptionsPresets: { HIGH_QUALITY: unknown };
    function getPermissionsAsync(): Promise<{ status: string }>;
    function requestPermissionsAsync(): Promise<{ status: string }>;
    function setAudioModeAsync(mode: Record<string, unknown>): Promise<void>;
    function createAsync(source: { uri: string }): Promise<{ sound: Sound }>;
  }
}
