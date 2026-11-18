import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useAssistant } from "./use-assistant";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  close = vi.fn();
  listeners = new Map<string, EventListener>();
  addEventListener = vi.fn((name: string, listener: EventListener) => { this.listeners.set(name, listener); });
  removeEventListener = vi.fn();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
}

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
});
it("keeps guide offers and setup progress when saved voice turns refresh from the device stream", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const gateWorkflowOffer = { kind: "gate_workflow_offer", companyId: 22, workflowKey: "gate-vehicle-check-in", context: {} };
  const gateSetupProgress = { kind: "gate_setup_progress", workflowKey: "first-watch", state: "actionable" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: 8, messages: [{ id: 19, role: "assistant", content: "Guide ready", gateWorkflowOffer, gateSetupProgress }] }))));
  const { result } = renderHook(() => useAssistant({ liveUpdates: true }));
  await act(async () => { await FakeEventSource.instances[0].listeners.get("work_hub.askv.conversation_changed")!(new MessageEvent("message", { data: JSON.stringify({ conversationId: 8 }) })); });
  expect(result.current.messages.at(-1)).toMatchObject({ gateWorkflowOffer, gateSetupProgress });
});

it("keeps the cross-device stream closed until the assistant panel is open", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("null", { status: 200 })));

  const { rerender } = renderHook(
    ({ liveUpdates }: { liveUpdates: boolean }) => useAssistant({ liveUpdates }),
    { initialProps: { liveUpdates: false } },
  );

  await Promise.resolve();
  expect(FakeEventSource.instances).toHaveLength(0);

  rerender({ liveUpdates: true });
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

  rerender({ liveUpdates: false });
  await waitFor(() => expect(FakeEventSource.instances[0].close).toHaveBeenCalledOnce());
});
