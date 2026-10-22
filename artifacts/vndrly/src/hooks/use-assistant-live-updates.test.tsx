import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useAssistant } from "./use-assistant";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  close = vi.fn();
  addEventListener = vi.fn();
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
