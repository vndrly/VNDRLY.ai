import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
import { connectorRequest } from "./connector-client";
afterEach(() => vi.unstubAllGlobals());
it("recovers a mailbox read after an empty gateway response", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("", { status: 502 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ id: "inbox" }] })),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await connectorRequest("/accounts/test/folders")).toEqual({
    items: [{ id: "inbox" }],
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not replay a send when its response is empty", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 502 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    connectorRequest("/accounts/test/mail", { draft: false }),
  ).rejects.toThrow("Unable to load the connection response");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves authorization errors without retrying", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response('{"message":"Sign in required"}', { status: 401 }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(connectorRequest("/accounts")).rejects.toThrow(
    "Sign in required",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
