import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProfileScreen from "../(tabs)/profile";
import CompanyOperationsChoice from "@/components/CompanyOperationsChoice";

const mocks = vi.hoisted(() => ({ push: vi.fn(), partnerOnly: false }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => <span /> }));
vi.mock("react-i18next", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-i18next")>()), useTranslation: () => ({ t: (key: string) => key === "fleet.agreementEditor" ? "Fleet agreements" : key, i18n: { language: "en" } }) }));
vi.mock("expo-router", () => ({ router: { push: mocks.push, replace: vi.fn(), canGoBack: () => false }, useFocusEffect: () => {}, useLocalSearchParams: () => ({}) }));
vi.mock("expo-location", () => ({ requestForegroundPermissionsAsync: vi.fn(), requestBackgroundPermissionsAsync: vi.fn() }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 7, role: "admin", partnerId: 3, vendorId: mocks.partnerOnly ? null : 3, username: "test", displayName: "Test Admin" }, availableMemberships: [{ id: 9, role: "admin", orgId: 3, orgName: "Test Company" }], activeMembershipId: 9, switchContext: vi.fn() }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ text: "black", foreground: "black", mutedForeground: "gray", border: "gray", card: "white", primary: "green" }) }));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({}), logout: vi.fn(), updatePreferredLanguage: vi.fn() }));
vi.mock("@/lib/locationConsent", () => ({ hasActiveConsentForThisDevice: vi.fn().mockResolvedValue(false), acceptConsent: vi.fn(), revokeConsent: vi.fn(), setConsentDeclined: vi.fn() }));
vi.mock("@/lib/liveLocationReporter", () => ({ startLiveLocationReporter: vi.fn(), stopLiveLocationReporter: vi.fn() }));
vi.mock("@/lib/photos", () => ({ captureAndUploadImage: vi.fn(), pickAndUploadImage: vi.fn() }));
vi.mock("@/components/work-hub/NativeOperations", () => ({ default: () => null }));
vi.mock("@/components/WorkHubDeviceSettings", () => ({ default: () => null }));
vi.mock("@/components/profile/GateLocationsCard", () => ({ default: () => null }));
vi.mock("@/components/SafetyTrainingBanner", () => ({ default: () => null }));
vi.mock("@/components/AskVVoiceIndicator", () => ({ default: () => null }));
vi.mock("@/components/BrandTitleRow", () => ({ default: () => null }));
vi.mock("@/components/ProfilePhotoImage", () => ({ default: () => null }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/SphereBackButton", () => ({ default: () => null }));
vi.mock("@/components/LayeredPillButton", () => ({ default: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button> }));
afterEach(() => { cleanup(); mocks.push.mockReset(); mocks.partnerOnly = false; });

it("keeps Profile for account actions without duplicating Fleet operations", () => {
  render(<ProfileScreen />);
  expect(screen.getByText("Test Admin")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Company operations/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Fleet agreement/i })).toBeNull();
});

it("keeps Partner Fleet agreements reachable from Company operations", () => {
  mocks.partnerOnly = true;
  render(<CompanyOperationsChoice />);
  expect(screen.getByRole("button", { name: /Fleet agreements/i })).toBeTruthy();
});
