import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ api: vi.fn().mockResolvedValue({}), params: { title: "Loose cable", description: "Near the gate", eventType: "unsafe_condition", siteLocationId: "4", ticketId: "12", askvDraftId: "draft-1" } }));
vi.mock("expo-router", () => ({ router: { push: vi.fn(), back: vi.fn(), replace: vi.fn() }, useLocalSearchParams: () => env.params }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api, getApiBase: () => "https://example.test" }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/InPageHeader", () => ({ default: () => null }));
vi.mock("@/components/LayeredPillButton", () => ({ default: ({ onPress, children }: any) => <button onClick={onPress}>{children}</button> }));
import SafetyReportScreen from "../safety-report";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("AskV safety report draft", () => {
  it("fills the real form and only submits after the user's explicit action", async () => {
    render(<SafetyReportScreen />);
    expect((screen.getByTestId("safety-title") as HTMLInputElement).value).toBe("Loose cable");
    expect((screen.getByTestId("safety-description") as HTMLInputElement).value).toBe("Near the gate");
    expect(env.api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "safety.submit" }));
    await waitFor(() => expect(env.api).toHaveBeenCalledOnce());
    expect(JSON.parse(env.api.mock.calls[0][1].body)).toMatchObject({ title: "Loose cable", eventType: "unsafe_condition", siteLocationId: 4, ticketId: 12 });
  });
});
