import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FleetOverview, FleetRun } from "@workspace/api-zod";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("./mapbox-map", () => ({ MapboxMap: ({ points, styleKind }: { points: { id: string }[]; styleKind: string }) => <div data-testid="map">{styleKind}:{points.map(point => point.id).join(",")}</div> }));
vi.mock("./png-pill-rollover", () => ({ PngPillButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
import { FleetOperationsMap } from "./fleet-operations-map";
describe("Fleet map workspace", () => {
  it("hides stale positions until requested and selects their authorized run without changing it", () => {
    const select = vi.fn();
    const runs = [{ id: "old", title: "Water delivery", labels: { driverName: "Driver one", vehicleName: "Truck one" } }] as FleetRun[];
    const positions = [{ runId: "old", latitude: 35, longitude: -97, freshness: "stale", recordedAt: "2026-10-15T10:00:00Z" }] as FleetOverview["observations"];
    render(<FleetOperationsMap runs={runs} positions={positions} selected="" onSelect={select} />);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText("No recent positions in this view")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("map").textContent).toBe("street:old");
    fireEvent.click(screen.getByRole("button", { name: /Truck one/ }));
    expect(select).toHaveBeenCalledWith("old");
    fireEvent.click(screen.getByRole("button", { name: "Satellite" }));
    expect(screen.getByTestId("map").textContent).toBe("satellite:old");
    fireEvent.click(screen.getByRole("button", { name: "Expand map" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Expand map" })).toBeTruthy();
  });
});
