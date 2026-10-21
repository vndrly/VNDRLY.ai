import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FleetDrivers from "./FleetDrivers";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.fetch }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, vendorId: 7 }, activeMembership: { orgId: 7 } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "#222", text: "white", mutedForeground: "#aaa", border: "#555", primary: "#078", destructive: "#f33" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button> }));
vi.mock("@/components/EmployeeCertificationsPanel", () => ({ default: ({ employeeId }: { employeeId: number }) => <div>Credentials for {employeeId}</div> }));

afterEach(() => { cleanup(); mocks.fetch.mockReset(); });
describe("Fleet Drivers", () => {
  it("shows availability and CDL state and opens exact driver history", async () => {
    mocks.fetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/field-employees?")) return [{ id: 11, vendorId: 7, firstName: "Dana", lastName: "Driver", email: "dana@example.com", phone: null, jobTitle: "Driver", userId: 22, isActive: true }];
      if (path === "/api/fleet/home?module=summary") return { data: { previews: { drivers: [{ userId: 22, status: "available" }] } } };
      if (path === "/api/fleet/overview") return { runs: [{ id: "run-1", driverUserId: 22, linkedTicketId: 91, title: "Gate move", status: "completed" }] };
      if (path.endsWith("/certifications")) return [{ id: 1, name: "CDL Class A", expirationDate: "2099-01-01" }];
      throw Error(`Unexpected ${path}`);
    });
    render(<FleetDrivers />);
    const driver = await screen.findByRole("button", { name: "Open Dana Driver" });
    expect(driver.textContent).toContain("Available");
    expect(driver.textContent).toContain("CDL current through 2099-01-01");
    fireEvent.click(driver);
    expect(await screen.findByText("Credentials for 11")).toBeTruthy();
    expect(screen.getByText(/Ticket #91/)).toBeTruthy();
  });

  it("creates a new driver employee from the top action", async () => {
    mocks.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/api/field-employees?") || path === "/api/fleet/overview") return path.includes("field-employees") ? [] : { runs: [] };
      if (path === "/api/fleet/home?module=summary") return { data: { previews: { drivers: [] } } };
      if (path === "/api/field-employees" && init?.method === "POST") return { id: 12 };
      throw Error(`Unexpected ${path}`);
    });
    render(<FleetDrivers />);
    fireEvent.click(await screen.findByRole("button", { name: "Add New Driver" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Driver" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save New Driver" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("/api/field-employees", expect.objectContaining({ method: "POST" })));
  });
});
