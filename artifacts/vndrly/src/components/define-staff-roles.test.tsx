import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DefineStaffRoles from "./define-staff-roles";
const state = vi.hoisted(() => ({ data: { version: 0, entries: [], canEdit: true } as any, setQueryData: vi.fn(), refetch: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: state.data, refetch: state.refetch }), useQueryClient: () => ({ setQueryData: state.setQueryData }) }));
vi.mock("./ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? children : null }));
vi.mock("./vendor-edit-flyout", () => ({ VendorEditFlyout: ({ children, title, onClose }: any) => <section aria-label={title}><button onClick={onClose}>Close</button>{children}</section> }));
beforeEach(() => { cleanup(); vi.clearAllMocks(); state.data = { version: 0, entries: [], canEdit: true }; });
it("adds a reusable staff position without including platform roles or employee changes", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ version: 1, canEdit: true, entries: [] }) })); vi.stubGlobal("fetch", fetch);
  render(<DefineStaffRoles vendorId={7} operations={["gate"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Add/Edit Roles" }));
  fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "Travel Coordinator" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Role" }));
  await waitFor(() => expect(state.setQueryData).toHaveBeenCalled());
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/vendors/7/staff-roles");
  const body = JSON.parse(init.body as string);
  expect(body.entries.some((role: any) => role.label === "Travel Coordinator")).toBe(true);
  expect(body.entries.some((role: any) => role.label === "Gatekeeper")).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("prefills an existing role and retains the form on a concurrent edit conflict", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "Roles changed in another window" }) })));
  render(<DefineStaffRoles vendorId={7} operations={["gate"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Add/Edit Roles" }));
  fireEvent.change(screen.getByLabelText("Staff position"), { target: { value: "common:Payroll" } });
  expect((screen.getByLabelText("Role name") as HTMLInputElement).value).toBe("Payroll");
  fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "Payroll Coordinator" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Role" }));
  expect((await screen.findByRole("alert")).textContent).toContain("another window");
  expect(state.refetch).toHaveBeenCalled(); expect(state.setQueryData).not.toHaveBeenCalled();
});
it("hides editing from a read-only employee", () => {
  state.data.canEdit = false;
  render(<DefineStaffRoles vendorId={7} operations={["gate"]} />);
  expect(screen.queryByRole("button", { name: "Add/Edit Roles" })).toBeNull();
  expect((screen.getByRole("button", { name: "Payroll" }) as HTMLButtonElement).disabled).toBe(true);
});
