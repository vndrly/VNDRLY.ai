export type AskVAudioEvent = { samples: number[]; sampleRate: 16000 };
export type AskVWakeEvent = AskVAudioEvent & { keyword: string };
export type AskVWakeEvents = {
  onWake: (event: AskVWakeEvent) => void;
  onAudio: (event: AskVAudioEvent) => void;
  onError: (event: { code: string }) => void;
  /** Reported whether or not the local microphone is running. */
  onAudioInterruption: (event: { phase: "began" | "ended" | "reset" }) => void;
};
