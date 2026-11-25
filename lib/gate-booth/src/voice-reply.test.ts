import { expect, it } from "vitest";
import { checkInPrompt, checkInReceipt, decideGateVoiceReply } from "./voice-reply";

const john = { firstName: "John", lastName: "Smith", company: "MidCon", vehiclePlate: "ABC123", siteLocationId: 9 };

it.each([
  "yes", "Yes.", "yes?", "yeah", "yep", "affirmative", "submit", "Confirm?", "okay confirm",
  "go ahead", "go ahead and do that.", "do it", "that's him", "sounds good", "roger",
  "sí", "afirmativo", "correcto", "adelante", "confirm check in",
])("submits a short approval: %s", (text) => {
  expect(decideGateVoiceReply(text, "check_in", john)).toBe("submit");
  expect(decideGateVoiceReply(text, "check_out")).toBe("submit");
});

it.each(["no", "nope", "wait", "hold on", "cancel", "don't check him in", "no, the plate is wrong"])("refuses: %s", (text) => {
  expect(decideGateVoiceReply(text, "check_in", john)).toBe("refuse");
  expect(decideGateVoiceReply(text, "check_out")).toBe("refuse");
});

it("treats a correction as a change, not a save", () => {
  expect(decideGateVoiceReply("yes, but change the driver", "check_in", john)).toBe("correct");
});

it("does not submit a different person or an unrelated sentence", () => {
  expect(decideGateVoiceReply("go ahead and admit Sam Wilson", "check_in", john)).toBe("repeat");
  expect(decideGateVoiceReply("Submit and tell me who is on site", "check_in", john)).toBe("repeat");
  expect(decideGateVoiceReply("what time is it", "check_out")).toBe("repeat");
});

it("submits a longer command only when it names the open draft", () => {
  expect(decideGateVoiceReply("go ahead and admit John Smith", "check_in", john)).toBe("submit");
});

it("reads the plate back one character at a time and names the saved visitor", () => {
  expect(checkInPrompt({ firstName: "John", lastName: "Smith", company: "MidCon", vehiclePlate: "ABC123", plateState: "Oklahoma" }))
    .toBe("John Smith, MidCon, A B C one two three, Oklahoma. Say yes to check in.");
  expect(checkInReceipt({ firstName: "John", lastName: "Smith" })).toBe("John Smith is checked in.");
});
