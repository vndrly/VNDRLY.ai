import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 7, vendorId: 1, activeMembershipId: 9 } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/work-hub", vi.fn()] }));
vi.mock("@/lib/work-hub-client", async original => ({ ...await original<any>(), workHubRequest: mocks.request }));
vi.mock("@/components/brand-pill-button", () => ({ default: () => null }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null }));
import LibraryEntryNotice from "./entry-notice";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
it("reconciles once on entry, then polls read-only status", async () => {
  vi.useFakeTimers();
  mocks.request.mockResolvedValue({ present: [] });
  await act(async () => { render(<LibraryEntryNotice enabled />); });
  expect(mocks.request).toHaveBeenCalledWith("/library/entry", expect.objectContaining({ method: "POST", body: "{}" }));
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(mocks.request).toHaveBeenLastCalledWith("/library/entry", expect.objectContaining({ method: "GET" }));
  expect(mocks.request.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  expect(mocks.request.mock.calls[1][1]).not.toHaveProperty("body");
});
it("retries reconciliation when the initial attempt fails", async () => {
  vi.useFakeTimers();
  mocks.request.mockRejectedValueOnce(Error("unavailable")).mockResolvedValue({ present: [] });
  await act(async () => { render(<LibraryEntryNotice enabled />); });
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(mocks.request).toHaveBeenLastCalledWith("/library/entry", expect.objectContaining({ method: "POST" }));
});
