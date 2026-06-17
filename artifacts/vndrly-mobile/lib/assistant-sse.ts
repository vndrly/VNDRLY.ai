export type StreamEvent =
  | { type: "token"; delta: string }
  | { type: "tool"; name: string; status: "start" | "end" }
  | { type: "done"; content: string }
  | { type: "error"; message: string };

export type SseConsumeResult = {
  receivedDone: boolean;
  receivedError: boolean;
};

function dispatchSseBlock(raw: string, onEvent: (evt: StreamEvent) => void): void {
  const lines = raw.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }
  if (eventName === "token") {
    onEvent({ type: "token", delta: (parsed as { delta: string }).delta });
  } else if (eventName === "tool") {
    onEvent({
      type: "tool",
      ...(parsed as { name: string; status: "start" | "end" }),
    });
  } else if (eventName === "done") {
    onEvent({ type: "done", content: (parsed as { content: string }).content });
  } else if (eventName === "error") {
    onEvent({ type: "error", message: (parsed as { message: string }).message });
  }
}

function consumeSseBuffer(
  buffer: string,
  onEvent: (evt: StreamEvent) => void,
): { remainder: string; result: SseConsumeResult } {
  let remainder = buffer;
  const result: SseConsumeResult = { receivedDone: false, receivedError: false };

  let idx: number;
  while ((idx = remainder.indexOf("\n\n")) !== -1) {
    const raw = remainder.slice(0, idx);
    remainder = remainder.slice(idx + 2);
    dispatchSseBlock(raw, (evt) => {
      if (evt.type === "done") result.receivedDone = true;
      if (evt.type === "error") result.receivedError = true;
      onEvent(evt);
    });
  }

  return { remainder, result };
}

/** Parse SSE blocks from a complete response body (RN fetch fallback). */
export function consumeAssistantSseFromText(
  text: string,
  onEvent: (evt: StreamEvent) => void,
): SseConsumeResult {
  const result: SseConsumeResult = { receivedDone: false, receivedError: false };
  const blocks = text.split("\n\n");
  for (const raw of blocks) {
    if (!raw.trim()) continue;
    dispatchSseBlock(raw, (evt) => {
      if (evt.type === "done") result.receivedDone = true;
      if (evt.type === "error") result.receivedError = true;
      onEvent(evt);
    });
  }
  return result;
}

/** Parse SSE from a fetch POST response (EventSource cannot POST). */
export async function consumeAssistantSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (evt: StreamEvent) => void,
): Promise<SseConsumeResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const result: SseConsumeResult = { receivedDone: false, receivedError: false };

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeSseBuffer(buffer, onEvent);
    buffer = parsed.remainder;
    if (parsed.result.receivedDone) result.receivedDone = true;
    if (parsed.result.receivedError) result.receivedError = true;
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const flushed = consumeSseBuffer(`${buffer}\n\n`, onEvent);
    if (flushed.result.receivedDone) result.receivedDone = true;
    if (flushed.result.receivedError) result.receivedError = true;
  }

  return result;
}

function bodySupportsStreaming(body: unknown): body is ReadableStream<Uint8Array> {
  return (
    body != null &&
    typeof body === "object" &&
    typeof (body as ReadableStream<Uint8Array>).getReader === "function"
  );
}

/** React Native (iOS/Android) exposes getReader but still buffers the full SSE body. */
export function prefersBufferedAssistantSse(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.product === "ReactNative"
  );
}

/** Read an assistant SSE response, with a buffered fallback when streaming is unavailable. */
export async function readAssistantStreamResponse(
  res: Response,
  signal: AbortSignal,
  onEvent: (evt: StreamEvent) => void,
): Promise<SseConsumeResult> {
  if (!prefersBufferedAssistantSse() && bodySupportsStreaming(res.body)) {
    return consumeAssistantSse(res.body, signal, onEvent);
  }
  const text = await res.text();
  return consumeAssistantSseFromText(text, onEvent);
}

export async function readAssistantErrorMessage(res: Response): Promise<string> {
  const fallback = `HTTP ${res.status}`;
  try {
    const data = (await res.clone().json()) as {
      message?: string;
      error?: string;
      code?: string;
    };
    return data.message || data.error || fallback;
  } catch {
    try {
      const text = (await res.clone().text()).trim();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}
