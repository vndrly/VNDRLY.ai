import { describe, expect, it } from "vitest";
import {
  browserVoiceAvailability,
  capabilityVoiceAvailability,
  microphonePermissionAvailability,
  realtimeConnectionMessage,
} from "./askv-voice-availability";

describe("AskV voice availability", () => {
  it("distinguishes unsupported browser capabilities", () => {
    expect(browserVoiceAvailability({ secureContext: false, peerConnection: true, getUserMedia: true })).toEqual({
      status: "unsupported_browser",
      message: "Natural voice requires a secure HTTPS connection.",
    });
    expect(browserVoiceAvailability({ secureContext: true, peerConnection: false, getUserMedia: true })).toEqual({
      status: "unsupported_browser",
      message: "This browser does not support live AskV voice conversations.",
    });
    expect(browserVoiceAvailability({ secureContext: true, peerConnection: true, getUserMedia: true })).toEqual({
      status: "available",
      message: null,
    });
  });

  it("distinguishes denied microphone permission from a prompt or grant", () => {
    expect(microphonePermissionAvailability("denied")).toEqual({
      status: "permission_denied",
      message: "Microphone access is blocked for vndrly.ai. Allow it in your browser settings, then reopen AskV.",
    });
    expect(microphonePermissionAvailability("prompt").status).toBe("available");
    expect(microphonePermissionAvailability("granted").status).toBe("available");
  });

  it("preserves the server's structured availability reason", () => {
    expect(capabilityVoiceAvailability({
      enabled: false,
      availability: { status: "missing_configuration", reason: "Natural voice is not configured on the server." },
    })).toEqual({
      status: "missing_configuration",
      message: "Natural voice is not configured on the server.",
    });
  });

  it("distinguishes provider configuration from transient connection failures", () => {
    expect(realtimeConnectionMessage(503, { code: "assistant.openai_missing" })).toBe(
      "Natural voice is not configured on the server.",
    );
    expect(realtimeConnectionMessage(502, { code: "assistant.realtime_unavailable" })).toBe(
      "AskV voice could not connect right now. Please try again.",
    );
  });
});
