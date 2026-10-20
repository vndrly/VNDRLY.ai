import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 }, activeMembershipId: 2 }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "cyan", card: "black", text: "white", border: "gray", mutedForeground: "silver", destructive: "red" }) }));
vi.mock("@/lib/fleet-copy", () => ({ useFleetCopy: () => (value: string) => value }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (input: unknown) => mocks.query(input) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress }: any) => <button onClick={onPress}>{children}</button> }));
import FleetComplianceHelper from "./FleetComplianceHelper";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("presents a low score as advisory guidance with categories, fixes, history and Partner preview", () => {
  mocks.query.mockReturnValue({ data: { companyId: 7, score: 58, status: "red", advisoryOnly: true, evaluatedAt: "2026-10-20T12:00:00Z", categories: [{ category: "vehicle", score: 60 }, { category: "driver_license", score: 55 }], deductions: [{ id: "10000000-0000-4000-8000-000000000001", category: "driver_license", points: 12, reason: "License expired", urgency: "now", estimatedImprovement: 12, remediation: "Upload the renewed license.", evidenceDestination: "/fleet/compliance", responsibleCapability: "office", dueAt: "2026-10-19T12:00:00Z" }], history: [{ at: "2026-09-20T12:00:00Z", score: 46 }], estimatedResolvedScore: 70 }, isLoading: false, isError: false });
  render(<FleetComplianceHelper />);
  expect(screen.getByLabelText("VNDRLY compliance score 58 out of 100")).toBeTruthy();
  expect(screen.getByText(/low score never blocks VNDRLY work or tickets/)).toBeTruthy();
  expect(screen.getByText("License expired")).toBeTruthy();
  expect(screen.getByText("Estimated score gain +12")).toBeTruthy();
  expect(screen.getByText("Score history")).toBeTruthy();
  expect(screen.getByText("What Partners see")).toBeTruthy();
});

it("distinguishes a service outage from a low score and retries only the outage", () => {
  mocks.query.mockReturnValue({ isLoading: false, isError: true, refetch: mocks.refetch });
  render(<FleetComplianceHelper />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByText(/technical outage/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry compliance score" }));
  expect(mocks.refetch).toHaveBeenCalled();
});
