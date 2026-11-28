import { describe, expect, it } from "vitest";
import { voiceErrorCode, voiceErrorEndsSession } from "./voice-error";

// The shape the SDK hands over for an error sent by the voice service.
const fromService = (code: string) => ({ type: "error", error: { type: "error", error: { type: "invalid_request_error", code, message: "refused" } } });

describe("which voice errors end the session", () => {
  it("reads the service's code through the SDK's wrapping", () => {
    expect(voiceErrorCode(fromService("response_cancel_not_active"))).toBe("response_cancel_not_active");
    expect(voiceErrorCode({ type: "error", error: new Error("tool failed") })).toBe("");
    expect(voiceErrorCode(null)).toBe("");
  });
  it.each(["response_cancel_not_active", "item_delete_invalid_item_id", "conversation_already_has_active_response", ""])("keeps the session while the link is up: %s", code => {
    expect(voiceErrorEndsSession(fromService(code), true)).toBe(false);
  });
  it("keeps the session for an SDK error with no service code while the link is up", () => {
    expect(voiceErrorEndsSession({ type: "error", error: new Error("tool failed") }, true)).toBe(false);
  });
  it.each(["session_expired", "invalid_api_key"])("ends the session on %s even though the link is up", code => {
    expect(voiceErrorEndsSession(fromService(code), true)).toBe(true);
  });
  it("ends the session for any error once the link is down", () => {
    expect(voiceErrorEndsSession(fromService("response_cancel_not_active"), false)).toBe(true);
  });
});
