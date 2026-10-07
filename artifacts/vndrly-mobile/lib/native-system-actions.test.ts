import { describe, expect, it } from "vitest";
import {
  NATIVE_WORK_ACTIONS,
  nativeWorkActionUrl,
  parseNativeWorkActionUrl,
  parseNativeWorkAction,
} from "./native-system-actions";

describe("native work system handoff", () => {
  it("round-trips only supported workflow entry points", () => {
    for (const action of NATIVE_WORK_ACTIONS)
      expect(parseNativeWorkActionUrl(nativeWorkActionUrl(action))).toBe(
        action,
      );
  });
  it("rejects injected authority, duplicate actions and external destinations", () => {
    for (const url of [
      "https://vndrly.ai/native-work?action=gate",
      "vndrly-mobile://work-hub/native-entry?action=gate&userId=1069",
      "vndrly-mobile://work-hub/native-entry?action=gate&confirmed=true",
      "vndrly-mobile://work-hub/native-entry?action=gate&action=messages",
      "vndrly-mobile://work-hub/native-entry?action=gate#approve",
      "vndrly-mobile://attacker@work-hub/native-entry?action=gate",
      "vndrly-mobile://native-work/other?action=gate",
    ])
      expect(parseNativeWorkActionUrl(url)).toBeNull();
  });
  it("does not accept arbitrary commands or mutation verbs", () => {
    for (const value of [
      null,
      ["gate"],
      "start_shift",
      "approve_payment",
      "messages?send=true",
    ])
      expect(parseNativeWorkAction(value)).toBeNull();
  });
});
