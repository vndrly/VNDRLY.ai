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
    if ((path === "/on-call" || path === "/pickup-shifts") && init?.method === "PUT") state.active = JSON.parse(init.body).active;
    return { active: state.active, onCallActive: state.active, policy: { enabled: true }, canWorkerOperate: true };
  });
});
const mount = (pickup = false) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OnCallControl identity="worker:1:company:4" pickup={pickup} /></QueryClientProvider>);
it("saves pickup willingness separately without declaring on-call or starting duty", async () => {
  mount(true); const control = screen.getByRole("switch", {name:"Pickup Extra Shifts"});
  await waitFor(() => expect(control.hasAttribute("disabled")).toBe(false));
  fireEvent.click(control);
  await waitFor(() => expect(control.getAttribute("aria-checked")).toBe("true"));
  expect(state.request).toHaveBeenCalledWith("/pickup-shifts", expect.objectContaining({method:"PUT",body:JSON.stringify({active:true,consent:true})}));
  expect(state.request.mock.calls.some(([path, init])=>(path==="/on-call" && init?.method === "PUT") || path.includes("duty"))).toBe(false);
});
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
  expect(await screen.findByText("On-call unavailable", {}, { timeout: 3000 })).toBeTruthy();
  const control = screen.getByRole("switch", { name: "On Call" });
  expect(control.hasAttribute("disabled")).toBe(true); fireEvent.click(control);
  expect(state.request.mock.calls.some(([path, init]) => path === "/on-call" && init?.method === "PUT")).toBe(false);
});
it("allows personal availability when native location operations are disabled", async () => {
  state.request.mockImplementation(async (_path, init) => {
    if (init?.method === "PUT") state.active = JSON.parse(init.body).active;
    return { onCallActive: state.active, policy: { enabled: false }, canWorkerOperate: true };
  });
  mount(); const control = screen.getByRole("switch", { name: "On Call" });
  await waitFor(() => expect(control.hasAttribute("disabled")).toBe(false));
  fireEvent.click(control);
  await waitFor(() => expect(control.getAttribute("aria-checked")).toBe("true"));
});
it("shows loading instead of falsely declaring off-call and preserves account restrictions", async () => {
  let resolve!: (value: unknown) => void;
  state.request.mockReturnValue(new Promise(r => { resolve = r; }));
  mount();
  expect(screen.getByText("Loading status…")).toBeTruthy();
  expect(screen.queryByText("Not on Call")).toBeNull();
  resolve({ canWorkerOperate: false, policy: { enabled: true } });
  expect(await screen.findByText("On Call requires a vendor staff account.")).toBeTruthy();
  expect(screen.getByRole("switch", { name: "On Call" }).hasAttribute("disabled")).toBe(true);
});
