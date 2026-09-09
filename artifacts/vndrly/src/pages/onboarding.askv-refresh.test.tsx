import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingProgressRow } from "@/lib/onboarding-api";
import type { ComponentType } from "react";

const mocks = vi.hoisted(() => ({
  getMine: vi.fn(),
  getFieldByToken: vi.fn(),
  navigate: vi.fn(),
  realtimeOptions: null as null | { onMutation?: (mutation: { name: string; refresh: string[] }) => void },
  voice: { state: "stopped", error: null, greeting: null, startConversation: vi.fn(), stop: vi.fn(), setMicEnabled: vi.fn(), updateContext: vi.fn(), sendText: vi.fn() },
}));
vi.mock("@/lib/onboarding-api", () => ({ onboardingApi: { getMine: mocks.getMine, getFieldByToken: mocks.getFieldByToken, getWorkTypes: async () => [] } }));
vi.mock("wouter", () => ({ useLocation: () => ["/onboarding/vendor", mocks.navigate], useRoute: () => [true, { token: "synthetic-invite" }] }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { userId: 11, vendorId: 22, role: "vendor" }, setPreferredLanguage: vi.fn() }) }));
vi.mock("@/hooks/use-askv-realtime", () => ({ useAskVRealtime: (options: typeof mocks.realtimeOptions) => { mocks.realtimeOptions = options; return mocks.voice; } }));
vi.mock("@/hooks/use-askv-wake-listener", () => ({ useAskVWakeListener: () => ({ ready: false, supported: false, error: null }) }));

import OnboardingVendor from "./onboarding-vendor";
import OnboardingPartner from "./onboarding-partner";
import OnboardingField from "./onboarding-field";
import { AskVVoiceProvider } from "@/hooks/use-askv-voice-session";
import { useOnboardingProgress } from "@/hooks/use-onboarding-progress";

function row(orgType: "vendor" | "partner", currentStep: string, payload: Record<string, unknown> = {}): OnboardingProgressRow {
  return { id: 1, orgType, vendorId: orgType === "vendor" ? 22 : null, partnerId: orgType === "partner" ? 33 : null, currentStep, completedSteps: [], skippedSteps: [], payload, startedAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z", completedAt: null };
}
function saved(progress: OnboardingProgressRow) { return { progress, user: { email: null, emailVerifiedAt: null } }; }
function notify(refresh = ["onboarding"], name = "complete_onboarding_step") {
  window.dispatchEvent(new CustomEvent("askv:data-changed", { detail: { name, refresh } }));
}
function ProgressLabel() {
  const { progress } = useOnboardingProgress();
  return <output data-testid="saved-progress">{progress?.currentStep}</output>;
}
function renderPage(Page: ComponentType, withVoice = false) {
  const child = <><Page /><ProgressLabel /></>;
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{withVoice ? <AskVVoiceProvider>{child}</AskVVoiceProvider> : child}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.getMine.mockReset();
  mocks.getFieldByToken.mockReset();
  mocks.navigate.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  window.history.replaceState({}, "", "/");
});
afterEach(() => vi.unstubAllGlobals());

describe("AskV onboarding refresh on the active wizard", () => {
  it("refreshes field onboarding while keeping the password step available for user completion", async () => {
    const progress = { ...row("vendor", "personal-info"), orgType: "field_employee" as const, vendorPeopleId: 7 };
    const invite = { vendorPeopleId: 7, vendorId: 22, vendorName: "Synthetic vendor", firstName: "Morgan", lastName: "Saved", email: "morgan@example.invalid", phone: null, photoUrl: null, preferredLanguage: "en", progress };
    mocks.getMine.mockResolvedValue(saved(progress));
    mocks.getFieldByToken.mockResolvedValue(invite);
    renderPage(OnboardingField);
    await screen.findByTestId("step-personal-info-body");
    mocks.getFieldByToken.mockResolvedValue({ ...invite, progress: { ...progress, currentStep: "done" } });
    act(() => notify());
    await screen.findByTestId("step-set-password-body");
    expect(screen.queryByTestId("step-personal-info-body")).toBeNull();
  });

  it("propagates a committed voice step through the provider to both the wizard and progress widget", async () => {
    mocks.getMine.mockResolvedValue(saved(row("vendor", "work-types", { serviceArea: { operatingRadiusMiles: 40 }, workTypeIds: [] })));
    renderPage(OnboardingVendor, true);
    await screen.findByTestId("step-work-types-body");
    mocks.getMine.mockResolvedValue(saved(row("vendor", "first-employee", { firstEmployee: { firstName: "Morgan", lastName: "Saved", email: "morgan@example.invalid" } })));
    act(() => mocks.realtimeOptions?.onMutation?.({ name: "complete_onboarding_step", refresh: ["onboarding"] }));
    await screen.findByTestId("step-first-employee-body");
    expect((screen.getByTestId("input-emp-first") as HTMLInputElement).value).toBe("Morgan");
    await waitFor(() => expect(screen.getByTestId("saved-progress").textContent).toBe("first-employee"));
  });

  it.each([
    { Page: OnboardingVendor, orgType: "vendor" as const, step: "work-types", field: "input-service-radius", payload: { serviceArea: { operatingRadiusMiles: 40 }, workTypeIds: [] }, updated: { serviceArea: { operatingRadiusMiles: 55 }, workTypeIds: [] }, value: "55" },
    { Page: OnboardingPartner, orgType: "partner" as const, step: "first-site", field: "input-site-name", payload: { firstSite: { name: "Saved site" } }, updated: { firstSite: { name: "Voice site" } }, value: "Voice site" },
  ])("preserves $orgType drafts for unrelated events and refreshes saved onboarding fields", async ({ Page, orgType, step, field, payload, updated, value }) => {
    mocks.getMine.mockResolvedValue(saved(row(orgType, step, payload)));
    renderPage(Page);
    const input = await screen.findByTestId(field);
    fireEvent.change(input, { target: { value: field === "input-service-radius" ? "125" : "Unsaved site" } });
    const draft = (input as HTMLInputElement).value;
    mocks.getMine.mockResolvedValue(saved(row(orgType, step, updated)));
    const requestsBefore = mocks.getMine.mock.calls.length;
    await act(async () => { notify(["tickets", "crew-map"]); window.dispatchEvent(new Event("askv:data-changed")); });
    expect((screen.getByTestId(field) as HTMLInputElement).value).toBe(draft);
    expect(mocks.getMine).toHaveBeenCalledTimes(requestsBefore);
    act(() => notify());
    await waitFor(() => expect((screen.getByTestId(field) as HTMLInputElement).value).toBe(value));
  });

  it("uses the saved next step after voice completion even when opened from a step deep link", async () => {
    window.history.replaceState({}, "", "/?step=first-site");
    mocks.getMine.mockResolvedValue(saved(row("partner", "first-site")));
    renderPage(OnboardingPartner);
    await screen.findByTestId("step-first-site-body");
    mocks.getMine.mockResolvedValue(saved(row("partner", "tax-billing")));
    act(() => notify());
    await screen.findByTestId("step-tax-billing-body");
  });

  it("keeps a fully advanced vendor wizard on its final step until separately finalized", async () => {
    mocks.getMine.mockResolvedValue(saved(row("vendor", "first-employee")));
    renderPage(OnboardingVendor);
    await screen.findByTestId("step-first-employee-body");
    mocks.getMine.mockResolvedValue(saved({ ...row("vendor", "done"), completedSteps: ["first-employee"] }));
    act(() => notify());
    await waitFor(() => expect(screen.getByTestId("saved-progress").textContent).toBe("done"));
    expect(screen.getByTestId("step-first-employee-body")).toBeTruthy();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("leaves the finished wizard for the dashboard after a committed finalization", async () => {
    mocks.getMine.mockResolvedValue(saved(row("vendor", "first-employee")));
    renderPage(OnboardingVendor);
    await screen.findByTestId("step-first-employee-body");
    mocks.getMine.mockResolvedValue(saved({ ...row("vendor", "done"), completedAt: "2026-09-07T12:00:00Z" }));
    act(() => notify(["onboarding", "auth", "field-employees"], "finalize_onboarding"));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  });

  it("keeps revisited setup open after its last skipped step is saved until the canonical finalization", async () => {
    window.history.replaceState({}, "", "/?step=branding");
    mocks.getMine.mockResolvedValue(saved({ ...row("vendor", "done"), completedAt: "2026-09-01T00:00:00Z", skippedSteps: ["branding"] }));
    renderPage(OnboardingVendor);
    await screen.findByTestId("step-branding-body");
    mocks.getMine.mockResolvedValue(saved({ ...row("vendor", "tax-ids"), completedAt: "2026-09-01T00:00:00Z", completedSteps: ["branding"], skippedSteps: [] }));
    act(() => notify());
    await screen.findByTestId("step-tax-ids-body");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
