import React from "react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetRun } from "@workspace/api-zod";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 }, activeMembershipId: 1 }) }));
vi.mock("@/lib/fleet-offline-native", () => ({ nativeFleetOffline: { read: async () => ({ actions: [] }), cache: async () => {} } }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", border: "gray", destructive: "red" }) }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "10000000-0000-4000-8000-000000000001" }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: ({ title }: any) => <h1>{title}</h1> }));
vi.mock("@/components/MapboxNativeMap", () => ({ default: () => <div /> }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, onPress, disabled }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import FleetWorkspace from "./FleetWorkspace";
import FleetRunAction from "./FleetRunAction";
import FleetSetup from "./FleetSetup";
import { fleetCopy } from "@/lib/fleet-copy";
beforeEach(async () => { await i18next.use(initReactI18next).init({ lng: "es", fallbackLng: "en", resources: {} }); });
afterEach(async () => { cleanup(); mocks.api.mockReset(); await i18next.changeLanguage("en"); });
describe("Fleet existing language choice", () => {
  it("shows driver controls and source limits in Spanish", async () => {
    mocks.api.mockResolvedValue({ companyId: 609, enabled: true, roles: ["driver"], capabilities: { canDrive: true, canDispatch: false, canManage: false, canSetup: false }, runs: [], fleets: [], observations: [], unavailableIntegrations: [], generatedAt: "2026-10-07T12:00:00Z" });
    render(<FleetWorkspace />);
    expect(await screen.findByText("Mi jornada de flota")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actualizar flota" })).toBeTruthy();
    expect(screen.getByText(/No hay ubicación de flota procedente/)).toBeTruthy();
  });
  it("localizes inspection fields without changing the supplied values", () => {
    render(<FleetRunAction run={{ version: 1, stops: [], loads: [], currentStopId: null } as unknown as FleetRun} action="inspect" disabled={false} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("registrar inspección Notas")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reportar defecto" })).toBeTruthy();
  });
  it("localizes company setup while preserving names that happen to match English UI copy", async () => {
    mocks.api.mockResolvedValue({ expectedVersion: 1, enabled: true, fleets: [], grants: [], sites: [{ siteId: 392, name: "Fleet Map" }], members: [{ userId: 1, name: "Driver" }] });
    render(<FleetSetup onSaved={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Fleet Map" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Driver" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar la configuración de flota" })).toBeTruthy();
  });
  it("keeps English fallback and translates only supplied copy keys", () => {
    expect(fleetCopy("Refresh Fleet", "en")).toBe("Refresh Fleet");
    expect(fleetCopy("Refresh Fleet", "es-MX")).toBe("Actualizar flota");
    expect(fleetCopy("Manifest-REF-2", "es")).toBe("Manifest-REF-2");
  });
});
