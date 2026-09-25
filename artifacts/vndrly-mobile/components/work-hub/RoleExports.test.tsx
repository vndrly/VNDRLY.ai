import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";
import es from "@/lib/locales/es.json";
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
beforeEach(async () => { await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, es: { translation: es } } }); });

describe("role-aware Work Hub exports", () => {
  it("localizes the no-export state in Spanish", async () => {
    await i18next.changeLanguage("es");
    network.api.mockResolvedValue({ capabilities: { canViewExports: false, allowedExportDatasets: [] } });
    render(<RoleExports owner={owner} membershipId={1} />);
    expect(await screen.findByText("No hay exportaciones disponibles para este rol.")).toBeTruthy();
  });
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
