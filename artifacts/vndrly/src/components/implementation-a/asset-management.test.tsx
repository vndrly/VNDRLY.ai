import { randomUUID, webcrypto, createHash } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { inventoryManagementFingerprintValues } from "@workspace/api-zod";
import { InventoryManagement } from "./asset-management";
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, onClick, disabled, ...p }: any) => (
    <button onClick={onClick} disabled={disabled} {...p}>
      {children}
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
const owner = { type: "vendor", id: 7 } as const,
  asset = {
    id: randomUUID(),
    name: "Synthetic radio",
    category: "equipment",
    version: 1,
    status: "available",
    holderUserId: null,
  };
const policy = {
  identifierRequired: true,
  photosRequiredOnCheckout: false,
  photosRequiredOnReturn: false,
  supervisorApprovalRequired: false,
  expectedReturnRequired: false,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("recovers exact policy after lost response and keeps saved result when refresh fails", async () => {
  let saved: any = null;
  const fetcher = vi.fn(async (p: string, i?: RequestInit) => {
    if (i?.method === "PUT") {
      const input = JSON.parse(String(i.body));
      saved = {
        operationId: input.operationId,
        actorUserId: 3,
        owner,
        action: "policy",
        targetId: "equipment",
        commandFingerprint: createHash("sha256")
          .update(
            JSON.stringify(
              inventoryManagementFingerprintValues(
                "policy",
                3,
                owner,
                "equipment",
                input,
              ),
            ),
          )
          .digest("hex"),
        previousVersion: 0,
        version: 1,
        policy: input.policy,
        previousPolicy: policy,
        recordedAt: "2026-10-07T12:00:00.000Z",
        status: "applied",
        physicalPossessionVerified: false,
        legalOwnershipVerified: false,
      };
      throw Error("Dropped");
    }
    return {
      ok: true,
      json: async () =>
        p.includes("operations")
          ? { receipt: saved }
          : { owner, category: "equipment", version: 0, policy },
    };
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", { randomUUID, subtle: webcrypto.subtle });
  render(
    <InventoryManagement
      owner={owner}
      identity="a"
      userId={3}
      asset={asset}
      assets={[asset]}
      canManage
      onSaved={async () => {
        throw Error("Refresh");
      }}
    />,
  );
  fireEvent.click(screen.getByText("inventoryManagement.policy"));
  await screen.findByText("inventoryManagement.identifierRequired");
  fireEvent.click(screen.getByText("inventoryManagement.review"));
  fireEvent.click(await screen.findByText("inventoryManagement.save"));
  await screen.findByText("inventoryManagement.savedRefresh");
  expect(
    fetcher.mock.calls.filter(([, i]) => i?.method === "PUT"),
  ).toHaveLength(1);
  expect(saved.policy).toEqual(policy);
});
it("denied readback locks exact review and never sends a new policy command", async () => {
  const fetcher = vi.fn(async (p: string, _i?: RequestInit) => ({
    ok: !p.includes("operations"),
    status: 403,
    json: async () =>
      p.includes("operations")
        ? { code: "Denied" }
        : { owner, category: "equipment", version: 0, policy },
  }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", { randomUUID, subtle: webcrypto.subtle });
  const { rerender } = render(
    <InventoryManagement
      owner={owner}
      identity="a"
      userId={3}
      asset={asset}
      assets={[asset]}
      canManage
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("inventoryManagement.policy"));
  await screen.findByText("inventoryManagement.identifierRequired");
  fireEvent.click(screen.getByText("inventoryManagement.review"));
  fireEvent.click(await screen.findByText("inventoryManagement.save"));
  await screen.findByText("inventoryManagement.unknown");
  fireEvent.click(screen.getByText("inventoryManagement.retry"));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([p]) => p.includes("operations")),
    ).toHaveLength(2),
  );
  expect(fetcher.mock.calls.every(([, i]) => !i?.method)).toBe(true);
  rerender(
    <InventoryManagement
      owner={owner}
      identity="b"
      userId={4}
      asset={asset}
      assets={[asset]}
      canManage
      onSaved={vi.fn()}
    />,
  );
  expect(screen.queryByText("inventoryManagement.retry")).toBeNull();
});
