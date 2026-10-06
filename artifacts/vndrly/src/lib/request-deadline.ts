/** Bounds both network and response-body waits, without retrying an uncertain write. */
export async function withRequestDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal | null; timeoutMs: number; timeoutMessage: string },
): Promise<T> {
  const controller = new AbortController();
  let rejectInterrupted!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject; });
  const cancel = () => {
    const reason = options.signal?.reason ?? new DOMException("Request cancelled", "AbortError");
    rejectInterrupted(reason);
    controller.abort(reason);
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    const error = new Error(options.timeoutMessage);
    error.name = "RequestTimeoutError";
    rejectInterrupted(error);
    controller.abort(error);
  }, options.timeoutMs);
  try {
    if (options.signal?.aborted) {
      cancel();
      return await interrupted;
    }
    return await Promise.race([Promise.resolve().then(() => run(controller.signal)), interrupted]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
