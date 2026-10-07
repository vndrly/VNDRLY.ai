import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InventoryRegistration } from "./asset-registration";
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("never resends an uncertain alias command; recovery only reads", async () => {
  const fetcher = vi.fn(async (_p: string, init?: RequestInit) => {
    if (init?.method === "POST") throw Error("lost");
    return {
      ok: true,
      json: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        version: 2,
        aliases: [],
      }),
    };
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <InventoryRegistration
      owner={{ type: "vendor", id: 7 }}
      identity="a"
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
    fetcher.mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(1);
});
it("hides manager actions when current authority is absent", () => {
  render(
    <InventoryRegistration
      owner={{ type: "vendor", id: 7 }}
      identity="a"
      canManage={false}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.queryByText("inventoryRegistration.register")).toBeNull();
});
