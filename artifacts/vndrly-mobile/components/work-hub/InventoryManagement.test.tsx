import React from "react";
import { createHash, randomUUID } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { inventoryManagementFingerprintValues } from "@workspace/api-zod";
import { InventoryManagement } from "./InventoryManagement";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  current: true,
  change: null as null | (() => void),
}));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => mocks.current,
  getUser: () => ({ id: 3 }),
  subscribeUser: (f: () => void) => {
    mocks.change = f;
    return () => {};
  },
  subscribeToken: () => () => {},
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => randomUUID(),
  CryptoDigestAlgorithm: { SHA256: "sha" },
  digestStringAsync: async (_a: string, s: string) =>
    createHash("sha256").update(s).digest("hex"),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
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
  },
  policy = {
    identifierRequired: true,
    photosRequiredOnCheckout: false,
    photosRequiredOnReturn: false,
    supervisorApprovalRequired: false,
    expectedReturnRequired: false,
  };
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
  mocks.current = true;
});
it("retains original command through denied recovery and later saves exact receipt", async () => {
  let denied = false,
    saved: any = null;
  const bodies: string[] = [];
  mocks.api.mockImplementation(async (p: string, i: any, scope: any) => {
    expect(scope).toEqual({ generation: 1 });
    if (p.includes("operations")) {
      if (denied) throw Error("Denied");
      return { receipt: saved };
    }
    if (i.method === "PUT") {
      bodies.push(i.body);
      const input = JSON.parse(i.body);
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
      denied = true;
      throw Error("Dropped");
    }
    return { owner, category: "equipment", version: 0, policy };
  });
  render(
    <InventoryManagement
      owner={owner}
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
  await screen.findByText("inventoryManagement.unknown");
  fireEvent.click(screen.getByText("inventoryManagement.retry"));
  await waitFor(() =>
    expect(
      mocks.api.mock.calls.filter(([p]) => p.includes("operations")),
    ).toHaveLength(3),
  );
  denied = false;
  fireEvent.click(screen.getByText("inventoryManagement.retry"));
  await screen.findByText("inventoryManagement.savedRefresh");
  expect(bodies).toHaveLength(1);
});
it("invalidated account clears prepared fields and cannot post", async () => {
  mocks.api.mockResolvedValue({
    owner,
    category: "equipment",
    version: 0,
    policy,
  });
  render(
    <InventoryManagement
      owner={owner}
      asset={asset}
      assets={[asset]}
      canManage
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("inventoryManagement.policy"));
  await screen.findByText("inventoryManagement.identifierRequired");
  fireEvent.click(screen.getByText("inventoryManagement.review"));
  await screen.findByText("inventoryManagement.save");
  mocks.current = false;
  fireEvent.click(screen.getByText("inventoryManagement.save"));
  expect(mocks.api.mock.calls.every(([, i]) => i.method === "GET")).toBe(true);
});
