declare module "expo-av" {
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
    function requestPermissionsAsync(): Promise<{ status: string }>;
    function setAudioModeAsync(mode: Record<string, unknown>): Promise<void>;
    function createAsync(source: { uri: string }): Promise<{ sound: Sound }>;
  }
}
