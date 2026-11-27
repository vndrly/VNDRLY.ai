import { describe, expect, it } from "vitest";
import { askVWake, checkInProgress, isAskVPause } from "./askv-voice-pause";

describe("AskV pause and wake phrases", () => {
  it.each(["Pause.", "Hold on.", "Hold up a sec.", "Wait.", "Wait a minute.", "Hang on, V.", "V, pause.", "Okay, give me a minute.", "Just a moment.", "Hold on one second, please.", "Pause the check-in."])("pauses on %s", text => {
    expect(isAskVPause(text)).toBe(true);
  });
  it.each(["Hold on, his name is Bob.", "Wait, the company is Halliburton.", "Halliburton.", "Yes.", "The wait was long.", "Check in."])("does not pause on %s", text => {
    expect(isAskVPause(text)).toBe(false);
  });
  it.each(["Hey V.", "V", "Ask V.", "AskV", "Continue.", "Resume.", "Okay, I'm back.", "Where were we?", "Alright V, let's finish check in.", "Alright, let's finish the check-in.", "Let's continue with the check-in.", "V, go ahead.", "Hey V, continue please.", "Back to the check-in."])("comes back on %s", text => {
    expect(askVWake(text)).toBe("");
  });
  it.each(["Go ahead.", "He said to continue down the road.", "Halliburton.", "We resume drilling Monday.", "V8 engine.", "Yes.", "Carry on."])("stays paused through %s", text => {
    expect(askVWake(text)).toBeNull();
  });
  it("hands on the request that follows her name", () => {
    expect(askVWake("Hey V, check in Bob Smith from Halliburton.")).toBe("check in Bob Smith from Halliburton.");
    expect(askVWake("V, who is on site?")).toBe("who is on site?");
  });
  it("says what is on the form before the next question", () => {
    const review = { firstName: "Bob", lastName: "Smith", company: "Halliburton", vehiclePlate: "", plateState: "" };
    expect(checkInProgress(review, "Tag?")).toBe("Bob Smith, Halliburton. Tag?");
    expect(checkInProgress({ ...review, vehiclePlate: "KTX902" }, "State?")).toBe("Bob Smith, Halliburton, K T X nine zero two. State?");
    expect(checkInProgress(null, "First name?")).toBe("First name?");
  });
});
