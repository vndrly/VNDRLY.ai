import { describe, expect, it } from "vitest";
import { redactWorkHubAuditMetadata } from "./audit";

describe("Work Hub audit metadata", () => {
  it("removes credentials and collaboration content while retaining safe ids", () => {
    expect(redactWorkHubAuditMetadata({
      channelId: "c-1",
      token: "secret-token",
      transcriptText: "spoken words",
      messageBody: "private message",
      retryCount: 2,
    })).toEqual({
      channelId: "c-1",
      token: "[redacted]",
      transcriptText: "[redacted]",
      messageBody: "[redacted]",
      retryCount: 2,
    });
  });
});
