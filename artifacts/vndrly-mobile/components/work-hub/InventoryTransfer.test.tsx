import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";
const m = vi.hoisted(() => ({
  api: vi.fn(),
  generation: 1,
  listeners: [] as (() => void)[],
}));
vi.mock("@/lib/api", () => ({ apiFetch: m.api }));
vi.mock("@/lib/auth", () => ({
  getUser: async () => ({ id: 7, role: "vendor", vendorId: 11 }),
  captureAuthScope: () => ({ generation: m.generation }),
  isAuthScopeCurrent: (s: any) => s.generation === m.generation,
  subscribeUser: (f: () => void) => {
    m.listeners.push(f);
    return () => {};
  },
  subscribeToken: () => () => {},
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "22222222-2222-4222-8222-222222222222",
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async () => "a".repeat(64),
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ text: "#fff", border: "#444" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
import { InventoryTransfer } from "./InventoryTransfer";
const assetId = "11111111-1111-4111-8111-111111111111",
  props = {
    assetId,
    owner: { type: "vendor" as const, id: 11 },
    onRefresh: vi.fn(),
  };
const choices = {
  assetId,
  version: 4,
  holderUserId: 7,
  actorUserId: 7,
  canTransfer: true,
  recipients: [{ userId: 8, displayName: "Fictional recipient" }],
  truncated: false,
};
beforeEach(() => {
  cleanup();
  m.api.mockReset();
  m.generation = 1;
  m.listeners = [];
});
describe("native transfer reviewed company recipient", () => {
  it("requires explicit selected recipient and condition review; denied recovery keeps exact original attempt", async () => {
    m.api.mockResolvedValueOnce(choices).mockRejectedValue({ status: 403 });
    render(<InventoryTransfer {...props} />);
    fireEvent.click(screen.getByText("Transfer custody"));
    await screen.findByText("Fictional recipient");
    fireEvent.click(screen.getByText("Fictional recipient"));
    fireEvent.click(screen.getByText("Good"));
    fireEvent.click(screen.getByText("Review transfer"));
    expect(
      screen.getByText(/Physical handoff and ownership are not verified/),
    ).toBeTruthy();
    fireEvent.click(await screen.findByText("Confirm reviewed transfer"));
    await screen.findByText("Check original transfer");
    fireEvent.click(screen.getByText("Check original transfer"));
    await waitFor(() => expect(m.api).toHaveBeenCalledTimes(3));
    expect(m.api.mock.calls[1][0]).toContain("/transfers/");
    expect(m.api.mock.calls[2][0]).toBe(m.api.mock.calls[1][0]);
    expect(m.api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });
  it("rejects foreign actor projection", async () => {
    m.api.mockResolvedValue({ ...choices, actorUserId: 9 });
    render(<InventoryTransfer {...props} />);
    fireEvent.click(screen.getByText("Transfer custody"));
    await screen.findByText("Transfer unavailable in the current account.");
    expect(screen.queryByText("Fictional recipient")).toBeNull();
  });
  it("current canTransfer false never exposes recipient controls", async () => {
    m.api.mockResolvedValue({ ...choices, canTransfer: false, recipients: [] });
    render(<InventoryTransfer {...props} />);
    fireEvent.click(screen.getByText("Transfer custody"));
    await screen.findByText("Transfer unavailable in the current account.");
    expect(screen.queryByText("Review transfer")).toBeNull();
  });
  it("keeps verified saved record when parent refresh fails", async () => {
    const receipt = {
      assetId,
      operationId: "22222222-2222-4222-8222-222222222222",
      actorUserId: 7,
      fromHolderUserId: 7,
      toHolderUserId: 8,
      condition: "good",
      commandFingerprint: "a".repeat(64),
      recordedAt: "2026-10-07T15:00:00Z",
      physicalHandoffVerified: false,
    };
    m.api
      .mockResolvedValueOnce(choices)
      .mockResolvedValueOnce({ receipt, currentVersion: 9 });
    render(
      <InventoryTransfer
        {...props}
        onRefresh={async () => {
          throw Error("refresh unavailable");
        }}
      />,
    );
    fireEvent.click(screen.getByText("Transfer custody"));
    fireEvent.click(await screen.findByText("Fictional recipient"));
    fireEvent.click(screen.getByText("Good"));
    fireEvent.click(screen.getByText("Review transfer"));
    fireEvent.click(await screen.findByText("Confirm reviewed transfer"));
    await screen.findByText(
      "Canonical transfer record saved. Read current custody before another action.",
    );
    await waitFor(() =>
      expect(screen.queryByText("Check original transfer")).toBeNull(),
    );
    expect(m.api.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });
  it("clears recipient and review controls immediately on account context invalidation", async () => {
    m.api.mockResolvedValue(choices);
    render(<InventoryTransfer {...props} />);
    fireEvent.click(screen.getByText("Transfer custody"));
    await screen.findByText("Fictional recipient");
    act(() => {
      m.generation++;
      m.listeners.forEach((f) => f());
    });
    expect(screen.queryByText("Fictional recipient")).toBeNull();
    expect(screen.queryByText("Review transfer")).toBeNull();
    expect(
      screen.getByText("Transfer unavailable in the current account."),
    ).toBeTruthy();
  });
  it("retains an unknown original attempt when current canTransfer becomes false", async () => {
    m.api.mockResolvedValueOnce(choices).mockRejectedValue({ status: 403 });
    const view = render(<InventoryTransfer {...props} />);
    fireEvent.click(screen.getByText("Transfer custody"));
    fireEvent.click(await screen.findByText("Fictional recipient"));
    fireEvent.click(screen.getByText("Good"));
    fireEvent.click(screen.getByText("Review transfer"));
    fireEvent.click(await screen.findByText("Confirm reviewed transfer"));
    await screen.findByText("Check original transfer");
    view.rerender(<InventoryTransfer {...props} canTransfer={false} />);
    fireEvent.click(screen.getByText("Check original transfer"));
    await waitFor(() => expect(m.api).toHaveBeenCalledTimes(3));
    expect(m.api.mock.calls[2][0]).toBe(m.api.mock.calls[1][0]);
  });
});
