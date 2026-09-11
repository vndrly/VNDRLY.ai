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
      static createAsync(
        options: unknown,
      ): Promise<{ recording: Recording }>;
      prepareToRecordAsync(options: unknown): Promise<void>;
      startAsync(): Promise<void>;
      stopAndUnloadAsync(): Promise<void>;
      getURI(): string | null;
      getStatusAsync(): Promise<{
        isRecording?: boolean;
        canRecord?: boolean;
      }>;
    }
    class Sound {
      static createAsync(
        source: number | { uri: string; headers?: Record<string, string> },
        initialStatus?: { shouldPlay?: boolean },
        onPlaybackStatusUpdate?: (status: {
          isLoaded: boolean;
          positionMillis?: number;
          didJustFinish?: boolean;
          error?: string;
        }) => void,
      ): Promise<{ sound: Sound }>;
      stopAsync(): Promise<void>;
      playAsync(): Promise<void>;
      pauseAsync(): Promise<void>;
      setPositionAsync(positionMillis: number): Promise<void>;
      unloadAsync(): Promise<void>;
      setOnPlaybackStatusUpdate(
        callback: (status: {
          isLoaded: boolean;
          positionMillis?: number;
          didJustFinish?: boolean;
          error?: string;
        }) => void,
      ): void;
    }
    const RecordingOptionsPresets: { HIGH_QUALITY: unknown };
    function getPermissionsAsync(): Promise<{ status: string }>;
    function requestPermissionsAsync(): Promise<{ status: string }>;
    function setAudioModeAsync(mode: Record<string, unknown>): Promise<void>;
    function createAsync(source: number | { uri: string }): Promise<{ sound: Sound }>;
  }
}
