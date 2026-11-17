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
    if ((path === "/on-call?response=preference" || path === "/pickup-shifts") && init?.method === "PUT") state.active = JSON.parse(init.body).active;
    return { active: state.active, onCallActive: state.active, policy: { enabled: true }, canWorkerOperate: true };
  });
});
const mount = (pickup = false) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OnCallControl identity="worker:1:company:4" pickup={pickup} /></QueryClientProvider>);
it("saves pickup willingness separately without declaring on-call or starting duty", async () => {
  const { container } = mount(true); const control = screen.getByRole("switch", {name:"Pickup Shifts"});
  expect(container.textContent).toBe("Pickup Shifts");
  expect(screen.getAllByRole("switch")).toHaveLength(1);
  await waitFor(() => expect(control.hasAttribute("disabled")).toBe(false));
  fireEvent.click(control);
  await waitFor(() => expect(control.getAttribute("aria-checked")).toBe("true"));
  expect(container.textContent).toBe("Pickup Shifts");
  expect(state.request).toHaveBeenCalledWith("/pickup-shifts", expect.objectContaining({method:"PUT",body:JSON.stringify({active:true,consent:true})}));
  expect(state.request.mock.calls.some(([path, init])=>(path==="/on-call?response=preference" && init?.method === "PUT") || path.includes("duty"))).toBe(false);
});
it("toggles the actual on-call declaration independently from the shift clock", async () => {
  mount(); const off = screen.getByRole("switch", { name: "On Call" });
  await waitFor(() => expect(off.hasAttribute("disabled")).toBe(false));
  fireEvent.click(off);
  await waitFor(() => expect(screen.getByRole("switch", { name: "On Call" }).getAttribute("aria-checked")).toBe("true"));
  expect(state.request).toHaveBeenCalledWith("/on-call?response=preference", expect.objectContaining({ method: "PUT", body: JSON.stringify({ active: true, consent: true }) }));
  expect(state.request.mock.calls.some(([path]) => path.includes("workday") || path.includes("duty"))).toBe(false);
});
it("keeps unavailable on-call data disabled instead of guessing a state", async () => {
  state.request.mockRejectedValue(new Error("offline")); const { container } = mount();
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(3), { timeout: 3000 });
  expect(container.textContent).toBe("On Call");
  const control = screen.getByRole("switch", { name: "On Call" });
  expect(control.hasAttribute("disabled")).toBe(true); fireEvent.click(control);
  expect(state.request.mock.calls.some(([path, init]) => path === "/on-call?response=preference" && init?.method === "PUT")).toBe(false);
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
it("keeps only the fixed On Call label and does not require location-operation permission", async () => {
  let resolve!: (value: unknown) => void;
  state.request.mockReturnValue(new Promise(r => { resolve = r; }));
  const { container } = mount();
  expect(container.textContent).toBe("On Call");
  expect(screen.queryByText("Not on Call")).toBeNull();
  resolve({ canWorkerOperate: false, policy: { enabled: true } });
  await waitFor(() => expect(screen.getByRole("switch", { name: "On Call" }).hasAttribute("disabled")).toBe(false));
  expect(container.textContent).toBe("On Call");
});
