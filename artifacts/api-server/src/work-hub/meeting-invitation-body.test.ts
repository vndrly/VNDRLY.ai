import { describe, expect, it } from "vitest";
import { meetingInvitationBody } from "./meeting-invitation-body";
describe("meeting invitation agenda", () => {
  it("delivers the full pasted multiline agenda with the invitation", () => {
    const agenda = "1. Safety\n2. Equipment\n\nBring receipts.";
    expect(meetingInvitationBody("Morning meeting", agenda)).toBe(`Morning meeting\n\nAgenda\n${agenda}`);
  });
  it("does not add an empty agenda section", () => {
    for (const agenda of [undefined, null, "", "  "]) expect(meetingInvitationBody("Meeting", agenda)).toBe("Meeting");
  });
});
