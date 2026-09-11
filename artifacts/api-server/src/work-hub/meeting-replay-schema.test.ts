import { describe, expect, it } from "vitest";
import {
  workHubMeetingReplayAudioChunksTable,
  workHubMeetingReplayAssignmentsTable,
  workHubMeetingReplayEventsTable,
  workHubMeetingReplayManifestsTable,
} from "@workspace/db/schema";

describe("work hub meeting replay schema", () => {
  it("stores versioned owner-scoped manifests without a retention deadline", () => {
    expect(Object.keys(workHubMeetingReplayManifestsTable)).toEqual(expect.arrayContaining([
      "id", "occurrenceId", "ownerOrgType", "ownerOrgId", "recordingOwnerUserId",
      "recordingLeaseGeneration", "recordingLeaseTokenHash", "recordingLeaseHolderUserId", "recordingLeaseIssuedAt", "recordingLeaseExpiresAt",
      "meetingStartedAt", "meetingEndedAt", "status", "schemaVersion", "rendererVersion",
      "durationMs", "gapMarkers", "audioByteCount", "audioChunkCount", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(workHubMeetingReplayManifestsTable)).not.toEqual(expect.arrayContaining(["expiresAt", "deleteAt", "retentionDays"]));
  });

  it("stores idempotent checksummed audio chunks and normalized timed events", () => {
    expect(Object.keys(workHubMeetingReplayAudioChunksTable)).toEqual(expect.arrayContaining([
      "id", "manifestId", "occurrenceId", "operationId", "leaseGeneration", "sequence", "startsAtMs", "endsAtMs",
      "durationMs", "sampleRate", "channelCount", "bitsPerSample", "sampleCount",
      "contentType", "byteSize", "sha256", "storageKey", "state", "createdById", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(workHubMeetingReplayEventsTable)).toEqual(expect.arrayContaining([
      "id", "manifestId", "occurrenceId", "operationId", "leaseGeneration", "eventKey", "eventType", "offsetMs",
      "endOffsetMs", "sourceId", "actorUserId", "payload", "createdById", "createdAt",
    ]));
  });

  it("stores owner-authorized catch-up assignments and server-observed progress", () => {
    expect(Object.keys(workHubMeetingReplayAssignmentsTable)).toEqual(expect.arrayContaining([
      "id", "occurrenceId", "assigneeUserId", "assignedById", "requirement", "dueAt", "status",
      "watchedIntervals", "watchedMs", "lastPositionMs", "viewerGeneration", "viewerTokenHash",
      "viewerIssuedAt", "viewerExpiresAt", "viewerObservedAt", "completedAt", "createdAt", "updatedAt",
    ]));
  });
});
