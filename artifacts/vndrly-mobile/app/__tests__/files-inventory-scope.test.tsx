import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/lib/locales/en.json";
import WorkHubModuleScreen from "../work-hub/[module]";

const env = vi.hoisted(() => ({ user: { id: 1, vendorId: 7, role: "vendor", activeMembershipId: 1 }, generation: 1, api: vi.fn() }));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null }, router: { push: vi.fn() }, useLocalSearchParams: () => ({ module: "files-notes" }) }));
vi.mock("react-native", async (original) => ({ ...await original<any>(), ScrollView: ({ children, refreshControl }: any) => <div>{refreshControl}{children}</div>, RefreshControl: ({ onRefresh }: any) => <button onClick={onRefresh}>Refresh</button> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ primary: "blue", card: "white", text: "black", border: "gray" }) }));
vi.mock("@/lib/api", () => ({ apiFetch: env.api, getApiBase: () => "https://example.test" }));
vi.mock("@/lib/auth", () => ({ captureAuthScope: () => ({ generation: env.generation }), isAuthScopeCurrent: (scope: any) => scope.generation === env.generation, subscribeUser: () => () => {}, subscribeToken: () => () => {} }));
vi.mock("@/lib/work-hub-queue-runtime", () => ({ flushNativeWorkHubQueue: async () => {}, isOfflineWorkHubFailure: () => false }));
vi.mock("@/components/MeetingCompanionProvider", () => ({ useMeetingCompanion: () => null }));
vi.mock("@/components/ScreenSafeArea", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/WorkHubPageTitle", () => ({ default: () => null }));
vi.mock("@/components/WorkHubCalls", () => ({ default: () => null }));
vi.mock("@/components/WorkHubConversation", () => ({ default: () => null }));
vi.mock("@/components/WorkHubShiftCalendar", () => ({ default: () => null }));
vi.mock("@/components/implementation-a/ManagedCrews", () => ({ ManagedCrews: () => null }));
vi.mock("@/components/implementation-a/WorkforceCoverage", () => ({ WorkforceCoverage: () => null }));
vi.mock("@/components/implementation-a/SitePresence", () => ({ SitePresence: () => null }));
vi.mock("@/components/implementation-a/SafetyResponse", () => ({ SafetyResponse: () => null }));
vi.mock("@/components/implementation-a/OperationsHealth", () => ({ OperationsHealth: () => null }));
vi.mock("@/components/work-hub/RoleExports", () => ({ RoleExports: () => null }));
vi.mock("@/components/TogglePillButton", () => ({ default: ({ children, accessibilityLabel, onPress }: any) => <button aria-label={accessibilityLabel} onClick={onPress}>{children}</button> }));
vi.mock("@/lib/meeting-files", () => ({ pickMeetingFile: vi.fn() }));
vi.mock("@/lib/work-hub-file-upload", () => ({ uploadWorkHubFile: vi.fn() }));
vi.mock("@/lib/photos", () => ({ captureAndUploadImage: vi.fn() }));

beforeEach(async () => {
  await i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } });
  env.user = { id: 1, vendorId: 7, role: "vendor", activeMembershipId: 1 }; env.generation = 1;
  env.api.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/work-hub/file-library")) return [{ id: "file-a", data: { name: "Company A private" } }];
    if (path === "/api/implementation-a/assets") return { assets: [], capabilities: {} };
    if (path === "/api/work-hub/home") return { capabilities: { canCreateNote: true } };
    if (path.includes("channels?")) return [];
    throw new Error(path);
  });
});
afterEach(() => { cleanup(); env.api.mockReset(); });

it.each(["membership", "user"])("clears private records, capabilities, and drafts on a same-mounted-screen %s switch", async (change) => {
  const view = render(<WorkHubModuleScreen />);
  await screen.findByText("Company A private");
  fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
  fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "Company A draft" } });
  env.generation++;
  env.user = change === "membership" ? { ...env.user, vendorId: 8, activeMembershipId: 2 } : { ...env.user, id: 2 };
  env.api.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/work-hub/file-library")) return [{ id: "file-b", data: { name: "Company B private" } }];
    if (path === "/api/implementation-a/assets") return { assets: [], capabilities: {} };
    if (path === "/api/work-hub/home") return { capabilities: { canCreateNote: false } };
    return [];
  });
  view.rerender(<WorkHubModuleScreen />);
  expect(screen.queryByText("Company A private")).toBeNull();
  expect(screen.queryByDisplayValue("Company A draft")).toBeNull();
  await screen.findByText("Company B private");
  expect(screen.queryByRole("button", { name: "Add Note" })).toBeNull();
});

it("clears protected records and actions when a refresh is denied", async () => {
  render(<WorkHubModuleScreen />); await screen.findByText("Company A private");
  env.api.mockRejectedValue(Object.assign(new Error("Access revoked"), { status: 403 }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("Access revoked");
  await waitFor(() => expect(screen.queryByText("Company A private")).toBeNull());
  expect(screen.queryByRole("button", { name: "Add Note" })).toBeNull();
});
