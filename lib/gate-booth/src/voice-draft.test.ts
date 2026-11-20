import { afterEach, expect, it } from "vitest";
import { registerGateVoiceForm, notifyGateVoiceDraftChanged, waitForGateCapture } from "./voice-draft";
let unregister: (() => void) | undefined;
afterEach(() => unregister?.());
it("waits for evidence without requiring a second submit", async () => {
  const draft = { siteLocationId: 1, captureId: 2, capturePending: true, platePhotoUrl: "" };
  unregister = registerGateVoiceForm({ read: () => draft, saved() {} });
  let finished = false;
  const waiting = waitForGateCapture().then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  draft.platePhotoUrl = "/objects/photo"; draft.capturePending = false; notifyGateVoiceDraftChanged();
  await waiting; expect(finished).toBe(true);
});
it("rejects a failed upload instead of silently dropping the evidence", async () => {
  const draft = { capturePending: true, captureError: "", captureId: 2 };
  unregister = registerGateVoiceForm({ read: () => draft, saved() {} });
  const waiting = expect(waitForGateCapture()).rejects.toThrow("Upload failed");
  draft.captureError = "Upload failed"; draft.capturePending = false; notifyGateVoiceDraftChanged();
  await waiting;
});
it("does not submit a different draft after cancellation", async () => {
  const draft = { capturePending: true, captureId: 2 };
  unregister = registerGateVoiceForm({ read: () => ({ ...draft }), saved() {} });
  const waiting = expect(waitForGateCapture()).rejects.toThrow("check-in changed");
  draft.captureId = 3; draft.capturePending = false; notifyGateVoiceDraftChanged();
  await waiting;
});
