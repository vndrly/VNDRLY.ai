export type StreamEvent =
  | { type: "token"; delta: string }
  | { type: "tool"; name: string; status: "start" | "end" }
  | { type: "done"; content: string }
  | { type: "error"; message: string };

/** Parse SSE from a fetch POST response (EventSource cannot POST). */
export async function consumeAssistantSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (evt: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = raw.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
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
  }
}
