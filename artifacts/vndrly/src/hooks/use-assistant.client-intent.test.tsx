import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useAssistant } from "./use-assistant";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("shows the actual browser client-intent result instead of unverified server prose", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/conversations")) {
      return new Response(JSON.stringify({ id: 8 }), { status: 200 });
    }
    return new Response(
      'event: client_intent\ndata: {"intent":{"name":"open_screen","arguments":{"screen":"gatekeeper","path":"/gatekeeper"}}}\n\n' +
      'event: done\ndata: {"content":"I opened it successfully.","assistantMessageId":23}\n\n',
      { status: 200 },
    );
  }));

  const { result } = renderHook(() => useAssistant());
  await act(async () => { await result.current.send("Open Gate"); });

  await waitFor(() => expect(window.location.pathname).toBe("/gatekeeper"));
  expect(result.current.messages.at(-1)).toMatchObject({
    role: "assistant",
    content: "Requested screen opened. The form still requires review and completion.",
    pending: false,
  });
});
