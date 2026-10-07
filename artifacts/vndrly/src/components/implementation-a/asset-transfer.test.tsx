import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { InventoryTransfer } from "./asset-transfer";
import {
  AssetTransferInputSchema,
  assetTransferFingerprintValues,
} from "@workspace/api-zod";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./client", () => ({ implementationARequest: mocks.request }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, color: _color, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
const id = "11111111-1111-4111-8111-111111111111";
const choices = {
  assetId: id,
  actorUserId: 11,
  version: 2,
  holderUserId: 11,
  canTransfer: true,
  recipients: [{ userId: 12, displayName: "Synthetic coworker" }],
  truncated: false,
};
beforeEach(() => {
  mocks.request.mockReset();
  mocks.request.mockResolvedValue(choices);
});
const props = {
  assetId: id,
  assetName: "Radio",
  userId: 11,
  identity: "actor11/vendor7/member1",
  canTransfer: true,
  onSaved: vi.fn(),
};
async function review() {
  fireEvent.click(screen.getByText("Prepare custody transfer"));
  await screen.findByText("Synthetic coworker");
  fireEvent.change(screen.getByLabelText("Recipient"), {
    target: { value: "12" },
  });
  fireEvent.change(screen.getByLabelText("Observed condition"), {
    target: { value: "good" },
  });
  fireEvent.click(screen.getByText("Review exact transfer"));
}
it("requires explicit review and keeps the exact unknown operation before any retry", async () => {
  mocks.request.mockImplementation(async (path: string) =>
    path.includes("transfer-recipients")
      ? choices
      : path.includes("/transfers/")
        ? { receipt: null, currentVersion: 2 }
        : Promise.reject(new Error("lost response")),
  );
  render(<InventoryTransfer {...props} />);
  await review();
  expect(
    mocks.request.mock.calls.some(([, init]) => init?.method === "POST"),
  ).toBe(false);
  fireEvent.click(screen.getByText("Confirm reviewed transfer"));
  await screen.findByText(/Transfer outcome is unverified/);
  const first = mocks.request.mock.calls.find(
    ([, init]) => init?.method === "POST",
  )![1].body;
  fireEvent.click(screen.getByText("Retry exact reviewed transfer"));
  await waitFor(() =>
    expect(
      mocks.request.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(2),
  );
  expect(
    mocks.request.mock.calls.filter(([, init]) => init?.method === "POST")[1][1]
      .body,
  ).toBe(first);
  expect(JSON.parse(first)).toMatchObject({
    expectedVersion: 2,
    toHolderUserId: 12,
    condition: "good",
    confirmed: true,
  });
});
it("retains the reviewed attempt without POST when readback is denied", async () => {
  render(<InventoryTransfer {...props} />);
  await review();
  mocks.request.mockRejectedValue(new Error("asset.transfer_forbidden"));
  fireEvent.click(screen.getByText("Confirm reviewed transfer"));
  await screen.findByText(/Transfer outcome is unverified/);
  expect(
    mocks.request.mock.calls.some(([, init]) => init?.method === "POST"),
  ).toBe(false);
});
it("denies stale schedule-style rebasing and hides new transfer for unsupported authority", async () => {
  render(<InventoryTransfer {...props} />);
  await review();
  mocks.request.mockImplementation(async (path: string) =>
    path.includes("/transfers/")
      ? { receipt: null, currentVersion: 3 }
      : { ...choices, version: 3 },
  );
  fireEvent.click(screen.getByText("Confirm reviewed transfer"));
  await screen.findByText(/The saved asset or permission changed/);
  expect(
    mocks.request.mock.calls.some(([, init]) => init?.method === "POST"),
  ).toBe(false);
});
it("verifies the exact saved event and preserves recorded status when refresh fails", async () => {
  let input: any;
  mocks.request.mockImplementation(async (path: string, init: any) => {
    if (path.includes("transfer-recipients")) return choices;
    if (init?.method === "POST") {
      input = AssetTransferInputSchema.parse(JSON.parse(init.body));
      return { status: "applied" };
    }
    if (!input) return { receipt: null, currentVersion: 2 };
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify(assetTransferFingerprintValues(id, 11, 11, input)),
      ),
    );
    return {
      currentVersion: 4,
      receipt: {
        assetId: id,
        operationId: input.operationId,
        actorUserId: 11,
        fromHolderUserId: 11,
        toHolderUserId: 12,
        condition: "good",
        commandFingerprint: Array.from(new Uint8Array(bytes))
          .map((x) => x.toString(16).padStart(2, "0"))
          .join(""),
        recordedAt: "2026-10-07T10:00:00.000Z",
        physicalHandoffVerified: false,
      },
    };
  });
  render(
    <InventoryTransfer
      {...props}
      onSaved={async () => {
        throw new Error("refresh failed");
      }}
    />,
  );
  await review();
  fireEvent.click(screen.getByText("Confirm reviewed transfer"));
  await screen.findByText(
    "Transfer recorded; current Inventory could not be refreshed.",
  );
  expect(screen.queryByText("Retry exact reviewed transfer")).toBeNull();
  expect(screen.queryByText("Prepare custody transfer")).toBeNull();
});
it("stops a delayed preparation after account context changes and exposes no unsupported control", async () => {
  let release!: (value: unknown) => void;
  mocks.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = render(<InventoryTransfer {...props} />);
  fireEvent.click(screen.getByText("Prepare custody transfer"));
  view.rerender(
    <InventoryTransfer
      {...props}
      identity="otheraccount"
      userId={22}
      canTransfer={false}
    />,
  );
  release(choices);
  await waitFor(() => expect(screen.queryByLabelText("Recipient")).toBeNull());
  expect(screen.queryByText("Prepare custody transfer")).toBeNull();
  expect(
    mocks.request.mock.calls.some(([, init]) => init?.method === "POST"),
  ).toBe(false);
});
