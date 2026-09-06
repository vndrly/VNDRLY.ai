import { askVMicrophone } from "@workspace/askv-wake";
export type GateSpeechResult = {
  [index: number]: { transcript: string };
  isFinal?: boolean;
};

export type GateSpeechResultEvent = {
  resultIndex?: number;
  results: {
    [index: number]: GateSpeechResult;
    length: number;
  };
};

export type GateSpeechErrorEvent = { error?: string };

export type GateSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart?: (() => void) | null;
  onresult: ((event: GateSpeechResultEvent) => void) | null;
  onerror: ((event: GateSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RestartHandle = ReturnType<typeof setTimeout>;

type GateSpeechSessionOptions = {
  createRecognition: () => GateSpeechRecognition | null;
  onTranscript: (transcript: string) => void;
  onListeningChange: (listening: boolean) => void;
  onError: (code: string) => void;
  scheduleRestart?: (callback: () => void) => RestartHandle;
  cancelRestart?: (handle: RestartHandle) => void;
};

export type GateSpeechSession = {
  dispose: () => Promise<void>;
  isListening: () => boolean;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
};

const FATAL_ERRORS = new Set([
  "audio-capture",
  "not-allowed",
  "service-not-allowed",
]);

/** Continuous browser recognition sharing the same microphone lease as AskV. */
export function createGateSpeechSession(
  options: GateSpeechSessionOptions,
): GateSpeechSession {
  type Active = {
    recognition: GateSpeechRecognition;
    ended: Promise<void>;
    resolveEnd: () => void;
    stopping: boolean;
  };
  const scheduleRestart =
    options.scheduleRestart ??
    ((callback: () => void) => setTimeout(callback, 250));
  const cancelRestart = options.cancelRestart ?? clearTimeout;
  let desired = false;
  let disposed = false;
  let listening = false;
  let generation = 0;
  let active: Active | null = null;
  let starting: Promise<void> | null = null;
  let restartHandle: RestartHandle | null = null;
  let releaseLease: (() => Promise<void>) | null = null;

  const publishListening = (next: boolean) => {
    if (listening === next) return;
    listening = next;
    options.onListeningChange(next);
  };
  const cancelPendingRestart = () => {
    if (restartHandle !== null) cancelRestart(restartHandle);
    restartHandle = null;
  };
  const releaseOwnership = async () => {
    const release = releaseLease;
    releaseLease = null;
    if (release) await release();
  };
  const stopCapture = async () => {
    if (desired) generation++;
    desired = false;
    cancelPendingRestart();
    publishListening(false);
    const current = active;
    if (!current) return;
    current.stopping = true;
    current.recognition.onresult = null;
    current.recognition.onerror = null;
    try {
      if (current.recognition.abort) current.recognition.abort();
      else current.recognition.stop();
    } catch {
      // A recognizer that never started may throw InvalidStateError. Its late
      // onstart handler still aborts it; do not launch another capture until end.
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        current.ended,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error("The microphone has not finished stopping.")),
            2000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  const start = async (requestGeneration: number) => {
    try {
      const release = await askVMicrophone.acquire("gate", stopCapture);
      if (disposed || !desired || generation !== requestGeneration) {
        await release();
        return;
      }
      releaseLease = release;
      const recognition = options.createRecognition();
      if (!recognition) {
        desired = false;
        options.onError("unavailable");
        await releaseOwnership();
        return;
      }
      let resolveEnd!: () => void;
      const current: Active = {
        recognition,
        ended: new Promise<void>((resolve) => {
          resolveEnd = resolve;
        }),
        resolveEnd: () => resolveEnd(),
        stopping: false,
      };
      active = current;
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognition.onstart = () => {
        if (
          disposed ||
          !desired ||
          generation !== requestGeneration ||
          current.stopping
        ) {
          try {
            if (recognition.abort) recognition.abort();
            else recognition.stop();
          } catch {
            /* End handler retains ownership until stopped. */
          }
          return;
        }
        publishListening(true);
      };
      recognition.onresult = (event) => {
        if (!desired || disposed || active !== current || current.stopping)
          return;
        const parts: string[] = [];
        for (
          let i = Math.max(0, event.resultIndex ?? 0);
          i < event.results.length;
          i++
        ) {
          const result = event.results[i];
          if (result.isFinal !== false && result[0]?.transcript?.trim())
            parts.push(result[0].transcript.trim());
        }
        if (parts.length) options.onTranscript(parts.join(" "));
      };
      recognition.onerror = (event) => {
        const code = event.error ?? "recognition-failed";
        if (code === "no-speech" || code === "aborted") return;
        options.onError(code);
        if (FATAL_ERRORS.has(code))
          void stop().catch(() => options.onError("stop-failed"));
      };
      recognition.onend = () => {
        current.resolveEnd();
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        if (active !== current) return;
        active = null;
        publishListening(false);
        const restart = desired && !disposed && !current.stopping;
        desired = false;
        const endedGeneration = generation;
        // Release is queued without awaiting inside the coordinator's callback.
        void releaseOwnership()
          .then(() => {
            if (
              !restart ||
              disposed ||
              generation !== endedGeneration ||
              askVMicrophone.owner !== null
            )
              return;
            desired = true;
            restartHandle = scheduleRestart(() => {
              restartHandle = null;
              if (desired && !disposed && generation === endedGeneration)
                void beginStart();
            });
          })
          .catch(() => {
            if (!disposed) options.onError("stop-failed");
          });
      };
      try {
        recognition.start();
      } catch {
        active = null;
        current.resolveEnd();
        desired = false;
        publishListening(false);
        options.onError("start-failed");
        await releaseOwnership();
      }
    } catch {
      desired = false;
      publishListening(false);
      if (!disposed) options.onError("start-failed");
      try {
        await releaseOwnership();
      } catch {
        if (!disposed) options.onError("stop-failed");
      }
    }
  };
  const beginStart = async () => {
    const task = start(generation);
    starting = task;
    try {
      await task;
    } finally {
      if (starting === task) starting = null;
    }
  };
  const stop = async () => {
    generation++;
    desired = false;
    try {
      await stopCapture();
      await releaseOwnership();
    } catch {
      // Keep the coordinator's owner until onend confirms capture has stopped.
      // Public UI cleanup is fire-and-forget, so report without rejecting it.
      if (!disposed) options.onError("stop-failed");
    }
  };
  return {
    dispose: async () => {
      disposed = true;
      await stop();
    },
    isListening: () => listening,
    stop,
    toggle: async () => {
      if (disposed) return;
      if (active || starting) {
        await stop();
        return;
      }
      // An ended recognizer is visibly stopped while its restart is queued.
      // A fresh click starts it now instead of cancelling the user's new request.
      cancelPendingRestart();
      desired = true;
      generation++;
      await beginStart();
    },
  };
}
