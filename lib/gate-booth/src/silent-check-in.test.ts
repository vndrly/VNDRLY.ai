import { expect, it } from "vitest";
import { createSilentGateCheckIn, isGateVoiceConfirm } from "./silent-check-in";
import { registerGateVoiceForm, type GateVoiceDraft } from "./voice-draft";

it("accepts a spoken confirm, including a question mark, and ignores a longer request", () => {
  for (const text of ["Confirm", "Confirm.", "Confirm?", "yes please", "okay confirm", "confirm check in"]) {
    expect(isGateVoiceConfirm(text)).toBe(true);
  }
  expect(isGateVoiceConfirm("Submit and tell me who is on site")).toBe(false);
  expect(isGateVoiceConfirm("Check in")).toBe(false);
});

it("submits the ready form after the gate id arrives", () => {
  const draft: GateVoiceDraft = { siteLocationId: 9, gateStationId: "pending", entryRevision: 0, silentCheckIn: true, firstName: "John", lastName: "Smith", company: "MidCon", vehiclePlate: "ABC123", plateState: "OK" };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, open: () => {}, fillCheckIn: values => Object.assign(draft, values) });
  const capture = createSilentGateCheckIn({ normalizePlateState: () => null, parseSpokenPlateState: () => null });
  const context = () => ({ path: "/gate", gateDraft: readDraft() });
  function readDraft() { return draft; }
  try {
    capture.engage(context());
    capture.hear(context(), "John Smith");
    draft.gateStationId = "selected-gate";
    expect(capture.review(context())).toMatchObject({ ready: true, firstName: "John", lastName: "Smith" });
  } finally { unregister(); }
});

it("does not interpret waiting commentary as a name or open a check-in on microphone activation", () => {
  const draft: GateVoiceDraft = { siteLocationId: 9, gateStationId: "test", entryRevision: 0 };
  let opened = false;
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, open: () => { opened = true; }, fillCheckIn: values => Object.assign(draft, values), dismissCheckIn: () => { draft.silentCheckIn = false; } });
  const capture = createSilentGateCheckIn({ normalizePlateState: () => null, parseSpokenPlateState: () => null });
  const context = { path: "/gate", gateDraft: draft };
  try {
    capture.engage(context);
    for (const text of ["I'm waiting on it to populate", "waiting on population", "I'm waiting", "Just waiting here"]) capture.hear(context, text);
    expect(opened).toBe(false);
    expect(draft.firstName).toBeUndefined();
    expect(draft.lastName).toBeUndefined();
    capture.hear(context, "First name John, last name Smith");
    expect(draft).toMatchObject({ firstName: "John", lastName: "Smith" });
    draft.silentCheckIn = true;
    capture.hear(context, "Check out");
    expect(draft.silentCheckIn).toBe(false);
    capture.hear(context, "waiting on population");
    expect(draft).toMatchObject({ firstName: "John", lastName: "Smith" });
  } finally { unregister(); }
});

it.each(["At C11259, Oklahoma.", "C 1 1 2 5 9 Oklahoma", "Oklahoma C 1 1 2 5 9"])("collects the unlabeled plate/state speech turn: %s", text => {
  const draft: GateVoiceDraft = { siteLocationId: 9, gateStationId: "test", entryRevision: 0, firstName: "Matt", lastName: "Argyle" };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, open: () => {}, fillCheckIn: values => Object.assign(draft, values) });
  const capture = createSilentGateCheckIn({ normalizePlateState: value => value?.toLowerCase() === "oklahoma" ? "OK" : null, parseSpokenPlateState: () => null });
  try {
    capture.engage({ path: "/gate", gateDraft: draft });
    capture.hear({ path: "/gate", gateDraft: draft }, text);
    expect(draft).toMatchObject({ firstName: "Matt", lastName: "Argyle", vehiclePlate: "C11259", plateState: "OK" });
  } finally { unregister(); }
});

it("does not turn Starting again into a visitor and accepts Start check in", () => {
  const draft: GateVoiceDraft = { siteLocationId: 9, gateStationId: "test", entryRevision: 0 };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, open: () => {}, fillCheckIn: values => Object.assign(draft, values) });
  const capture = createSilentGateCheckIn({ normalizePlateState: () => null, parseSpokenPlateState: () => null });
  try {
    capture.engage({ path: "/gate", gateDraft: draft });
    capture.hear({ path: "/gate", gateDraft: draft }, "Starting again");
    expect(draft.firstName).toBeUndefined();
    expect(draft.lastName).toBeUndefined();
    capture.hear({ path: "/gate", gateDraft: draft }, "Start check in Bob Smith, Bob's Trucking");
    expect(draft).toMatchObject({ firstName: "Bob", lastName: "Smith", company: "Bob's Trucking" });
  } finally { unregister(); }
});

function permutations(values: string[]): string[][] {
  return values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest])) : [[]];
}

it.each([
  ["Check-in John Smith, John's Trucking A B C 1 2 3, Texas plate", "John", "John's Trucking"],
  ["Start check in Bob Smith, Bob's Trucking A B C 1 2 3, Texas plate", "Bob", "Bob's Trucking"],
])("collects the actual live sentence %s", (text, firstName, company) => {
  const draft: GateVoiceDraft = { siteLocationId: 9, gateStationId: "test", entryRevision: 0 };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, open: () => {}, fillCheckIn: values => Object.assign(draft, values) });
  const capture = createSilentGateCheckIn({ normalizePlateState: () => null, parseSpokenPlateState: value => /texas/i.test(value) ? "TX" : null });
  try {
    capture.hear({ path: "/gate", gateDraft: draft }, text);
    expect(draft).toMatchObject({ firstName, lastName: "Smith", company, vehiclePlate: "ABC123", plateState: "TX" });
  } finally { unregister(); }
});

it.each(permutations(["First name John", "Last name Smith", "John's Trucking", "state Oklahoma", "plate B C 7 O 7 9"]))("collects fields in order %j", (...turns) => {
  const draft: GateVoiceDraft = { siteLocationId: 9, gateStationId: "test", entryRevision: 0 };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, open: () => {}, fillCheckIn: values => Object.assign(draft, values) });
  const capture = createSilentGateCheckIn({ normalizePlateState: value => value?.toLowerCase() === "oklahoma" ? "OK" : null, parseSpokenPlateState: value => /oklahoma/i.test(value) ? "OK" : null });
  try {
    capture.hear({ path: "/gate", gateDraft: draft }, "Check in");
    for (const text of turns) capture.hear({ path: "/gate", gateDraft: draft }, text);
    expect(draft).toMatchObject({ firstName: "John", lastName: "Smith", company: "John's Trucking", plateState: "OK", vehiclePlate: "BC7O79" });
  } finally { unregister(); }
});

it("collects the operator's five fields across separate speech turns", () => {
  const draft: GateVoiceDraft = { siteLocationId: 9, gateStationId: "test", entryRevision: 0 };
  const unregister = registerGateVoiceForm({ read: () => draft, saved: () => {}, open: () => {}, fillCheckIn: values => Object.assign(draft, values) });
  const capture = createSilentGateCheckIn({
    normalizePlateState: value => value?.toLowerCase() === "oklahoma" ? "OK" : null,
    parseSpokenPlateState: value => /oklahoma/i.test(value) ? "OK" : null,
  });
  try {
    capture.engage({ path: "/gate", gateDraft: draft });
    for (const text of ["Check in", "First name John", "Last name Smith", "John's Trucking", "Oklahoma plate B C 7 O 7 9"]) {
      capture.hear({ path: "/gate", gateDraft: draft }, text);
    }
    expect(draft).toMatchObject({ firstName: "John", lastName: "Smith", company: "John's Trucking", plateState: "OK", vehiclePlate: "BC7O79" });
  } finally { unregister(); }
});
