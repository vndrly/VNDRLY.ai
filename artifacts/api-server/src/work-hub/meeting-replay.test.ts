import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  MeetingReplayError,
  buildReplayManifest,
  validateReplayChunk,
  type ReplayManifestInput,
} from "./meeting-replay";

const sha = (body: Buffer) => createHash("sha256").update(body).digest("hex");
function pcmWav(durationMs: number, options: { sampleRate?: number; truncate?: number } = {}) {
  const sampleRate = options.sampleRate ?? 16_000;
  const sampleCount = Math.round(sampleRate * durationMs / 1_000);
  const dataSize = sampleCount * 2;
  const body = Buffer.alloc(44 + dataSize);
  body.write("RIFF", 0); body.writeUInt32LE(body.length - 8, 4); body.write("WAVE", 8);
  body.write("fmt ", 12); body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22);
  body.writeUInt32LE(sampleRate, 24); body.writeUInt32LE(sampleRate * 2, 28); body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34);
  body.write("data", 36); body.writeUInt32LE(dataSize, 40);
  return options.truncate ? body.subarray(0, body.length - options.truncate) : body;
}

describe("meeting replay audio chunks", () => {
  it("accepts a bounded audio chunk with a matching checksum", () => {
    const body = pcmWav(500);
    expect(validateReplayChunk({
      operationId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb01",
      chunkId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb02",
      sequence: 0,
      startsAtMs: 0,
      endsAtMs: 500,
      contentType: "audio/wav",
      claimedSha256: sha(body),
      body,
    })).toMatchObject({ sequence: 0, startsAtMs: 0, endsAtMs: 500, durationMs: 500, sampleRate: 16_000, channelCount: 1, bitsPerSample: 16, sampleCount: 8_000, byteSize: body.length, sha256: sha(body), contentType: "audio/wav" });
  });

  it.each([
    ["literal bytes", Buffer.from("audio bytes"), 500],
    ["truncated wave", pcmWav(500, { truncate: 2 }), 500],
    ["forged duration", pcmWav(500), 5_000],
  ])("rejects %s even when its checksum matches", (_name, body, endsAtMs) => {
    expect(() => validateReplayChunk({
      operationId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb01", chunkId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb02",
      sequence: 0, startsAtMs: 0, endsAtMs, contentType: "audio/wav", claimedSha256: sha(body), body,
    })).toThrow(MeetingReplayError);
  });

  it.each([
    ["bad checksum", { claimedSha256: "0".repeat(64) }],
    ["oversized chunk", { body: Buffer.alloc(5 * 1024 * 1024 + 1) }],
    ["long chunk", { endsAtMs: 30_001 }],
    ["negative offset", { startsAtMs: -1 }],
    ["empty range", { startsAtMs: 100, endsAtMs: 100 }],
    ["unsupported codec", { contentType: "audio/mpeg" }],
  ])("rejects %s before storage", (_name, override) => {
    const body = "body" in override ? override.body as Buffer : pcmWav(500);
    expect(() => validateReplayChunk({
      operationId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb01",
      chunkId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb02",
      sequence: 0,
      startsAtMs: 0,
      endsAtMs: 500,
      contentType: "audio/wav",
      claimedSha256: sha(body),
      body,
      ...override,
    })).toThrow(MeetingReplayError);
  });
});

function baseManifest(override: Partial<ReplayManifestInput> = {}): ReplayManifestInput {
  return {
    occurrenceId: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb10",
    meetingStartedAt: new Date("2026-09-09T12:00:00.000Z"),
    meetingStatus: "ended",
    manifestStatus: "finalized",
    rendererVersion: 1,
    schemaVersion: 2,
    durationMs: 20_000,
    chunks: [
      { id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb11", sequence: 0, startsAtMs: 0, endsAtMs: 10_000, durationMs: 10_000, sampleRate: 16_000, channelCount: 1, bitsPerSample: 16, sampleCount: 160_000, contentType: "audio/wav", byteSize: 100, sha256: "a".repeat(64), state: "ready" },
      { id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb12", sequence: 1, startsAtMs: 12_000, endsAtMs: 20_000, durationMs: 8_000, sampleRate: 16_000, channelCount: 1, bitsPerSample: 16, sampleCount: 128_000, contentType: "audio/wav", byteSize: 80, sha256: "b".repeat(64), state: "ready" },
    ],
    events: [
      { eventKey: "message:1", eventType: "message", offsetMs: 3_000, payload: { displayName: "Susie", body: "Shared update", private: false, recipientUserId: null, storageKey: "/secret", providerArtifactId: "provider" } },
      { eventKey: "speaker:1", eventType: "speaker", offsetMs: 1_000, endOffsetMs: 2_000, payload: { displayName: "Bob", state: "speaking", userId: 99 } },
      { eventKey: "private:1", eventType: "message", offsetMs: 4_000, payload: { displayName: "Bob", body: "PRIVATE", private: true } },
      { eventKey: "file:1", eventType: "file", offsetMs: 5_000, payload: { displayName: "Mike", fileName: "receipt.pdf", contentType: "application/pdf", byteSize: 123, downloadPath: "/safe/path", storageKey: "/secret" } },
    ],
    explicitGaps: [{ startsAtMs: 10_000, endsAtMs: 12_000, reason: "recorder_interruption" }],
    ...override,
  };
}

describe("shared timed replay manifest", () => {
  it("normalizes shared events on the meeting clock and exposes no private or storage metadata", () => {
    const manifest = buildReplayManifest(baseManifest());
    expect(manifest).toMatchObject({
      status: "incomplete",
      complete: false,
      occurrence: { startedAt: "2026-09-09T12:00:00.000Z", durationMs: 20_000 },
      rendererVersion: 1,
      schemaVersion: 2,
      storage: { audioBytes: 180, audioChunkCount: 2 },
      gaps: [{ startsAtMs: 10_000, endsAtMs: 12_000, reason: "recorder_interruption" }],
    });
    expect(manifest.events.map((event) => event.type)).toEqual(["message", "file"]);
    expect(JSON.stringify(manifest)).not.toMatch(/PRIVATE|recipientUserId|storageKey|providerArtifactId|userId/);
    expect(manifest.audio[0]).toMatchObject({ sequence: 0, downloadPath: expect.stringContaining("/replay/audio/") });
  });

  it("marks continuous ended audio complete and cancelled recordings incomplete", () => {
    const continuous = baseManifest({
      chunks: [{ id: "17795fa1-bb5f-4abc-a5f8-7e9b33a0eb11", sequence: 0, startsAtMs: 0, endsAtMs: 20_000, durationMs: 20_000, sampleRate: 16_000, channelCount: 1, bitsPerSample: 16, sampleCount: 320_000, contentType: "audio/wav", byteSize: 200, sha256: "a".repeat(64), state: "ready" }],
      explicitGaps: [],
    });
    expect(buildReplayManifest(continuous).status).toBe("complete");
    expect(buildReplayManifest({ ...continuous, meetingStatus: "cancelled" }).status).toBe("incomplete");
  });

  it("derives missing-audio gaps and rejects overlapping, duplicate, or non-monotonic chunks", () => {
    const manifest = buildReplayManifest(baseManifest({ explicitGaps: [] }));
    expect(manifest.gaps).toEqual([{ startsAtMs: 10_000, endsAtMs: 12_000, reason: "missing_audio" }]);
    for (const chunks of [
      [baseManifest().chunks[0], { ...baseManifest().chunks[1], sequence: 0 }],
      [baseManifest().chunks[0], { ...baseManifest().chunks[1], startsAtMs: 9_000 }],
      [{ ...baseManifest().chunks[0], state: "pending" as const }],
    ]) expect(() => buildReplayManifest(baseManifest({ chunks, explicitGaps: [] }))).toThrow(MeetingReplayError);
  });

  it("rejects live retrieval, invalid versions, excessive events, and offsets beyond duration", () => {
    expect(() => buildReplayManifest(baseManifest({ meetingStatus: "live" }))).toThrow(/ended/i);
    expect(() => buildReplayManifest(baseManifest({ rendererVersion: 0 }))).toThrow(/version/i);
    expect(() => buildReplayManifest(baseManifest({ rendererVersion: 2 }))).toThrow(/version/i);
    expect(() => buildReplayManifest(baseManifest({ schemaVersion: 3 }))).toThrow(/version/i);
    expect(() => buildReplayManifest(baseManifest({ events: [{ eventKey: "late", eventType: "message", offsetMs: 20_001, payload: { displayName: "Bob", body: "late", messageType: "typed" } }] }))).toThrow(/duration/i);
    const event = { eventKey: "x", eventType: "activity" as const, offsetMs: 1, payload: { displayName: "Bob", state: "typing" } };
    expect(() => buildReplayManifest(baseManifest({ events: Array.from({ length: 10_001 }, (_, index) => ({ ...event, eventKey: String(index), offsetMs: index })) }))).toThrow(/events/i);
  });

  it("keeps explicit gaps deterministic and rejects contradictory or overlapping gap markers", () => {
    const input = baseManifest({ explicitGaps: [
      { startsAtMs: 10_000, endsAtMs: 11_000, reason: "upload_failed" },
      { startsAtMs: 11_000, endsAtMs: 12_000, reason: "reconnect" },
    ] });
    expect(buildReplayManifest(input).gaps).toEqual(input.explicitGaps);
    expect(() => buildReplayManifest(baseManifest({ explicitGaps: [
      { startsAtMs: 9_000, endsAtMs: 11_000, reason: "upload_failed" },
      { startsAtMs: 10_000, endsAtMs: 12_000, reason: "reconnect" },
    ] }))).toThrow(/gap/i);
  });

  it("does not let a partial explicit marker hide the rest of a missing-audio range", () => {
    const manifest = buildReplayManifest(baseManifest({ explicitGaps: [
      { startsAtMs: 10_000, endsAtMs: 11_000, reason: "upload_failed" },
    ] }));
    expect(manifest.gaps).toEqual([
      { startsAtMs: 10_000, endsAtMs: 11_000, reason: "upload_failed" },
      { startsAtMs: 11_000, endsAtMs: 12_000, reason: "missing_audio" },
    ]);
  });
});
