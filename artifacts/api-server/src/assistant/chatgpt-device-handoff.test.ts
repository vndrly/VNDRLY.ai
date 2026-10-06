import { describe, expect, it } from "vitest";
import { fileDeviceHandoff, requireMatchingFileDevice } from "./chatgpt-device-handoff";

describe("file device handoff identity", () => {
  const session = { userId: 17, role: "vendor" as const, vendorId: 4, activeMembershipId: 7, sv: 2 };
  it("allows only the same user, session generation, and active company context", () => {
    const handoff = fileDeviceHandoff(session, "current-grant-hash");
    expect(() => requireMatchingFileDevice(handoff, session)).not.toThrow();
    for (const mismatch of [{ ...session, userId: 18 }, { ...session, sv: 3 }, { ...session, vendorId: 5 }, { ...session, activeMembershipId: 8 }]) {
      expect(() => requireMatchingFileDevice(handoff, mismatch)).toThrow(/same VNDRLY/);
    }
  });
  it("rejects expired and wrong-purpose links without touching records", () => {
    const handoff = fileDeviceHandoff(session, "current-grant-hash");
    expect(() => requireMatchingFileDevice({ ...handoff, expires: Date.now() - 1 }, session)).toThrow();
    expect(() => requireMatchingFileDevice({ ...handoff, kind: "other" as never }, session)).toThrow();
    expect(() => fileDeviceHandoff({ role: "vendor" }, "hash")).toThrow();
  });
});
