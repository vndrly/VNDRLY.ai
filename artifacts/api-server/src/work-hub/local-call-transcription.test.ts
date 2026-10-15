import { expect, it, vi } from "vitest";
import { LocalCallTranscription } from "./local-call-transcription";
it("flushes short final speech with server speaker identity and deduplicates frames", async () => {
  const process = vi.fn(async () => "hello"), save = vi.fn(async () => {}), authorize = vi.fn(async () => {});
  const session = new LocalCallTranscription(4, process, save, authorize);
  await session.append(0, Buffer.alloc(16000));
  await session.append(0, Buffer.alloc(16000));
  await session.close();
  expect(process).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith({ speakerUserId:4, startsAtMs:0, endsAtMs:500, text:"hello" });
});
it("rejects sequence gaps and discards results when authorization is revoked", async () => {
  const save = vi.fn(async () => {}), authorize = vi.fn(async () => {});
  const session = new LocalCallTranscription(4, async () => { authorize.mockRejectedValue(new Error("revoked")); return "private"; }, save, authorize);
  await expect(session.append(1,Buffer.alloc(16000))).rejects.toThrow("sequence");
  await session.append(0,Buffer.alloc(16000));
  await expect(session.close()).rejects.toThrow("revoked");
  expect(save).not.toHaveBeenCalled();
});
