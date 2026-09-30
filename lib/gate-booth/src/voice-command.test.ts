import { describe, expect, it } from "vitest";
import { interpretGateSpeech, normalizeSpokenPlate } from "./voice-command";

describe("gate speech completion", () => {
  it("captures the approved next-truck sentence without treating controls as data", () => {
    expect(interpretGateSpeech("Next truck, Bob's Trucking, Bob Vila, plate ABC one two three, check him in.")).toMatchObject({
      action: "check-in", submit: true, reset: true,
      fields: { firstName: "Bob", lastName: "Vila", company: "Bob's Trucking", vehiclePlate: "ABC123" },
    });
  });
  it.each(["submit", "log him", "check him in", "check in and submit"])("completes the current draft: %s", text => {
    expect(interpretGateSpeech(text)).toMatchObject({ action: "check-in", submit: true, fields: {} });
  });
  it("accepts corrections with an explicit completion instruction", () => {
    expect(interpretGateSpeech("change plate to A B C one two four and submit")).toMatchObject({ submit: true, fields: { vehiclePlate: "ABC124" } });
  });
  it.each(["don't submit", "do not check him in", "cancel that"])("does not submit negated actions: %s", text => {
    expect(interpretGateSpeech(text).submit).toBe(false);
  });
  it("does not submit questions or quoted examples", () => {
    expect(interpretGateSpeech("How do I check him in?").submit).toBe(false);
    expect(interpretGateSpeech("He said check him in").submit).toBe(false);
  });
  it("distinguishes checkout", () => expect(interpretGateSpeech("plate ABC123 check him out")).toMatchObject({ action: "check-out", submit: true }));
  it("normalizes dictated numbers and phonetic letters only within plates", () => {
    expect(normalizeSpokenPlate("alpha bravo charlie zero one two")).toBe("ABC012");
    expect(normalizeSpokenPlate("51D-4A1")).toBe("51D-4A1");
  });
});
