import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InventoryRegistration } from "./InventoryRegistration";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  isAuthScopeCurrent: () => true,
  subscribeUser: () => () => {},
  subscribeToken: () => () => {},
}));
vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({ text: "black", border: "gray" }),
}));
vi.mock("@/components/TogglePillButton", () => ({
  default: ({ children, onPress, disabled }: any) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});
it("retains uncertain alias and checks saved state without resending", async () => {
  mocks.api.mockImplementation(async (_p: string, i: any) => {
    if (i?.method === "POST") throw Error("lost");
    return {
      id: "11111111-1111-4111-8111-111111111111",
      version: 2,
      aliases: [],
    };
  });
  render(
    <InventoryRegistration
      owner={{ type: "vendor", id: 7 }}
      canManage
      assetId="11111111-1111-4111-8111-111111111111"
      version={2}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("inventoryRegistration.addAlias"));
  fireEvent.change(screen.getByLabelText("inventoryRegistration.identifier"), {
    target: { value: "TAG1" },
  });
  fireEvent.click(screen.getByText("inventoryRegistration.review"));
  fireEvent.click(await screen.findByText("inventoryRegistration.confirm"));
  await screen.findByText("inventoryRegistration.unknown");
  fireEvent.click(screen.getByText("inventoryRegistration.check"));
  await screen.findByText("inventoryRegistration.unknown");
  expect(
    mocks.api.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(1);
});
it("hides manager preparation without authority", () => {
  render(
    <InventoryRegistration
      owner={{ type: "vendor", id: 7 }}
      canManage={false}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.queryByText("inventoryRegistration.register")).toBeNull();
});
