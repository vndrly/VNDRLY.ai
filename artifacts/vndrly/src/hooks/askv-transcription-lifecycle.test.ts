import { afterEach, expect, it, vi } from "vitest";
import { OpenAIRealtimeWebRTC } from "@workspace/askv-realtime-sdk";
import { createTranscriptCleanup } from "@workspace/askv-realtime-sdk/transcript-cleanup";
afterEach(() => vi.unstubAllGlobals());

it("demonstrates that deleting during completed transcription precedes the SDK retrieval", () => {
  vi.stubGlobal("RTCPeerConnection", class {});
  const transport = new OpenAIRealtimeWebRTC();
  const send = vi.fn();
  transport.sendEvent = send;
  transport.on("*", event => {
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      transport.sendEvent({ type: "conversation.item.delete", item_id: String(event.item_id) });
    }
  });
  (transport as any)._onMessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", event_id: "event-test", item_id: "speech-test", content_index: 0, transcript: "First name John", logprobs: null, usage: { type: "duration", seconds: 1 } }) });
  expect(send.mock.calls.map(([event]) => event.type)).toEqual(["conversation.item.delete", "conversation.item.retrieve"]);
});

it("allows the real SDK to retrieve speech before app cleanup deletes it", () => {
  vi.stubGlobal("RTCPeerConnection", class {});
  const transport = new OpenAIRealtimeWebRTC();
  const send = vi.fn();
  transport.sendEvent = send;
  const cleanup = createTranscriptCleanup(event => transport.sendEvent(event));
  transport.on("*", event => {
    cleanup.observe(event);
    if (event.type === "conversation.item.input_audio_transcription.completed") cleanup.queue(String(event.item_id));
  });
  (transport as any)._onMessage({ data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", event_id: "event-test", item_id: "speech-test", content_index: 0, transcript: "First name John", logprobs: null, usage: { type: "duration", seconds: 1 } }) });
  expect(send.mock.calls.map(([event]) => event.type)).toEqual(["conversation.item.retrieve"]);
  (transport as any)._onMessage({ data: JSON.stringify({ type: "conversation.item.retrieved", event_id: "retrieved", item: { id: "speech-test", object: "realtime.item", type: "message", status: "completed", role: "user", content: [{ type: "input_audio", transcript: "First name John" }] } }) });
  expect(send.mock.calls.map(([event]) => event.type)).toEqual(["conversation.item.retrieve", "conversation.item.delete"]);
});
