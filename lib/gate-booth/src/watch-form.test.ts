import { afterEach, expect, it, vi } from "vitest";
import { createSilentGateCheckIn, gateCheckInReview, gateVoiceFormOpen } from "./silent-check-in";
import { confirmGateCheckIn, readGateVoiceDraft, registerGateVoiceForm } from "./voice-draft";
import { createWatchGateForm } from "./watch-form";

const watch = { stationId: "outer", siteId: 414, gateName: "Outer Circle", siteName: "Longhorn" };
const active = [
  { id: 71, firstName: "Ann", lastName: "Webb", company: "Webb Towing", vehiclePlate: "TOW77", plateState: "TX" },
  { id: 72, firstName: "Bo", lastName: "Webb", company: "Webb Towing", vehiclePlate: "TOW78", plateState: "TX" },
  { id: 73, firstName: "John", lastName: "Smith", company: "Halliburton", vehiclePlate: "ABC123", plateState: "TX" },
];
function desk(overrides: Partial<Record<string, (body?: any) => unknown>> = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const form = createWatchGateForm({
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      const key = path.startsWith("/visits?") ? "visits" : path.endsWith("/check-out") ? "check-out" : path;
      if (overrides[key]) return overrides[key]!(body);
      if (key === "/gate-change-over/operating-context") return { operatingGate: watch, reason: null };
      if (key === "visits") return active;
      if (key === "check-out") return { id: 73, checkOutTime: "2026-11-27T23:00:00.000Z" };
      return { id: 1 };
    },
    position: async () => ({ latitude: 31.9, longitude: -102.1 }),
    plate: update => ({ vehiclePlate: update.automatedPlate ?? (update.currentPlate || null), plateState: update.automatedState ?? update.currentState }),
  });
  return { form, calls };
}
const parsers = {
  normalizePlateState: (value: string | undefined) => value && /^(?:texas|tx)$/i.test(value.trim()) ? "TX" : null,
  parseSpokenPlateState: (text: string) => /\btexas\b/i.test(text) ? "TX" : null,
};
const page = () => ({ path: "/work-hub/calendar", gateDraft: readGateVoiceDraft() });
const voice = () => ({ say: vi.fn(), fail: vi.fn() });
let open: ReturnType<typeof desk>["form"] | undefined;
afterEach(() => { open?.close(); open = undefined; });

it("offers no form to someone who holds no single watch", async () => {
  const { form } = desk({ "/gate-change-over/operating-context": () => ({ operatingGate: null, reason: "no_watch" }) });
  expect(await form.open()).toBe(false);
  expect(readGateVoiceDraft()).toBeUndefined();
  expect(gateVoiceFormOpen(page())).toBe(false);
  expect(form.hearCheckOut("check out John Smith", voice())).toBe(false);
});

it("collects a spoken check-in on any page and saves it against the operator's own watch", async () => {
  const { form, calls } = desk(); open = form;
  expect(await form.open()).toBe(true);
  expect(gateVoiceFormOpen(page())).toBe(true);
  const capture = createSilentGateCheckIn(parsers);
  expect(capture.hear(page(), "Check in John Smith")).toBe("start");
  expect(gateCheckInReview(readGateVoiceDraft())).toMatchObject({ ready: false, savable: true, firstName: "John", lastName: "Smith", missing: ["company", "vehiclePlate", "plateState"] });
  expect(capture.pending(page())).toBe("company");
  capture.hear(page(), "Halliburton");
  capture.hear(page(), "ABC 123");
  capture.hear(page(), "Texas");
  const review = capture.review(page());
  expect(review).toMatchObject({ ready: true, missing: [], company: "Halliburton", vehiclePlate: "ABC123", plateState: "TX" });
  await confirmGateCheckIn(review!.key);
  expect(calls.at(-1)).toEqual({ method: "POST", path: "/visits/gate/check-in", body: {
    firstName: "John", lastName: "Smith", company: "Halliburton", vehiclePlate: "ABC123", plateState: "TX",
    notes: undefined, expectedDurationMinutes: 240, siteLocationId: 414, gateStationId: "outer", latitude: 31.9, longitude: -102.1,
  } });
  // The saved entry is gone and the form waits for the next "check in".
  expect(readGateVoiceDraft()).toMatchObject({ watchForm: true, silentCheckIn: false, firstName: "", gateStationName: "Outer Circle" });
});

it("keeps the entry and gives the server's reason when the save is refused", async () => {
  const { form } = desk({ "/visits/gate/check-in": () => { throw new Error("Assume your Gate watch before recording entry, exit or movement."); } }); open = form;
  await form.open();
  const capture = createSilentGateCheckIn(parsers);
  for (const text of ["Check in John Smith", "Halliburton", "ABC 123", "Texas"]) capture.hear(page(), text);
  const review = capture.review(page())!;
  await expect(confirmGateCheckIn(review.key)).rejects.toThrow("Assume your Gate watch");
  expect(capture.review(page())).toMatchObject({ ready: true, key: review.key });
  await expect(confirmGateCheckIn("stale")).rejects.toThrow("check-in changed");
});

it("stages one matching visitor for check-out and saves it only after approval", async () => {
  const { form, calls } = desk(); open = form;
  await form.open();
  const said = voice();
  expect(form.hearCheckOut("Check out John Smith.", said)).toBe(true);
  await vi.waitFor(() => expect(said.say).toHaveBeenCalledWith("John Smith. Say yes to check out."));
  expect(readGateVoiceDraft()?.checkoutReview).toMatchObject({ id: 73, company: "Halliburton" });
  expect(calls.some(call => call.method === "POST")).toBe(false);
  expect(form.hearCheckOut("yes", said)).toBe(true);
  await vi.waitFor(() => expect(said.say).toHaveBeenCalledWith("John Smith is checked out."));
  expect(calls.at(-1)).toEqual({ method: "POST", path: "/visits/gate/73/check-out", body: { gateStationId: "outer", latitude: 31.9, longitude: -102.1 } });
  expect(readGateVoiceDraft()?.checkoutReview).toBeUndefined();
});

it("does not guess between visitors, drops a refused check-out, and reports one that did not leave the property", async () => {
  const { form, calls } = desk({ "check-out": () => ({ id: 73, checkOutTime: null }) }); open = form;
  await form.open();
  const said = voice();
  form.hearCheckOut("check out Webb", said);
  await vi.waitFor(() => expect(said.fail).toHaveBeenCalledWith("More than one match. Say check out with the full name or tag."));
  form.hearCheckOut("check out Nobody", said);
  await vi.waitFor(() => expect(said.fail).toHaveBeenCalledWith("No matching visitor found."));
  expect(form.hearCheckOut("check out", said)).toBe(true);
  expect(said.say).toHaveBeenLastCalledWith("Say check out, then the name or tag.");
  form.hearCheckOut("check out ABC123", said);
  await vi.waitFor(() => expect(readGateVoiceDraft()?.checkoutReview).toBeTruthy());
  form.hearCheckOut("no", said);
  expect(said.say).toHaveBeenLastCalledWith("Not submitted.");
  expect(readGateVoiceDraft()?.checkoutReview).toBeUndefined();
  expect(calls.some(call => call.method === "POST")).toBe(false);
  form.hearCheckOut("check out ABC123", said);
  await vi.waitFor(() => expect(readGateVoiceDraft()?.checkoutReview).toBeTruthy());
  form.hearCheckOut("confirm", said);
  // A save that failed is marked as such, so it is shown as "Not saved"; a lookup that found nobody is not.
  await vi.waitFor(() => expect(said.fail).toHaveBeenCalledWith("Check-out from the property is not confirmed. Review this visit on the Gate page.", true));
  expect(said.fail).toHaveBeenCalledWith("No matching visitor found.");
  // Still waiting: nothing was announced as saved.
  expect(readGateVoiceDraft()?.checkoutReview).toBeTruthy();
});

it("stands in for the Gate page's form only while it is open", async () => {
  const pageDraft = { siteLocationId: 9, gateStationId: "page-gate", pagePath: "/gate" };
  const unregister = registerGateVoiceForm({ read: () => pageDraft, saved: () => {} });
  const { form } = desk();
  try {
    await form.open();
    expect(readGateVoiceDraft()).toMatchObject({ watchForm: true, gateStationId: "outer" });
    form.close();
    expect(readGateVoiceDraft()).toBe(pageDraft);
  } finally { unregister(); }
});
