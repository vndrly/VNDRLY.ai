import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useAssistant } from "./use-assistant";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  document.body.querySelector('.gate-map-page')?.remove();
});

it.each([
  ["/gate/map", "/gate/map", "Requested screen opened."],
  ["https://example.invalid", "/", "The navigation response did not contain a valid web destination."],
])("reports the actual navigation result for %s instead of unverified server prose", async (path, destination, message) => {
  const page = document.createElement('div');
  page.className = 'gate-map-page';
  page.innerHTML = '<h1>Gate Map</h1>';
  document.body.appendChild(page);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/conversations")) {
      return new Response(JSON.stringify({ id: 8 }), { status: 200 });
    }
    return new Response(
      `event: client_intent\ndata: ${JSON.stringify({ intent: { name: "open_screen", arguments: { screen: "gate-map", path } } })}\n\n` +
      'event: done\ndata: {"content":"I opened it successfully.","assistantMessageId":23}\n\n',
      { status: 200 },
    );
  }));

  const { result } = renderHook(() => useAssistant());
  await act(async () => { await result.current.send("Open Gate Map"); });

  await waitFor(() => expect(window.location.pathname).toBe(destination));
  expect(result.current.messages.at(-1)).toMatchObject({
    role: "assistant",
    content: message,
    pending: false,
  });
});
