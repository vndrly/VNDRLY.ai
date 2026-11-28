import { expect, it } from "vitest";
import { checkInPrompt, checkInReceipt, decideGateVoiceReply, gateChoiceQuestion, gateReviewReasons, matchGateChoice, plainGateError, plainGateFailure } from "./voice-reply";

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

it("names what a check-in saved without every detail is flagged for", () => {
  expect(checkInReceipt({ firstName: "John", lastName: "Smith", missing: ["company", "vehiclePlate", "plateState"] })).toBe("John Smith is checked in. Flagged: missing company, tag, state.");
  expect(checkInReceipt({ firstName: "", lastName: "", missing: ["firstName", "lastName", "company", "vehiclePlate", "plateState"] })).toBe("Checked in. Flagged: missing first name, last name, company, tag, state.");
  // What the server flagged the saved entry for is named in place of the guess, and nothing is named when it flagged nothing.
  const flags = gateReviewReasons({ conflictReason: "Missing company\nTag already on site with an open visit for Pat First\ngate.unresolved_identity" });
  expect(flags).toEqual(["Missing company", "Tag already on site with an open visit for Pat First"]);
  expect(checkInReceipt({ firstName: "Sam", lastName: "Second", missing: ["company"] }, flags)).toBe("Sam Second is checked in. Flagged: Missing company. Tag already on site with an open visit for Pat First.");
  expect(checkInReceipt({ firstName: "Sam", lastName: "Second", missing: [] }, [])).toBe("Sam Second is checked in.");
  expect(checkInReceipt({ firstName: "John", lastName: "Smith", missing: [] })).toBe("John Smith is checked in.");
});

it("puts a failed request in plain words and keeps the server's own reason", () => {
  expect(plainGateError(new TypeError("Failed to fetch"), "x")).toBe("No connection. Try again.");
  expect(plainGateError(new Error("HTTP 500"), "x")).toBe("We hit a snag on our end. Please try again in a moment.");
  expect(plainGateError(new Error("Login required"), "x")).toBe("Your session has expired. Please sign in again.");
  expect(plainGateError(new Error("VNDRLY can't reach the service right now. Check your connection; if other apps work, the VNDRLY host, DNS, or firewall may need attention."), "x")).toBe("No connection. Try again.");
  expect(plainGateError(new Error("This vehicle already has an active visit."), "x")).toBe("This vehicle already has an active visit.");
  expect(plainGateError(undefined, "Check-in could not be saved.")).toBe("Check-in could not be saved.");
  expect(plainGateFailure(500, "Tool failed")).toBe("We hit a snag on our end. Please try again in a moment.");
  expect(plainGateFailure(403, "Gatekeeper vendor is not assigned to this site")).toBe("Gatekeeper vendor is not assigned to this site");
});

it("takes the gate the operator names, and asks when it cannot tell", () => {
  const draft = { gateChoices: [{ id: "a", name: "Front Gate" }, { id: "b", name: "Back Gate" }, { id: "c", name: "North Yard" }] };
  expect(gateChoiceQuestion(draft)).toBe("Which gate? Front Gate, Back Gate, North Yard.");
  expect(matchGateChoice(draft, "Front Gate.")?.id).toBe("a");
  expect(matchGateChoice(draft, "I'm at the back gate")?.id).toBe("b");
  expect(matchGateChoice(draft, "the front one")?.id).toBe("a");
  expect(matchGateChoice(draft, "north")?.id).toBe("c");
  expect(matchGateChoice(draft, "gate")).toBeNull();
  expect(matchGateChoice(draft, "Halliburton")).toBeNull();
  expect(gateChoiceQuestion({})).toBe("Select the gate in the Gate selector, then say yes.");
});
