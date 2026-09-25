import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleExports } from "./RoleExports";

const network = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: network.api, getApiBase: () => "https://example.test" }));
vi.mock("@/lib/auth", () => ({ getToken: vi.fn() }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "white", text: "black", mutedForeground: "gray", border: "gray", primary: "blue" }) }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, accessibilityLabel }: any) => <button aria-label={accessibilityLabel}>{children}</button> }));
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", writeAsStringAsync: vi.fn() }));
vi.mock("expo-sharing", () => ({ shareAsync: vi.fn() }));

const owner = { type: "vendor" as const, id: 41 };
afterEach(() => { cleanup(); network.api.mockReset(); });

describe("role-aware Work Hub exports", () => {
  it("hides the entire export card when the current owner grants no datasets", async () => {
    network.api.mockResolvedValue({ capabilities: { canViewExports: false, allowedExportDatasets: [] } });
    render(<RoleExports owner={owner} membershipId={1} />);
    expect(await screen.findByText("No exports available for this role.")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("shows only staffing to a gate supervisor", async () => {
    network.api.mockResolvedValue({ capabilities: { canViewExports: true, allowedExportDatasets: ["staffing"] } });
    render(<RoleExports owner={owner} membershipId={1} />);
    expect(await screen.findByRole("radio", { name: "Staffing" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  it("shows all five admin datasets granted by the server", async () => {
    network.api.mockResolvedValue({ capabilities: { canViewExports: true, allowedExportDatasets: ["payroll-hours", "quickbooks-time", "inventory-custody", "staffing", "safety-response"] } });
    render(<RoleExports owner={owner} membershipId={1} />);
    expect(await screen.findByRole("radio", { name: "Staffing" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });
});
