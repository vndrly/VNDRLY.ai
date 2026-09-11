import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("meeting PCM worklet asset", () => {
  it("bounds unacknowledged audio when the main thread stops consuming messages", () => {
    let Processor!: new () => {
      port: { onmessage: ((event: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn> };
      process(inputs: Float32Array[][]): boolean;
    };
    class AudioWorkletProcessorStub {
      port = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn() };
    }
    const registerProcessor = vi.fn((_name: string, constructor: typeof Processor) => { Processor = constructor; });
    const source = readFileSync(resolve(process.cwd(), "public/meeting-pcm-worklet.js"), "utf8");
    new Function("AudioWorkletProcessor", "registerProcessor", source)(AudioWorkletProcessorStub, registerProcessor);
    const processor = new Processor();
    const block = new Float32Array(128);
    let active = true;
    for (let callback = 0; callback < 400 && active; callback += 1) active = processor.process([[block]]);
    const messages = processor.port.postMessage.mock.calls.map(([message]) => message);
    expect(messages.filter((message) => message.type === "audio")).toHaveLength(16);
    expect(messages.at(-1)).toEqual({ type: "overflow" });
    expect(active).toBe(false);
    expect(processor.process([[block]])).toBe(false);
    expect(processor.port.postMessage).toHaveBeenCalledTimes(17);
  });
});
