import { describe, expect, it } from "vitest";
import { MeetingPcmBatcher } from "./meeting-pcm";

function samples(count: number, value: number) { return Float32Array.from({ length: count }, () => value); }
function decodedRms(frame: Uint8Array, skip = 0) {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let sum = 0; let count = 0;
  for (let offset = skip * 2; offset < frame.byteLength; offset += 2) { const value = view.getInt16(offset, true); sum += value * value; count += 1; }
  return Math.sqrt(sum / count);
}

describe("meeting PCM conversion", () => {
  it("clamps float samples into little-endian signed PCM16", () => {
    const batcher = new MeetingPcmBatcher(16_000, 50);
    const input = samples(800, 0); input.set([-2, -1, -0.5, 0, 0.5, 1, 2]);
    const [frame] = batcher.push(input);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(Array.from({ length: 7 }, (_, index) => view.getInt16(index * 2, true))).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767]);
  });

  it("downsamples 48kHz to 16kHz and preserves continuity across callbacks", () => {
    const source = Float32Array.from({ length: 4_800 }, (_, index) => Math.sin(index / 37));
    const whole = new MeetingPcmBatcher(48_000, 50).push(source);
    const splitBatcher = new MeetingPcmBatcher(48_000, 50);
    const split = [source.slice(0, 701), source.slice(701, 2_333), source.slice(2_333)].flatMap((chunk) => splitBatcher.push(chunk));
    expect(split).toHaveLength(whole.length);
    expect(Array.from(split[0])).toEqual(Array.from(whole[0]));
    expect(Array.from(split[1])).toEqual(Array.from(whole[1]));
  });

  it("preserves the audible pass band while attenuating above-Nyquist input before decimation", () => {
    const sine = (frequency: number) => Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(2 * Math.PI * frequency * index / 48_000));
    const [audible] = new MeetingPcmBatcher(48_000, 1_000).push(sine(1_000));
    const [aboveNyquist] = new MeetingPcmBatcher(48_000, 1_000).push(sine(12_000));
    const audibleRms = decodedRms(audible, 100);
    expect(audibleRms).toBeGreaterThan(18_000);
    expect(decodedRms(aboveNyquist, 100)).toBeLessThan(audibleRms * 0.05);
  });

  it("retains a short tail until it reaches the provider's 50ms minimum", () => {
    const batcher = new MeetingPcmBatcher(16_000);
    expect(batcher.push(samples(1_000, 0))).toEqual([]);
    expect(batcher.flush()).toHaveLength(2_000);
    const tooShort = new MeetingPcmBatcher(16_000); tooShort.push(samples(799, 0));
    expect(tooShort.flush()).toBeNull();
  });
});
