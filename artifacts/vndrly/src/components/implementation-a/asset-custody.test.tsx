import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { InventoryCustody } from "./asset-custody";
vi.mock("@/components/png-pill-rollover", () => ({
  PngPillButton: ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const id = "11111111-1111-4111-8111-111111111111";
const asset = {
  id,
  name: "Radio",
  version: 2,
  holderUserId: null,
  capabilities: { canCheckOut: true, canReturn: false, canVerifyIssued: false },
  policy: {
    photosRequiredOnCheckout: false,
    photosRequiredOnReturn: false,
    expectedReturnRequired: false,
  },
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("hides commands without current capability", () => {
  render(
    <InventoryCustody
      asset={{
        ...asset,
        capabilities: { ...asset.capabilities, canCheckOut: false },
      }}
      userId={17}
      identity="a"
      onSaved={vi.fn()}
    />,
  );
  expect(screen.queryByText("inventoryCustody.checkout")).toBeNull();
});
it("locks exact review on uncertain send and reads history before every retry", async () => {
  vi.stubGlobal("crypto", {
    randomUUID: () => "22222222-2222-4222-8222-222222222222",
    subtle: { digest: async () => new Uint8Array(32).fill(170).buffer },
  });
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "POST") throw Error("lost");
    return { ok: true, json: async () => ({ ...asset, history: [] }) };
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <InventoryCustody
      asset={asset}
      userId={17}
      identity="a"
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("inventoryCustody.checkout"));
  fireEvent.click(screen.getByText("inventoryCustody.review"));
  fireEvent.click(await screen.findByText("inventoryCustody.confirm"));
  await screen.findByText("inventoryCustody.unknown");
  expect(
    (screen.getByLabelText("inventoryCustody.condition") as HTMLSelectElement)
      .disabled,
  ).toBe(true);
  const original = fetcher.mock.calls.find((c) => c[1]?.method === "POST")![1]!
    .body;
  fireEvent.click(screen.getByText("inventoryCustody.retry"));
  await screen.findByText("inventoryCustody.unknown");
  expect(
    fetcher.mock.calls
      .filter((c) => c[1]?.method === "POST")
      .every((c) => c[1]!.body === original),
  ).toBe(true);
});
