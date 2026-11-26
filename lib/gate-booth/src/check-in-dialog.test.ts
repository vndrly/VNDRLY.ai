import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { normalizePlateState, parseSpokenPlateState } from "../../plate-state/src/index";
import { checkInQuestion, createSilentGateCheckIn, gateCheckOutQuery, gateVoiceTrigger } from "./silent-check-in";
import { registerGateVoiceForm, type GateVoiceDraft } from "./voice-draft";
import { decideGateVoiceReply } from "./voice-reply";
import { createGateVoicePrompter } from "./voice-prompter";

/** Speak the turns at an open Gate form, the way both voice hooks route them. */
function dictate(turns: string[]) {
  const draft: GateVoiceDraft = { siteLocationId: 9, gateStationId: "g", entryRevision: 0 };
  const unregister = registerGateVoiceForm({
    read: () => draft, saved: () => {},
    open: () => { draft.silentCheckIn = true; },
    dismissCheckIn: () => { draft.silentCheckIn = false; },
    fillCheckIn: values => { Object.assign(draft, values); draft.silentCheckIn = true; },
  });
  const capture = createSilentGateCheckIn({ normalizePlateState, parseSpokenPlateState });
  const context = () => ({ path: "/gate", gateDraft: draft });
  const asked: Array<string | null> = [];
  let submitted = false;
  try {
    capture.engage(context());
    for (const text of turns) {
      const review = capture.review(context());
      if (!gateVoiceTrigger(text) && review?.ready) {
        const decision = decideGateVoiceReply(text, "check_in", review);
        if (decision === "submit") { submitted = true; break; }
        if (decision !== "correct") continue;
      }
      capture.hear(context(), text);
      const field = capture.pending(context());
      asked.push(field && checkInQuestion(field));
    }
    const { firstName, lastName, company, vehiclePlate, plateState } = draft;
    return { submitted, asked, fields: [firstName, lastName, company, vehiclePlate, plateState] };
  } finally { unregister(); }
}

it.each<[string, string[], unknown[]]>([
  ["one sentence, then the state", ["Check in, Bob Smith, Bob's Trucking, ABC123.", "Oklahoma.", "Yes."], ["Bob", "Smith", "Bob's Trucking", "ABC123", "OK"]],
  ["one bare answer per turn", ["Check in.", "John.", "Smith.", "Halliburton.", "ABC123.", "Oklahoma.", "Submit."], ["John", "Smith", "Halliburton", "ABC123", "OK"]],
  ["labeled answers", ["Check in.", "First name John.", "Last name Smith.", "Company name Halliburton.", "Tag ABC123.", "State Oklahoma.", "Confirm."], ["John", "Smith", "Halliburton", "ABC123", "OK"]],
  ["a company without a business word", ["Check in John Smith.", "Halliburton.", "ABC 123.", "Oklahoma.", "Yes."], ["John", "Smith", "Halliburton", "ABC123", "OK"]],
  ["a company inside one sentence", ["Check in John Smith, Halliburton.", "Tag 7KL429, Texas.", "Yes."], ["John", "Smith", "Halliburton", "7KL429", "TX"]],
  ["a plate transcribed with dashes", ["Check in John Smith, Halliburton, A-B-C-1-2-3, Oklahoma.", "Yes."], ["John", "Smith", "Halliburton", "ABC123", "OK"]],
  ["names transcribed in lower and upper case", ["Check in.", "alan.", "WEBB", "Halliburton.", "ABC123.", "Oklahoma", "Yes."], ["Alan", "Webb", "Halliburton", "ABC123", "OK"]],
  ["a plate read aloud in two pieces", ["Check in.", "Alan.", "Webb.", "Halliburton.", "A, B, C.", "1-2-3", "Oklahoma.", "Yes."], ["Alan", "Webb", "Halliburton", "ABC123", "OK"]],
  ["a plate read in two pieces with commas", ["Check in John Smith, Halliburton.", "A B C.", "1, 2, 3.", "Oklahoma.", "Yes."], ["John", "Smith", "Halliburton", "ABC123", "OK"]],
  ["a second, different plate replaces the first", ["Check in John Smith, Halliburton.", "ABC1.", "XYZ 789.", "Oklahoma.", "Yes."], ["John", "Smith", "Halliburton", "XYZ789", "OK"]],
  ["the rest of the tag arriving after the read-back", ["Check in Bob Smith, Bob's Trucking, Oklahoma tag.", "A, B, C.", "1, 2, 3.", "Yes."], ["Bob", "Smith", "Bob's Trucking", "ABC123", "OK"]],
  ["a sentence cut in two before 'with'", ["Check in John Carter.", "With Longhorn, Oklahoma, tag ABC123.", "Submit."], ["John", "Carter", "Longhorn", "ABC123", "OK"]],
  ["a plain word that is not a tag", ["Check in Dave Jones.", "Jones.", "Welding.", "DJW555.", "Texas.", "Yes."], ["Dave", "Jones", "Jones", "DJW555", "TX"]],
  ["a letters-only plate", ["Check in John Smith, Halliburton.", "BADBOY.", "Oklahoma.", "Yes."], ["John", "Smith", "Halliburton", "BADBOY", "OK"]],
  ["answers said as questions", ["Check in.", "John Smith?", "Halliburton?", "ABC123?", "Oklahoma?", "Yes."], ["John", "Smith", "Halliburton", "ABC123", "OK"]],
  ["the recorded chicken transcript", ["The chicken bob Smith.", "Bob's Trucking.", "Oklahoma plate ABC123.", "Confirmed."], ["Bob", "Smith", "Bob's Trucking", "ABC123", "OK"]],
  ["the recorded Alan Webb turns", ["Check in Alan Webb.", "Webs towing.", "Oklahoma plate.", "CDL121", "Company Webb's Towing.", "Confirmed."], ["Alan", "Webb", "Webb's Towing", "CDL121", "OK"]],
  ["a corrected last name", ["Check in John Smith, Halliburton, ABC123, Oklahoma.", "No, the last name is Smyth.", "Yes."], ["John", "Smyth", "Halliburton", "ABC123", "OK"]],
])("checks in from %s", (_label, turns, fields) => {
  expect(dictate(turns)).toMatchObject({ submitted: true, fields });
});

it("asks only for the next missing field and stops asking once the form is complete", () => {
  expect(dictate(["Check in.", "John.", "Smith.", "Halliburton.", "ABC123.", "Oklahoma."]).asked)
    .toEqual(["First name?", "Last name?", "Company?", "Tag?", "State?", null]);
  expect(dictate(["Check in Bob Smith, Bob's Trucking.", "Oklahoma."]).asked).toEqual(["Tag?", "Tag?"]);
});

it("stays quiet and fills nothing until the operator says check in", () => {
  const result = dictate(["Good morning.", "Just waiting here.", "Thank you."]);
  expect(result.asked).toEqual([null, null, null]);
  expect(result.fields).toEqual([undefined, undefined, undefined, undefined, undefined]);
});

it("does not take a refusal, a question or small talk as a field", () => {
  expect(dictate(["Check in.", "No.", "Hold on.", "Is he on the list?", "Thank you."]).fields)
    .toEqual([undefined, undefined, undefined, undefined, undefined]);
});

it("does not submit a refused or unconfirmed check-in", () => {
  expect(dictate(["Check in John Smith, Halliburton, ABC123, Oklahoma.", "No."]).submitted).toBe(false);
  expect(dictate(["Check in John Smith, Halliburton.", "Yes."]).submitted).toBe(false);
});

it.each([
  ["Check in Bob Smith", "in", ""], ["Checking in Bob Smith.", "in", ""], ["Chicken, Bob Smith.", "in", ""],
  ["Check and Bob Smith", "in", ""], ["Okay, check him in.", "in", ""],
  ["Check out Bob Smith.", "out", "Bob Smith"], ["Checkout ABC123", "out", "ABC123"], ["Check him out, Bob Smith.", "out", "Bob Smith"],
  ["Bob Smith checked in yesterday", undefined, ""], ["Check inside the trailer", undefined, ""],
])("hears the command in %s", (text, trigger, query) => {
  expect(gateVoiceTrigger(text)).toBe(trigger);
  expect(gateCheckOutQuery(text)).toBe(query);
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("asks after a pause, holds the question while the operator keeps talking, and never repeats it to itself", () => {
  const said: string[] = [];
  const prompter = createGateVoicePrompter(text => said.push(text), 1000);
  prompter.ask(() => "Company?");
  vi.advanceTimersByTime(500);
  prompter.hush();
  vi.advanceTimersByTime(2000);
  expect(said).toEqual([]);
  prompter.ask(() => "Company?");
  vi.advanceTimersByTime(1000);
  expect(said).toEqual(["Company?"]);
  // Noise or AskV's own voice is not an operator turn, so the same question is not asked again.
  prompter.ask(() => "Company?", false);
  vi.advanceTimersByTime(1000);
  expect(said).toEqual(["Company?"]);
  prompter.ask(() => "Tag?", false);
  vi.advanceTimersByTime(1000);
  expect(said).toEqual(["Company?", "Tag?"]);
});

it("does not speak while the operator is mid-sentence, then asks once their words have arrived", () => {
  const said: string[] = [];
  const prompter = createGateVoicePrompter(text => said.push(text), 1000);
  // The next turn began before the words of the previous one arrived.
  prompter.began();
  prompter.heard();
  prompter.began();
  prompter.ask(() => "State?");
  expect(prompter.busy()).toBe(true);
  vi.advanceTimersByTime(3000);
  expect(said).toEqual([]);
  prompter.heard();
  expect(prompter.busy()).toBe(false);
  vi.advanceTimersByTime(1000);
  expect(said).toEqual(["State?"]);
});

it("ignores its own prompt coming back through the microphone but not the operator's answer", () => {
  const prompter = createGateVoicePrompter(() => {});
  prompter.say("Bob Smith, Bob's Trucking, A B C one two three, OK. Say yes to check in.");
  expect(prompter.echo("Say yes to check in.")).toBe(true);
  expect(prompter.echo("Bob Smith, Bob's Trucking, ABC123, OK. Say yes to check in.")).toBe(true);
  expect(prompter.echo("Yes.")).toBe(false);
  expect(prompter.echo("Yes, check in.")).toBe(false);
  expect(prompter.echo("No, the last name is Smyth.")).toBe(false);
  prompter.say("Company?");
  expect(prompter.echo("Company.")).toBe(true);
  expect(prompter.echo("Halliburton.")).toBe(false);
  vi.advanceTimersByTime(11_000);
  expect(prompter.echo("Company.")).toBe(false);
});

it("still knows its own long read-back twelve seconds later, whole or in pieces", () => {
  const prompter = createGateVoicePrompter(() => {});
  prompter.say("Maria Lopez, Halliburton, K T X nine zero two, TX. Say yes to check in.");
  vi.advanceTimersByTime(12_000);
  expect(prompter.echo("Maria Lopez, Halliburton, KTX-902, TX. Say yes to check in.")).toBe(true);
  expect(prompter.echo("Maria Lopez, Halliburton.")).toBe(true);
  expect(prompter.echo("KTX-902, TX.")).toBe(true);
  expect(prompter.echo("Yes.")).toBe(false);
  expect(prompter.echo("Yes, check in.")).toBe(false);
  // Her fixed closing words are hers no matter how late they arrive.
  vi.advanceTimersByTime(60_000);
  expect(prompter.echo("Say yes to check in.")).toBe(true);
  expect(prompter.echo("Yes.")).toBe(false);
});
