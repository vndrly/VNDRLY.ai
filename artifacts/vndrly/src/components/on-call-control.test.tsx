import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import OnCallControl from "./on-call-control";
const state = vi.hoisted(() => ({ request: vi.fn(), active: false }));
vi.mock("@/hooks/use-brand", () => ({ useBrand: () => ({ name: "MidCon", primary: "#00a6b2" }) }));
vi.mock("@/lib/native-operations-client", () => ({ nativeOperationsRequest: state.request }));
beforeEach(() => {
  state.active = false; state.request.mockReset();
  state.request.mockImplementation(async (path, init) => {
    if (path === "/on-call") state.active = JSON.parse(init.body).active;
    return { onCallActive: state.active, policy: { enabled: true }, canWorkerOperate: true };
  });
});
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OnCallControl identity="worker:1:company:4" /></QueryClientProvider>);
it("toggles the actual on-call declaration independently from the shift clock", async () => {
  mount(); const off = screen.getByRole("switch", { name: "On Call" });
  await waitFor(() => expect(off.hasAttribute("disabled")).toBe(false));
  fireEvent.click(off);
  await waitFor(() => expect(screen.getByRole("switch", { name: "On Call" }).getAttribute("aria-checked")).toBe("true"));
  expect(state.request).toHaveBeenCalledWith("/on-call", expect.objectContaining({ method: "PUT", body: JSON.stringify({ active: true, consent: true }) }));
  expect(state.request.mock.calls.some(([path]) => path.includes("workday") || path.includes("duty"))).toBe(false);
});
it("keeps unavailable on-call data disabled instead of guessing a state", async () => {
  state.request.mockRejectedValue(new Error("offline")); mount();
  expect(await screen.findByText("On-call unavailable")).toBeTruthy();
  const control = screen.getByRole("switch", { name: "On Call" });
  expect(control.hasAttribute("disabled")).toBe(true); fireEvent.click(control);
  expect(state.request.mock.calls.some(([path]) => path === "/on-call")).toBe(false);
});
