import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ios = (name: string) => readFileSync(resolve(process.cwd(), "modules/askv-wake/ios", name), "utf8");
const encoder = ios("WorkHubPCMEncoder.mm");
const encoderHeader = ios("WorkHubPCMEncoder.h");
const session = ios("WorkHubMeetingSession.mm");
const conversationAudio = ios("AskVConversationAudio.mm");
const xctest = ios("tests/WorkHubPCMEncoderTests.mm");
const meetingModule = ios("WorkHubMeetingModule.swift");
const meetingSessionHeader = ios("WorkHubMeetingSession.h");

function balancedBraces(source: string) {
  let depth = 0;
  for (const character of source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe("native meeting source safety contracts", () => {
  it("closes every XCTest method before @end and has balanced source braces", () => {
    expect(xctest).toMatch(/XCTAssertEqualObjects\(failure, @"AUDIO_TIMESTAMP_INVALID"\);\s*}\s*@end/);
    expect(balancedBraces(xctest)).toBe(true);
    expect(balancedBraces(encoder)).toBe(true);
    expect(balancedBraces(session)).toBe(true);
  });

  it("fully initializes a ring chunk before release-publishing its write index", () => {
    const begin = encoder.indexOf("Chunk &chunk");
    const publish = encoder.indexOf("_write.store(write + 1, std::memory_order_release)", begin);
    for (const field of ["chunk.samples", "chunk.count", "chunk.sampleRate", "chunk.sampleTime", "chunk.hostTimeNanos", "chunk.durationNanos", "chunk.policyRevision", "chunk.epoch"]) {
      expect(encoder.indexOf(field, begin)).toBeGreaterThan(begin);
      expect(encoder.indexOf(field, begin)).toBeLessThan(publish);
    }
  });

  it("epochs every transcription boundary and revalidates an enqueue snapshot before publishing", () => {
    expect(encoder).toContain("uint64_t epoch");
    expect(encoder).toContain("std::atomic<uint64_t> _transcriptionEpoch");
    expect(encoder).toMatch(/setEnabled:[\s\S]*?_transcriptionEpoch\.fetch_add/);
    expect(encoder).toMatch(/invalidate[\s\S]*?_transcriptionEpoch\.fetch_add/);
    const snapshot = encoder.indexOf("const uint64_t enqueueEpoch");
    const copy = encoder.indexOf("memcpy(chunk.samples.data()", snapshot);
    const revalidate = encoder.indexOf("_transcriptionEpoch.load", copy);
    const publish = encoder.indexOf("_write.store(write + 1, std::memory_order_release)", revalidate);
    expect(snapshot).toBeGreaterThan(0);
    expect(copy).toBeGreaterThan(snapshot);
    expect(revalidate).toBeGreaterThan(copy);
    expect(publish).toBeGreaterThan(revalidate);
    expect(encoder).toContain("chunk.epoch = enqueueEpoch");
    expect(encoder).toMatch(/chunk\.epoch == _transcriptionEpoch\.load/);
  });

  it("serializes hardware mutations on the ADM context and exposes atomic realtime state", () => {
    expect(session).toContain("runOnAudioDeviceQueue");
    expect(session).toMatch(/dispatchSync/);
    for (const state of ["_playing", "_recordingRequested", "_unitStarted", "_captureAuthorized"]) {
      expect(session).toContain(`std::atomic<bool> ${state}`);
    }
    expect(session).not.toMatch(/BOOL _initialized, _playoutInitialized/);
  });

  it("requires valid monotonic sample or host timing and fails closed on discontinuity", () => {
    expect(encoderHeader).toContain("hostTimeNanos");
    expect(encoder).toContain("hostTimeNanos");
    expect(encoder).toContain("AUDIO_TIMESTAMP_INVALID");
    expect(encoder).toContain("AUDIO_TIMESTAMP_DISCONTINUITY");
    expect(session).toContain("kAudioTimeStampHostTimeValid");
    expect(encoder).toContain("kHostClockRoundingToleranceSamples");
    expect(encoder).toContain("inputStart != _expectedInputSample");
    expect(encoder).not.toContain("chunk.count / 16");
  });

  it("ignores a stale native failure after a newer generation replaces it", () => {
    expect(meetingModule).toMatch(/meetingSessionDidFail[\s\S]*?guard self\.generation == generation else \{ return \}/);
    expect(meetingModule).toMatch(/guard self\.generation == generation else \{ return \}[\s\S]*?invalidate\(expectedGeneration: generation/);
  });

  it("uses Expo-compatible Swift module and synchronous function declarations", () => {
    expect(meetingSessionHeader).toContain("@protocol WorkHubMeetingSessionDelegate");
    expect(meetingSessionHeader).not.toContain("@protocol WorkHubMeetingSessionDelegate <NSObject>");
    expect(meetingModule).toMatch(/Function\("invalidateSession"\)[\s\S]*?self\.onMain/);
    expect(meetingModule).not.toMatch(/Function\("invalidateSession"\)[^\n]*runOnQueue/);
  });

  it("bounds queued audio to at most half a second at the actual input rate", () => {
    expect(encoder).toContain("(double)frameCount * 1000000000.0 / sampleRate");
    expect(encoder).toContain("kMaxQueuedNanos = 500000000");
    expect(encoder).toContain("_bufferedDurationNanos");
    expect(encoder).toContain("bufferedNanos + durationNanos > kMaxQueuedNanos");
    expect(encoder).toContain("durationNanos > kMaxQueuedNanos");
    expect(encoder).not.toContain("kMaxBufferedSamples = 48000");
  });

  it("reuses the established audio policy owner and restores only while still owner", () => {
    expect(session).toContain('#import "AskVConversationAudio.h"');
    expect(session).toContain("AskVConversationAudio *_conversationAudio");
    expect(session).toContain("ownsCurrentConfiguration");
    expect(session).toContain("releaseConfiguration");
    expect(session).not.toMatch(/session setCategory:AVAudioSessionCategoryPlayAndRecord/);
    expect(conversationAudio).toContain("_previousSessionConfiguration");
    expect(conversationAudio).toContain("_previousSessionActive");
    expect(conversationAudio).toContain("SameStableDirectConfiguration");
    expect(conversationAudio).toMatch(/webRTCConfiguration\] == _installedConfiguration/);
    const ownershipHelper = conversationAudio.slice(
      conversationAudio.indexOf("static BOOL SameStableDirectConfiguration"),
      conversationAudio.indexOf("@implementation"),
    );
    expect(ownershipHelper).toContain("left.category");
    expect(ownershipHelper).toContain("left.mode");
    expect(ownershipHelper).toContain("left.categoryOptions");
    expect(ownershipHelper).not.toMatch(/sampleRate|ioBufferDuration|NumberOfChannels/);
    expect(conversationAudio).toContain("AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation");
    expect(conversationAudio).toMatch(/setConfiguration:_previousSessionConfiguration[\s\S]*?_previousSessionActive/);
    expect(conversationAudio).toMatch(/if \(_previousConfiguration && stillOwns\)/);
  });
});
