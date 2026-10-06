import { describe, expect, it } from "vitest";
import { fileDeviceHandoff, requireMatchingFileDevice, meetingDeviceHandoff, requireMatchingMeetingDevice } from "./chatgpt-device-handoff";
import { ticketDeviceHandoff, requireMatchingTicketDevice } from "./chatgpt-device-handoff";

describe("ticket device handoff", () => {
  const session = { userId: 17, role: "vendor" as const, vendorId: 4, activeMembershipId: 7, sv: 2 };
  it.each(["photo", "parts", "labor", "mileage"])("binds %s entry to the same account, company and saved ticket", entry => {
    const handoff = ticketDeviceHandoff(session, "grant", 42, entry);
    expect(requireMatchingTicketDevice(handoff, session)).toBe(`/tickets/42?askvEntry=${entry}`);
    for (const mismatch of [{ ...session, userId: 18 }, { ...session, vendorId: 5 }, { ...session, sv: 3 }, { ...session, activeMembershipId: 8 }]) expect(() => requireMatchingTicketDevice(handoff, mismatch)).toThrow();
    expect(() => requireMatchingTicketDevice({ ...handoff, expires: 0 }, session)).toThrow();
    expect(() => requireMatchingTicketDevice({ ...handoff, kind: "file-device-handoff" as never }, session)).toThrow();
  });
  it("rejects arbitrary destinations and invalid identifiers", () => {
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "42"]) expect(() => ticketDeviceHandoff(session, "grant", id, "photo")).toThrow();
    for (const entry of ["../files", "photo&redirect=https://evil.invalid", undefined]) expect(() => ticketDeviceHandoff(session, "grant", 42, entry)).toThrow();
  });
});

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

 describe("meeting device handoff", () => {
  const session = { userId: 17, role: "vendor" as const, vendorId: 4, activeMembershipId: 7, sv: 2 };
  const id = "17795fa1-bb5f-4abc-a5f8-7e9b33a0ec05";
  it("opens only the bound saved meeting for the same account", () => {
    const handoff = meetingDeviceHandoff(session, "grant", id);
    expect(requireMatchingMeetingDevice(handoff, session)).toBe("/work-hub/meetings?meeting=" + id);
    for (const mismatch of [{ ...session, userId: 18 }, { ...session, vendorId: 5 }, { ...session, sv: 3 }]) expect(() => requireMatchingMeetingDevice(handoff, mismatch)).toThrow();
    expect(() => requireMatchingMeetingDevice({ ...handoff, expires: 0 }, session)).toThrow();
    expect(() => requireMatchingMeetingDevice({ ...handoff, kind: "file-device-handoff" as never }, session)).toThrow();
  });
  it("rejects arbitrary destinations and missing meeting identifiers", () => {
    for (const value of ["", "../files", "https://example.invalid", id + "?redirect=x"]) expect(() => meetingDeviceHandoff(session, "grant", value)).toThrow();
  });
});
