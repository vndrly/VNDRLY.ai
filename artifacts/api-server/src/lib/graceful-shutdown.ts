type ShutdownOptions = {
  closeServer: (done: (error?: Error) => void) => void;
  closeStreams: () => Promise<void>;
  exit: (code: number) => void;
  onError?: (error: unknown) => void;
};

/** Waits for both HTTP and bounded provider cleanup before permitting exit. */
export async function completeServerShutdown(options: ShutdownOptions) {
  let serverError: unknown;
  const serverClosed = new Promise<void>((resolve) => {
    try {
      options.closeServer((error) => { serverError = error; resolve(); });
    } catch (error) { serverError = error; resolve(); }
  });
  let streamError: unknown;
  const streamsClosed = Promise.resolve().then(options.closeStreams).catch((error) => { streamError = error; });
  await Promise.all([serverClosed, streamsClosed]);
  const error = serverError ?? streamError;
  if (error) options.onError?.(error);
  options.exit(error ? 1 : 0);
}
