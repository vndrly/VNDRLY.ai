import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const env = vi.hoisted(() => ({ api: vi.fn(), user: { id: 1 } }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "black", mutedForeground: "gray", background: "white", card: "white", border: "gray", destructive: "red" }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, disabled, onPress }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "operation-1" }));
import GateDutyCard from "./GateDutyCard";

const mount = (shift = "shift-1") => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateDutyCard stationId="station-1" workHubShiftId={shift} /></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); env.api.mockImplementation(async (path: string) => path.endsWith("/roster") ? { roster: [] } : { ok: true }); });

it("supports assume shift and paid-travel start without replacing another worker", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "gateDuty.assume" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith(expect.stringMatching(/duty\/assume$/), expect.objectContaining({ method: "POST" })));
  await waitFor(() => expect(screen.getByRole("button", { name: "gateDuty.startPaidTravel" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "gateDuty.startPaidTravel" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith(expect.stringMatching(/work-sessions\/start$/), expect.anything()));
});

it("combines the uncovered warning with Start my shift and Assume shift actions", async () => {
  const startShift = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GateDutyCard stationId="station-1" onStartShift={startShift} /></QueryClientProvider>);
  expect((await screen.findByRole("alert")).textContent).toContain("gateDuty.unstaffed");
  fireEvent.click(screen.getByRole("button", { name: "changeOver.start" }));
  expect(startShift).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "gateDuty.assume" })).toBeTruthy();
});

it("shows the concurrent roster and signs off only the current worker", async () => {
  env.api.mockImplementation(async (path: string) => path.endsWith("/roster") ? { roster: [
    { id: "duty-1", userId: 1, userName: "Chad", startedAt: "2026-09-22T12:00:00Z" },
    { id: "duty-2", userId: 2, userName: "Bob", startedAt: "2026-09-22T12:10:00Z" },
  ] } : { ok: true });
  mount();
  expect(await screen.findByText(/Chad/)).toBeTruthy(); expect(screen.getByText(/Bob/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("gateDuty.signOffReason"), { target: { value: "Appointment" } });
  fireEvent.click(screen.getByRole("button", { name: "gateDuty.signOff" }));
  await waitFor(() => expect(env.api).toHaveBeenCalledWith(expect.stringMatching(/duty\/duty-1\/end$/), expect.objectContaining({ body: expect.stringContaining('"handoffCompleted":true') })));
});
