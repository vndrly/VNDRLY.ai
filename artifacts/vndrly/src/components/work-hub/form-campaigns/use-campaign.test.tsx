import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  user: { userId: 1, activeMembershipId: 3, vendorId: 9, partnerId: null },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/work-hub-client", () => ({
  workHubRequest: mocks.request,
  commandEnvelope: (_owner: any, payload: any, _id: any, version: any) => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    payload,
    expectedVersion: version,
  }),
}));
import { useCampaign } from "./use-campaign";
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderHook(({ path }) => useCampaign(path, (x) => x), {
    initialProps: { path: "/options" },
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
describe("campaign recovery", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({});
  });
  it("recovers the original save and invokes its completion exactly once", async () => {
    const bodies: string[] = [];
    let writes = 0;
    mocks.request.mockImplementation(async (_p, options) => {
      if (!options) return {};
      bodies.push(options.body);
      if (++writes === 1) throw Error("response lost");
      return {
        operationId: "00000000-0000-4000-8000-000000000001",
        resource: { campaignId: "saved" },
        appliedAt: "2026-10-14T00:00:00.000Z",
        replayed: true,
      };
    });
    const saved = vi.fn();
    const h = setup();
    await waitFor(() => expect(h.result.current.query.isSuccess).toBe(true));
    act(() =>
      h.result.current.send(
        { path: "/campaigns", payload: { title: "Policy" } },
        { onSuccess: saved },
      ),
    );
    await waitFor(() => expect(h.result.current.uncertain).toBe(true));
    act(() => h.result.current.retry());
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(bodies[0]).toBe(bodies[1]);
    expect(h.result.current.uncertain).toBe(false);
  });
});

it("does not apply an earlier view's completion after navigating to another assignment", async () => {
  let resolve!: (value: unknown) => void;
  mocks.request.mockImplementation((_path, options) =>
    options
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve({}),
  );
  const saved = vi.fn(),
    h = setup();
  await waitFor(() => expect(h.result.current.query.isSuccess).toBe(true));
  act(() =>
    h.result.current.send(
      {
        path: "/library/instances/a/complete",
        payload: { acknowledged: true },
      },
      { onSuccess: saved },
    ),
  );
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  h.rerender({ path: "/library/instances/b" });
  await act(async () => {
    resolve({
      operationId: "00000000-0000-4000-8000-000000000001",
      resource: { instanceId: "a" },
      appliedAt: "2026-10-14T00:00:00.000Z",
      replayed: false,
    });
  });
  await waitFor(() => expect(h.result.current.mutation.isPending).toBe(false));
  expect(saved).not.toHaveBeenCalled();
});
