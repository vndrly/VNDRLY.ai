import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "partner", fetch: vi.fn(), alert: vi.fn() }));
const translate = (key: string) => key;
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ siteId: "42" }), Stack: { Screen: () => null } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "black", mutedForeground: "gray", border: "gray", card: "white" }) }));
vi.mock("@/lib/api", () => ({ apiFetch: state.fetch }));
vi.mock("@/components/InPageHeader", () => ({ default: () => null }));
vi.mock("react-native", () => ({
  Alert: { alert: state.alert }, ActivityIndicator: () => null, RefreshControl: () => null,
  ScrollView: ({ children }: any) => <div>{children}</div>, View: ({ children }: any) => <div>{children}</div>, Text: ({ children }: any) => <span>{children}</span>,
  Switch: ({ value, disabled, onValueChange, accessibilityLabel }: any) => <input type="checkbox" aria-label={accessibilityLabel} checked={value} disabled={disabled} onChange={e => onValueChange(e.target.checked)} />,
}));
import Screen from "../site-gate-contractors";
const assignment = { id: 7, vendorName: "Synthetic", workTypeName: "Gate", isGateContractor: false };
beforeEach(() => { state.role = "partner"; state.fetch.mockReset(); state.alert.mockReset(); state.fetch.mockResolvedValue([assignment]); });
afterEach(cleanup);
it("does not read or expose designation controls to a vendor", () => {
  state.role = "vendor"; render(<Screen />);
  expect(state.fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("saves the selected assignment and uses the server's returned designation", async () => {
  state.fetch.mockResolvedValueOnce([assignment]).mockResolvedValueOnce({ ...assignment, isGateContractor: true });
  render(<Screen />);
  const control = await screen.findByRole("checkbox"); fireEvent.click(control);
  await waitFor(() => expect(state.fetch).toHaveBeenCalledWith("/api/site-locations/42/assignments/7", { method: "PATCH", body: JSON.stringify({ isGateContractor: true }) }));
  await waitFor(() => expect((control as HTMLInputElement).checked).toBe(true));
});
it("keeps the saved designation after a denied or failed change", async () => {
  state.fetch.mockResolvedValueOnce([assignment]).mockRejectedValueOnce(new Error("Forbidden"));
  render(<Screen />); const control = await screen.findByRole("checkbox"); fireEvent.click(control);
  await waitFor(() => expect(state.alert).toHaveBeenCalledWith("common.error", "Forbidden"));
  expect((control as HTMLInputElement).checked).toBe(false);
});
