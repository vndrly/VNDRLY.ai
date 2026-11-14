import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { isGateReleasePath } from "@/lib/gate-release";
const mock = vi.hoisted(() => ({ role: "gatekeeper", push: vi.fn() }));
vi.mock("expo-router", () => ({ router: { push: mock.push } }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: "field_employee", vendorRole: mock.role } }),
}));
vi.mock("@/components/gate/GateChrome", () => ({
  useGateCopy: () => (en: string) => en,
  GatePage: ({ title, children }: any) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
  GateCard: ({ title, children }: any) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  GateRow: ({ label, onPress }: any) => (
    <button onClick={onPress}>{label}</button>
  ),
}));
vi.mock("@/components/work-hub/NativeJournal", () => ({ default: () => null }));
vi.mock("@/components/GateStaffingAlerts", () => ({
  default: () => <div>Staffing alerts</div>,
}));
import WorkHub from "../(tabs)/work-hub";
afterEach(() => {
  cleanup();
  mock.role = "gatekeeper";
  mock.push.mockReset();
});
it("offers only actionable Gate work and communication destinations", () => {
  render(<WorkHub />);
  for (const button of screen.getAllByRole("button")) fireEvent.click(button);
  expect(mock.push.mock.calls.length).toBeGreaterThan(8);
  expect(mock.push.mock.calls.every(([path]) => isGateReleasePath(path))).toBe(
    true,
  );
  for (const excluded of ["Training", "Fleet", "Inventory", "Tickets"])
    expect(screen.queryByText(excluded)).toBeNull();
  expect(screen.queryByText("Staffing alerts")).toBeNull();
});
it("exposes staffing alerts for a Gate supervisor", () => {
  mock.role = "gate_supervisor";
  render(<WorkHub />);
  expect(screen.getByText("Staffing alerts")).toBeTruthy();
});
