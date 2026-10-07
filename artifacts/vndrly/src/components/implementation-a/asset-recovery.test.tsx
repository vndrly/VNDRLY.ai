import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./client", () => ({ implementationARequest: api.request }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: (p: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...p} />
  ),
}));
import { InventoryRecoveryWrite, InventoryRecovery } from "./asset-recovery";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => {
  cleanup();
  api.request.mockReset();
});
function review() {
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "User reports missing radio" },
  });
  fireEvent.click(screen.getByText("Review exact request"));
  fireEvent.click(screen.getByText("Confirm reviewed request"));
}
it("retains exact loss UUID, asset, condition, reason and base version after unknown outcome", async () => {
  api.request
    .mockRejectedValueOnce(Error("Dropped"))
    .mockImplementationOnce(async (_p: string, i: RequestInit) => {
      const b = JSON.parse(String(i.body));
      return {
        assetId: id,
        operationId: b.operationId,
        version: 5,
        status: "applied",
        condition: b.condition,
        holderUserId: 17,
        physicalLossVerified: false,
      };
    });
  const saved = vi.fn().mockResolvedValue(null);
  const view = render(
    <InventoryRecoveryWrite
      identity="one"
      assetId={id}
      version={4}
      kind="loss"
      onSaved={saved}
    />,
  );
  review();
  await screen.findByText(/Outcome is unverified/);
  view.rerender(
    <InventoryRecoveryWrite
      identity="one"
      assetId={id}
      version={9}
      kind="loss"
      onSaved={saved}
    />,
  );
  fireEvent.click(screen.getByText("Retry exact request"));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(api.request.mock.calls[1]).toEqual(api.request.mock.calls[0]);
  expect(JSON.parse(api.request.mock.calls[1][1].body)).toMatchObject({
    expectedVersion: 4,
    condition: "missing",
    confirmed: true,
  });
});
it("fences late rejected responses after account and asset change", async () => {
  let reject!: (e: Error) => void;
  api.request.mockImplementation(
    () =>
      new Promise((_r, j) => {
        reject = j;
      }),
  );
  const view = render(
    <InventoryRecoveryWrite
      identity="one"
      assetId={id}
      version={4}
      kind="loss"
      onSaved={vi.fn()}
    />,
  );
  review();
  view.rerender(
    <InventoryRecoveryWrite
      identity="two"
      assetId="22222222-2222-4222-8222-222222222222"
      version={7}
      kind="loss"
      onSaved={vi.fn()}
    />,
  );
  reject(Error("Dropped"));
  await waitFor(() =>
    expect(
      (screen.getByText("Review exact request") as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("Retry exact request")).toBeNull();
});
it("does not claim success for mismatched or physically verified receipt", async () => {
  api.request.mockImplementation(async (_p: string, i: RequestInit) => {
    const b = JSON.parse(String(i.body));
    return {
      assetId: id,
      operationId: b.operationId,
      version: 5,
      status: "applied",
      condition: b.condition,
      physicalLossVerified: true,
    };
  });
  const saved = vi.fn();
  render(
    <InventoryRecoveryWrite
      identity="one"
      assetId={id}
      version={4}
      kind="loss"
      onSaved={saved}
    />,
  );
  review();
  await screen.findByText(/Outcome is unverified/);
  expect(saved).not.toHaveBeenCalled();
});
it.each([
  { role: "manager", canManage: true, userId: 20, loss: true, claims: true },
  {
    role: "holder worker",
    canManage: false,
    userId: 17,
    loss: true,
    claims: false,
  },
  {
    role: "office nonholder",
    canManage: false,
    userId: 20,
    loss: false,
    claims: false,
  },
])(
  "offers only projected recovery controls for $role",
  async ({ canManage, userId, loss, claims }) => {
    api.request.mockImplementation(async (p: string) =>
      p.endsWith("identifier-claims")
        ? { claims: [], incoming: [], truncated: false }
        : {
            id,
            version: 4,
            holderUserId: 17,
            lastCustody: {
              holderUserId: 17,
              holderDisplayName: "Fictional worker",
              recordedAt: "2026-10-07T00:00:00Z",
            },
            gpsTag: { status: "not_connected", location: null },
          },
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <InventoryRecovery
          assetId={id}
          identity="one"
          userId={userId}
          canManage={canManage}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByText("Inventory recovery and identifier review"),
    );
    await screen.findByText(/Live tag tracking is not connected/);
    expect(screen.queryAllByText(/This records a user report/).length > 0).toBe(
      loss,
    );
    expect(
      screen.queryAllByText(/An identifier collision requires/).length > 0,
    ).toBe(claims);
  },
);

it("validates the exact new claim and saved identifier before accepting a response", async () => {
  api.request.mockImplementation(async (_path: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    return {
      id: b.claimId,
      assetId: id,
      operationId: b.operationId,
      version: 1,
      status: "pending_review",
      alias: { ...b.alias, value: "substituted" },
      ownershipTransferred: false,
      otherOwnerDisclosed: false,
    };
  });
  const saved = vi.fn();
  render(
    <InventoryRecoveryWrite
      identity="one"
      assetId={id}
      version={4}
      kind="claim"
      onSaved={saved}
    />,
  );
  fireEvent.change(screen.getByLabelText("Reason"), {
    target: { value: "Recorded identifier collision" },
  });
  fireEvent.change(screen.getByLabelText("Identifier"), {
    target: { value: "SYNTHETIC-RADIO" },
  });
  fireEvent.click(screen.getByText("Review exact request"));
  fireEvent.click(screen.getByText("Confirm reviewed request"));
  await screen.findByText(/Outcome is unverified/);
  expect(saved).not.toHaveBeenCalled();
  const first = api.request.mock.calls[0];
  api.request.mockImplementation(async (_path: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    return {
      id: b.claimId,
      assetId: id,
      operationId: b.operationId,
      version: 1,
      status: "pending_review",
      alias: b.alias,
      ownershipTransferred: false,
      otherOwnerDisclosed: false,
    };
  });
  fireEvent.click(screen.getByText("Retry exact request"));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(api.request.mock.calls[1]).toEqual(first);
});
