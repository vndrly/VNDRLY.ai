import { afterEach, expect, it, vi } from "vitest";
import { readGateVoiceDraft, notifyGateVoiceSaved, readGateVoiceGuidance, publishGateVoiceWorkflowResult } from "@workspace/gate-booth";
const callbacks = vi.hoisted(() => ({ prefill: undefined as any, refresh: undefined as any }));
vi.mock("./askv-client-tools", () => ({
  subscribeAskVGatePrefill: (fn: any) => { callbacks.prefill = fn; return () => { callbacks.prefill = undefined; }; },
  subscribeAskVDataChanged: (fn: any) => { callbacks.refresh = fn; return () => { callbacks.refresh = undefined; }; },
}));
import { createGateAskVBridge } from "./gate-askv-bridge";
afterEach(() => vi.useRealTimers());
it("shares the actual Next Steps control and returns workflow offers to the owning page", () => {
  const send = vi.fn(), bridge = createGateAskVBridge(7, send);
  const guidance = { companyId: 22, state: "ready", active: { key: "gate-vehicle-check-in", title: "Check in" }, available: [], control: { prompt: "Enter a plate", targetId: "plate" } };
  bridge.receive({ type: "gate-askv-state", userId: 7, pageId: "guided", draft: {}, gateGuidance: guidance });
  expect(readGateVoiceGuidance()?.control?.targetId).toBe("plate");
  const result = { question: "Guide this check in", gateWorkflowOffer: { kind: "gate_workflow_offer" as const, companyId: 22, workflowKey: "gate-vehicle-check-in" as const, context: {} } };
  publishGateVoiceWorkflowResult(result);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ pageId: "guided", action: "workflow-result", result }));
  bridge.clear(); expect(readGateVoiceGuidance()).toBeUndefined(); send.mockClear(); publishGateVoiceWorkflowResult(result); expect(send).not.toHaveBeenCalled(); bridge.dispose();
});
it("shares authenticated current drafts and waits for the page acknowledgment", async () => {
  const send = vi.fn(), bridge = createGateAskVBridge(7, send);
  try {
    bridge.receive({ type: "gate-askv-state", userId: 8, pageId: "wrong", draft: { firstName: "Wrong" } });
    expect(readGateVoiceDraft()).toBeUndefined();
    bridge.receive({ type: "gate-askv-state", userId: 7, pageId: "page", draft: { firstName: "Ana", siteLocationId: 9 } });
    expect(readGateVoiceDraft()?.firstName).toBe("Ana");
    let acknowledged = false;
    const result = callbacks.prefill({ values: { lastName: "Reed" } }).then(() => { acknowledged = true; });
    await Promise.resolve(); expect(acknowledged).toBe(false);
    const requestId = send.mock.calls[0][0].requestId;
    bridge.receive({ type: "gate-askv-state", userId: 7, pageId: "page", requestId, draft: { firstName: "Ana", lastName: "Reed", siteLocationId: 9 } });
    await result; expect(acknowledged).toBe(true);
    notifyGateVoiceSaved({ firstName: "Ana", lastName: "Reed" });
    expect(send.mock.calls.at(-1)?.[0].action).toBe("saved");
    callbacks.refresh(); expect(send.mock.calls.at(-1)?.[0].action).toBe("refresh");
  } finally { bridge.dispose(); }
  expect(readGateVoiceDraft()).toBeUndefined();
});
it("rejects pending prefills when navigating or timing out rather than claiming success", async () => {
  vi.useFakeTimers(); const bridge = createGateAskVBridge(7, vi.fn());
  bridge.receive({ type: "gate-askv-state", userId: 7, pageId: "page", draft: {} });
  const rejected = expect(callbacks.prefill({ values: {} })).rejects.toThrow("Gate page changed");
  bridge.clear(); await rejected;
  bridge.receive({ type: "gate-askv-state", userId: 7, pageId: "next", draft: {} });
  const timeout = expect(callbacks.prefill({ values: {} })).rejects.toThrow("did not acknowledge");
  await vi.advanceTimersByTimeAsync(5000); await timeout; bridge.dispose();
});
