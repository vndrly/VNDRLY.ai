import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
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
import { InventoryClaimContinuation } from "./asset-claim-continuation";
import type { AssetIdentifierClaim } from "@workspace/api-zod";
const claim: AssetIdentifierClaim = {
  id: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  alias: { kind: "serial", value: "SYNTHETIC" },
  status: "awaiting_evidence",
  version: 3,
  operationId: "33333333-3333-4333-8333-333333333333",
  submittedAt: new Date().toISOString(),
  reviewedAt: null,
  reason: "Original request",
  reviewReason: "Explain collision",
  ownershipTransferred: false,
  otherOwnerDisclosed: false,
  requesterActions: ["respond", "withdraw"],
};
afterEach(() => {
  cleanup();
  api.request.mockReset();
});
function prepare(action = "Respond to evidence request") {
  fireEvent.change(screen.getByLabelText("Response or withdrawal reason"), {
    target: { value: "Synthetic clarification only" },
  });
  fireEvent.click(screen.getByText(action));
  fireEvent.click(screen.getByText("Confirm reviewed claim request"));
}
function receipt(body: any, status = "pending_review") {
  return {
    ...claim,
    requesterActions: undefined,
    operationId: body.operationId,
    version: body.expectedVersion + 1,
    status,
    responseReason: body.reason,
    physicalEvidenceVerified: false,
  };
}
it("shows no requester controls without actual sourced actions, including mediator/incoming projection", () => {
  render(
    <InventoryClaimContinuation
      identity="platform"
      claim={{ ...claim, requesterActions: [] }}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.queryByText("Respond to evidence request")).toBeNull();
});
it("retains exact claim/version/text/UUID after unknown and reads saved operation before any resend", async () => {
  let body: any;
  api.request
    .mockImplementationOnce(async (_p: string, o: RequestInit) => {
      body = JSON.parse(String(o.body));
      throw Error("Dropped");
    })
    .mockImplementationOnce(async () => ({ claims: [receipt(body)] }));
  const saved = vi.fn().mockResolvedValue(null);
  const v = render(
    <InventoryClaimContinuation identity="one" claim={claim} onSaved={saved} />,
  );
  prepare();
  await screen.findByText(/Result unverified/);
  v.rerender(
    <InventoryClaimContinuation
      identity="one"
      claim={{ ...claim, version: 9 }}
      onSaved={saved}
    />,
  );
  fireEvent.click(screen.getByText("Retry exact claim request"));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api.request.mock.calls).toHaveLength(2);
  expect(api.request.mock.calls[1][1]).toBeUndefined();
  expect(body).toMatchObject({
    expectedVersion: 3,
    reason: "Synthetic clarification only",
    confirmed: true,
  });
});
it("denied readback retains original attempt and never sends another mutation", async () => {
  api.request
    .mockRejectedValueOnce(Error("Dropped"))
    .mockRejectedValueOnce(Error("asset.not_found"));
  render(
    <InventoryClaimContinuation
      identity="one"
      claim={claim}
      onSaved={vi.fn()}
    />,
  );
  prepare();
  await screen.findByText(/Result unverified/);
  fireEvent.click(screen.getByText("Retry exact claim request"));
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
  expect(api.request.mock.calls[1][1]).toBeUndefined();
  expect(screen.getByText("Retry exact claim request")).toBeTruthy();
});
it("accepts exact withdrawn receipt and refuses physical evidence claims", async () => {
  api.request.mockImplementation(async (_p: string, o: RequestInit) => ({
    ...receipt(JSON.parse(String(o.body)), "withdrawn"),
    physicalEvidenceVerified: true,
  }));
  const saved = vi.fn();
  render(
    <InventoryClaimContinuation identity="one" claim={claim} onSaved={saved} />,
  );
  prepare("Withdraw identifier claim");
  await screen.findByText(/Result unverified/);
  expect(saved).not.toHaveBeenCalled();
  expect(api.request.mock.calls[0][0]).toMatch(/withdraw$/);
});
it("fences late rejected response after account/asset identity changes", async () => {
  let reject!: (e: Error) => void;
  api.request.mockImplementation(
    () =>
      new Promise((_r, j) => {
        reject = j;
      }),
  );
  const v = render(
    <InventoryClaimContinuation
      identity="one"
      claim={claim}
      onSaved={vi.fn()}
    />,
  );
  prepare();
  v.rerender(
    <InventoryClaimContinuation
      identity="two"
      claim={{ ...claim, assetId: "44444444-4444-4444-8444-444444444444" }}
      onSaved={vi.fn()}
    />,
  );
  reject(Error("Dropped"));
  await waitFor(() =>
    expect(screen.queryByText(/Result unverified/)).toBeNull(),
  );
  expect(screen.getByText("Respond to evidence request")).toBeTruthy();
});
it("saved response blocks stale actions after refresh failure until a new canonical claim arrives", async () => {
  api.request.mockImplementation(async (_p: string, o: RequestInit) =>
    receipt(
      JSON.parse(String(o.body)),
      _p.endsWith("/withdraw") ? "withdrawn" : "pending_review",
    ),
  );
  const saved = vi.fn().mockRejectedValue(Error("Read failed"));
  const v = render(
    <InventoryClaimContinuation identity="one" claim={claim} onSaved={saved} />,
  );
  prepare();
  await screen.findByText(/Claim saved. Refresh current records/);
  expect(screen.queryByText("Withdraw identifier claim")).toBeNull();
  expect(screen.queryByText("Respond to evidence request")).toBeNull();
  expect(api.request).toHaveBeenCalledTimes(1);
  v.rerender(
    <InventoryClaimContinuation
      identity="one"
      claim={{
        ...claim,
        version: 4,
        status: "pending_review",
        requesterActions: ["withdraw"],
      }}
      onSaved={saved}
    />,
  );
  expect(screen.getByText("Withdraw identifier claim")).toBeTruthy();
  expect(screen.queryByText("Respond to evidence request")).toBeNull();
  fireEvent.click(screen.getByText("Withdraw identifier claim"));
  fireEvent.click(screen.getByText("Confirm reviewed claim request"));
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
  expect(JSON.parse(api.request.mock.calls[1][1].body).expectedVersion).toBe(4);
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
});
