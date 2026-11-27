vi.mock("react-native-svg", () => ({
  default: ({ children }: any) => <svg>{children}</svg>,
  Defs: ({ children }: any) => <defs>{children}</defs>,
  LinearGradient: ({ children }: any) => (
    <linearGradient>{children}</linearGradient>
  ),
  Stop: () => null,
  Path: () => null,
}));
// OS background file handling is outside ordinary Gate check-in/out screen tests.
vi.mock("@/lib/work-hub-background-upload-native", () => ({
  discardScannedWorkPages: vi.fn(async () => {}),
}));
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/notificationBadge", () => ({
  useUnreadNotificationCount: () => 0,
}));

const voiceFeature = vi.hoisted(() => ({ enabled: false }));
const routerState = vi.hoisted(() => ({
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
  replace: vi.fn(),
}));
vi.mock("expo-router", () => ({ router: routerState, usePathname: () => "/gate" }));
const voice = vi.hoisted(() => ({ sessions: [] as any[], speak: vi.fn(), typedSend: vi.fn(async () => undefined) }));
const operatingContext = vi.hoisted(() => ({
  gate: { siteId: 1, stationId: "gate" } as { siteId: number; stationId: string } | null,
  refreshing: null as Promise<void> | null,
  strict: false,
}));
vi.mock("@/lib/askv-audio-session", () => ({ configureAskVAudioSession: async () => {}, releaseAskVAudioSession: async () => {} }));
vi.mock("@/lib/askv-sdk/transport", () => ({
  openAskVMicrophone: async () => ({ getTracks: () => [] }),
  sdkTransport: () => ({ on: vi.fn(), sendEvent: vi.fn(), setPlaybackMuted: vi.fn(), updateSessionConfig: vi.fn() }),
}));
vi.mock("@/lib/askv-speech", () => ({ speakAskV: voice.speak, stopAskVSpeech: vi.fn() }));
vi.mock("@/lib/askvVoicePreferences", () => ({
  readAskVMuted: async () => false, readAskVAcrossVndrly: async () => false,
  writeAskVMuted: async () => {}, writeAskVAcrossVndrly: async () => {},
}));
vi.mock("@workspace/askv-realtime-sdk", () => ({
  tool: (definition: unknown) => definition,
  RealtimeAgent: class { constructor(public options: any) {} },
  RealtimeSession: class {
    handlers = new Map<string, (...args: any[]) => void>();
    close = vi.fn(); interrupt = vi.fn(); updateAgent = vi.fn(async () => {}); connect = vi.fn(async () => {});
    on = (name: string, callback: (...args: any[]) => void) => this.handlers.set(name, callback);
    emit = (name: string, ...args: any[]) => this.handlers.get(name)?.(...args);
    constructor(public agent: any, public options: any) { voice.sessions.push(this); }
  },
}));
vi.mock("@/hooks/use-assistant", () => ({
  useAssistant: () => ({
    messages: [], conversationId: null, streaming: false, activeTool: null, error: null,
    getConversationId: () => null, getConversationVersion: () => 1, getApplicationContext: () => ({}),
    restoreConversation: vi.fn(), upsertMessage: vi.fn(), send: voice.typedSend,
    startNew: vi.fn(), clear: vi.fn(), stopGeneration: vi.fn(), loadLatest: vi.fn(),
  }),
}));
vi.mock("@/components/AskVVoiceIndicator", () => ({
  default: () => <div>askv-voice-indicator</div>,
}));
vi.mock("@/components/SphereBackButton", () => ({
  default: ({ onPress, testID }: any) => (
    <button data-testid={testID} onClick={onPress}>
      Back
    </button>
  ),
}));
vi.mock("@/lib/askv-natural-voice", () => ({
  isAskVNaturalVoiceEnabled: () => voiceFeature.enabled,
}));
// The website page and the shift switch have their own suites; the Gate tab only places them.
vi.mock("@/components/GateWebPage", () => ({
  default: ({ path }: { path: string }) => <div data-testid="gate-web-page">{path}</div>,
}));
vi.mock("@/components/WorkdayControls", () => ({ default: () => null }));

vi.mock("@/lib/askv-client-tools", () => ({
  subscribeAskVGatePrefill: () => () => undefined,
  registerAskVControlAliases: () => () => undefined,
  emitAskVDataChanged: vi.fn(),
  executeAskVClientIntent: vi.fn(),
}));

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#f5f5f5",
    border: "#ccc",
    primary: "#f59e0b",
    accent: "#fef3c7",
    mutedForeground: "#666",
    destructive: "#dc2626",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

vi.mock("react-native-safe-area-context", async () => {
  const RN = await import("react-native");
  return {
    SafeAreaView: RN.View,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const strings: Record<string, string> = {
        "plateStatePicker.label": "Plate state",
        "plateStatePicker.select": "Select plate state",
        "plateStatePicker.selected":
          "Selected plate state: {{state}} ({{code}})",
        "plateStatePicker.search": "Search states",
        "plateStatePicker.noResults": "No states found.",
        "plateStatePicker.preferred": "Preferred states",
        "plateStatePicker.all": "All states",
        "plateStatePicker.close": "Close",
        "plateStatePicker.closePicker": "Close plate state picker",
        "plateStatePicker.openHint": "Opens the plate state picker.",
        "plateStatePicker.options": "Plate state options",
        "plateStatePicker.option": "{{state}} ({{code}}), state option",
        "plateStatePicker.errorHint": "Error: {{error}}",
        "gatekeeper.plateStateSuggested": "Suggested state: {{state}}",
        "gatekeeper.plateStateCorrected": "State corrected: {{state}}",
      };
      const template = strings[key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(options?.[name] ?? ""),
      );
    },
  }),
}));

const { requestForegroundPermissionsAsyncMock, getCurrentPositionAsyncMock } =
  vi.hoisted(() => ({
    requestForegroundPermissionsAsyncMock: vi.fn(),
    getCurrentPositionAsyncMock: vi.fn(),
  }));
const watchPositionAsyncMock = vi.hoisted(() => vi.fn());
vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: (...a: unknown[]) =>
    requestForegroundPermissionsAsyncMock(...a),
  getCurrentPositionAsync: (...a: unknown[]) =>
    getCurrentPositionAsyncMock(...a),
  watchPositionAsync: (...a: unknown[]) => watchPositionAsyncMock(...a),
}));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
  deleteItemAsync: vi.fn(async () => {}),
}));

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), initApi: vi.fn(), getApiBase: () => "https://example.test" }));
vi.mock("@/lib/auth", () => ({
  setToken: vi.fn(),
  setUser: vi.fn(),
  getToken: vi.fn(),
  getCachedToken: vi.fn(() => "token"),
  subscribeToken: vi.fn(() => () => {}),
  subscribeUser: vi.fn(() => () => {}),
  captureAuthScope: vi.fn(() => ({ generation: 1 })),
  isAuthScopeCurrent: vi.fn(() => true),
}));

const {
  fetchSiteContextMock,
  fetchGatekeeperVisitsMock,
  fetchGatekeeperRecentVisitsMock,
  fetchAssignedGateSitesMock,
  fetchPreferredPlateStatesMock,
  submitGatekeeperVisitMock,
  gatekeeperCheckOutMock,
  captureAndUploadImageMock,
  readGatePlateMock,
  createPttRecorderMock,
  recorderStartMock,
  recorderStopMock,
  recorderDisposeMock,
  transcribeAskVRecordingMock,
} = vi.hoisted(() => ({
  fetchSiteContextMock: vi.fn(),
  fetchGatekeeperVisitsMock: vi.fn(),
  fetchGatekeeperRecentVisitsMock: vi.fn(),
  fetchAssignedGateSitesMock: vi.fn(),
  fetchPreferredPlateStatesMock: vi.fn(),
  submitGatekeeperVisitMock: vi.fn(),
  gatekeeperCheckOutMock: vi.fn(),
  captureAndUploadImageMock: vi.fn(),
  readGatePlateMock: vi.fn(),
  createPttRecorderMock: vi.fn(),
  recorderStartMock: vi.fn(),
  recorderStopMock: vi.fn(),
  recorderDisposeMock: vi.fn(),
  transcribeAskVRecordingMock: vi.fn(),
}));

vi.mock("@/lib/guest", () => ({
  fetchSiteContext: (...a: unknown[]) => fetchSiteContextMock(...a),
}));

vi.mock("@/lib/gatekeeper", () => ({
  deleteGateEvidence: vi.fn(async () => undefined),
  fetchGatekeeperVisits: (...a: unknown[]) => fetchGatekeeperVisitsMock(...a),
  fetchGatekeeperRecentVisits: (...a: unknown[]) =>
    fetchGatekeeperRecentVisitsMock(...a),
  fetchAssignedGateSites: (...a: unknown[]) => fetchAssignedGateSitesMock(...a),
  fetchPreferredPlateStates: (...a: unknown[]) =>
    fetchPreferredPlateStatesMock(...a),
  submitGatekeeperVisit: (...a: unknown[]) => submitGatekeeperVisitMock(...a),
  gatekeeperCheckOut: (...a: unknown[]) => gatekeeperCheckOutMock(...a),
  gateAdmit: vi.fn(),
  readGatePlate: (...a: unknown[]) => readGatePlateMock(...a),
}));

vi.mock("@/lib/photos", () => ({
  captureAndUploadImage: (...a: unknown[]) => captureAndUploadImageMock(...a),
}));

vi.mock("@/lib/ptt", () => ({
  createPttRecorder: (...a: unknown[]) => createPttRecorderMock(...a),
  PttMicPermissionError: class PttMicPermissionError extends Error {},
}));

vi.mock("@/lib/askv-transcribe", () => ({
  transcribeAskVRecording: (...a: unknown[]) =>
    transcribeAskVRecordingMock(...a),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({
    isOrgBranded: true,
    logoSquareUrl: "https://cdn.example.com/vendor.png",
    logoUrl: null,
    name: "Acme Vendor",
    primary: "#f59e0b",
  }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { role: "vendor", vendorRole: "gatekeeper", vendorId: 1054 },
    activeMembership: {
      orgLogoUrl: "https://cdn.example.com/vendor.png",
      orgName: "Acme Vendor",
    },
  }),
}));

vi.mock("@/components/AuthedImage", () => ({
  default: ({ uri, testID }: { uri?: string | null; testID?: string }) => {
    const ReactLib = require("react");
    return ReactLib.createElement("img", {
      "data-testid": testID ?? "authed-image",
      src: uri ?? "",
      alt: "",
    });
  },
}));

vi.mock("@/components/AmberButton", async () => {
  const ReactLib = (await import("react")).default;
  return {
    default: ({
      children,
      onPress,
      disabled,
      loading,
      height,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      loading?: boolean;
      height?: number;
      testID?: string;
    }) => {
      const isDisabled = !!(disabled || loading);
      return ReactLib.createElement(
        "button",
        {
          "data-testid": testID,
          "data-height": height,
          "aria-disabled": isDisabled || undefined,
          disabled: isDisabled,
          onClick: isDisabled ? undefined : onPress,
        },
        typeof children === "string" ? children : "btn",
      );
    },
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alert } from "react-native";

import GateTab, { NativeGatekeeperScreen as GatekeeperScreen } from "../(tabs)/gate";
import type { SiteContext } from "@/lib/guest";
import { requestGateVoiceEntry } from "@/lib/gate-voice-launch";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { AskVVoiceProvider, useAskVVoiceSession } from "@/hooks/use-askv-voice-session";
import GateAppShell from "@/components/gate/GateAppShell";
import GateAskVStatus from "@/components/gate/GateAskVStatus";
import {
  cancelGateVoiceDraft,
  confirmGateCheckIn,
  fillGateCheckIn,
  gateCheckInReview,
  openGateCheckIn,
  readGateVoiceDraft,
  readVoicePageContext,
} from "@workspace/gate-booth";

afterEach(() => {
  cleanup();
});

const FLYWHEEL_SITE = {
  id: 309,
  name: "Flywheel Energy Spur",
  address: "34.63951, -97.66194",
  siteCode: "SITE-B40D77D2",
  latitude: 34.63951,
  longitude: -97.66194,
  assignmentId: 14819,
};

beforeEach(() => {
  vi.clearAllMocks();
  voiceFeature.enabled = false;
  captureAndUploadImageMock.mockReset();
  readGatePlateMock.mockReset();
  fetchGatekeeperVisitsMock.mockResolvedValue([]);
  fetchGatekeeperRecentVisitsMock.mockResolvedValue([]);
  readGatePlateMock.mockResolvedValue(null);
  recorderStartMock.mockResolvedValue(undefined);
  recorderStopMock.mockResolvedValue({
    uri: "file:///gate-command.m4a",
    durationSeconds: 3,
  });
  recorderDisposeMock.mockResolvedValue(undefined);
  createPttRecorderMock.mockResolvedValue({
    start: recorderStartMock,
    stop: recorderStopMock,
    dispose: recorderDisposeMock,
  });
  transcribeAskVRecordingMock.mockResolvedValue(
    "check in Bob Villa from NewCo state TX plate ABC123 for equipment delivery",
  );
  fetchAssignedGateSitesMock.mockResolvedValue({
    sites: [FLYWHEEL_SITE],
    defaultSite: FLYWHEEL_SITE,
  });
  fetchPreferredPlateStatesMock.mockResolvedValue({
    preferred: ["CA", "TX", "NY", "FL", "OH"],
  });
  vi.spyOn(Alert, "alert").mockImplementation(() => {});
  requestForegroundPermissionsAsyncMock.mockResolvedValue({
    status: "granted",
  });
  getCurrentPositionAsyncMock.mockResolvedValue({
    coords: { latitude: 37.7, longitude: -122.4 },
  });
  watchPositionAsyncMock.mockImplementation(async (_opts, cb) => {
    cb({ coords: { latitude: 37.7, longitude: -122.4 } });
    return { remove: vi.fn() };
  });
});

const SITE_CTX: SiteContext = {
  site: {
    id: 42,
    name: "Acme HQ",
    address: "123 Main St",
    latitude: 37.7,
    longitude: -122.4,
    siteRadiusMeters: 100,
    siteCode: "ACME-HQ",
  },
  partner: { id: 7, name: "Acme Partner" },
  vendors: [{ id: 11, name: "Bolt Vendor" }],
};

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <GatekeeperScreen />
    </QueryClientProvider>,
  );
}

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

async function findFirstByTestId(id: string): Promise<HTMLElement> {
  await screen.findByTestId(id);
  return firstByTestId(id);
}

function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

function isDisabled(el: HTMLElement): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;
  if ((el as HTMLButtonElement).disabled === true) return true;
  return false;
}

describe("GatekeeperScreen", () => {
  it("submits at the selected site when device GPS is denied", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 88 });
    requestForegroundPermissionsAsyncMock.mockResolvedValue({
      status: "denied",
    });
    renderScreen();
    await findFirstByTestId("gate-first-name");
    fireEvent.change(firstByTestId("gate-first-name"), {
      target: { value: "Pat" },
    });
    fireEvent.change(firstByTestId("gate-last-name"), {
      target: { value: "NoGPS" },
    });
    fireEvent.change(firstByTestId("gate-vehicle-plate"), {
      target: { value: "NG1" },
    });
    await waitFor(() =>
      expect(isDisabled(firstByTestId("check-in-btn"))).toBe(false),
    );
    tap(firstByTestId("check-in-btn"));
    await waitFor(() =>
      expect(submitGatekeeperVisitMock).toHaveBeenCalledWith(
        expect.objectContaining({
          coordinates: null,
          firstName: "Pat",
          ctx: expect.objectContaining({
            site: expect.objectContaining({ id: 42 }),
          }),
        }),
      ),
    );
  });
  it("renders the state-qualified plate in the active visit rows", async () => {
    fetchGatekeeperVisitsMock.mockResolvedValue([
      {
        id: 88,
        firstName: "Taylor",
        lastName: "Reed",
        company: "Acme",
        siteLocationId: 42,
        siteName: "Acme HQ",
        siteAddress: "123 Main St",
        hostType: "partner",
        hostPartnerName: "Acme Partner",
        hostVendorName: null,
        purpose: "Delivery",
        vehiclePlate: "ABC123",
        plateState: "TX",
        platePhotoUrl: null,
        vehiclePhotoUrl: null,
        expectedDurationMinutes: 60,
        checkInTime: "2026-08-27T12:00:00Z",
        checkOutTime: null,
        expiresAt: "2026-08-27T13:00:00Z",
      },
    ]);

    const view = renderScreen();

    await waitFor(() =>
      expect(view.container.textContent).toContain("TX • ABC123"),
    );
  });

  it("fills the five check-in fields and leaves the normal submit button ready", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    renderScreen();
    await findFirstByTestId("gate-first-name");

    requestGateVoiceEntry();
    await waitFor(() => expect(recorderStartMock).toHaveBeenCalledTimes(1));
    expect(recorderStopMock).not.toHaveBeenCalled();
    expect(screen.getByText("gatekeeper.voiceListening")).toBeTruthy();

    requestGateVoiceEntry();
    await waitFor(() => expect(recorderStopMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(transcribeAskVRecordingMock).toHaveBeenCalledWith(
        "file:///gate-command.m4a",
      ),
    );
    expect((firstByTestId("gate-first-name") as HTMLInputElement).value).toBe(
      "Bob",
    );
    expect((firstByTestId("gate-last-name") as HTMLInputElement).value).toBe(
      "Villa",
    );
    expect((firstByTestId("gate-company") as HTMLInputElement).value).toBe(
      "NewCo",
    );
    expect(
      (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
    ).toBe("ABC123");
    expect((firstByTestId("purpose-input") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("gatekeeper.voiceConfirmCheckIn")).toBeNull();
    expect(firstByTestId("check-in-btn")).toBeTruthy();
  });

  it("replaces the last plate driver using exact-company first-name suggestions", async () => {
    const baseVisit = {
      siteLocationId: 309,
      siteName: "Flywheel Energy Spur",
      siteAddress: "34.63951, -97.66194",
      hostType: "partner",
      hostPartnerName: "Flywheel Energy",
      hostVendorName: null,
      purpose: "Delivery",
      platePhotoUrl: null,
      vehiclePhotoUrl: null,
      expectedDurationMinutes: 60,
      plateState: "TX",
      checkOutTime: "2026-08-26T11:00:00Z",
      expiresAt: null,
    };
    fetchGatekeeperRecentVisitsMock.mockResolvedValue([
      {
        ...baseVisit,
        id: 101,
        firstName: "Bob",
        lastName: "Villa",
        company: "Peak Energy",
        vehiclePlate: "51D4A1",
        checkInTime: "2026-08-26T10:00:00Z",
      },
      {
        ...baseVisit,
        id: 100,
        firstName: "Bonnie",
        lastName: "West",
        company: "Peak Energy",
        vehiclePlate: "TX9911",
        checkInTime: "2026-08-25T10:00:00Z",
      },
      {
        ...baseVisit,
        id: 99,
        firstName: "Bonnie",
        lastName: "Smith",
        company: "Peak Energy Services",
        vehiclePlate: "TX2288",
        checkInTime: "2026-08-24T10:00:00Z",
      },
    ]);

    renderScreen();
    const plate = await findFirstByTestId("gate-vehicle-plate");
    fireEvent.change(plate, { target: { value: "51D-4A1" } });
    tap(screen.getByRole("button", { name: "Select plate state" }));
    tap(screen.getByRole("button", { name: "Texas (TX), state option" }));

    await waitFor(() => {
      expect((firstByTestId("gate-first-name") as HTMLInputElement).value).toBe(
        "Bob",
      );
      expect((firstByTestId("gate-last-name") as HTMLInputElement).value).toBe(
        "Villa",
      );
      expect((firstByTestId("gate-company") as HTMLInputElement).value).toBe(
        "Peak Energy",
      );
    });

    fireEvent.change(firstByTestId("gate-first-name"), {
      target: { value: "Bon" },
    });
    expect(await screen.findByText("Bonnie West")).toBeTruthy();
    expect(screen.queryByText("Bonnie Smith")).toBeNull();
    tap(firstByTestId("gate-driver-suggestion-100"));

    expect((firstByTestId("gate-first-name") as HTMLInputElement).value).toBe(
      "Bonnie",
    );
    expect((firstByTestId("gate-last-name") as HTMLInputElement).value).toBe(
      "West",
    );
    expect((firstByTestId("gate-company") as HTMLInputElement).value).toBe(
      "Peak Energy",
    );
    expect(
      (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
    ).toBe("51D-4A1");
  });

  it("omits duplicate iPhone company branding and places Back immediately before Gate Portal", async () => {
    renderScreen();
    await findFirstByTestId("gate-first-name");
    expect(screen.queryByTestId("gate-brand-logo")).toBeNull();
    expect(screen.queryByTestId("gate-vndrly-logo")).toBeNull();
    const back = firstByTestId("gate-page-back");
    const title = screen.getByRole("heading", { name: "gatekeeper.portal" });
    expect(back.parentElement).toBe(title.parentElement);
    expect(Array.from(back.parentElement!.children).indexOf(back)).toBeLessThan(
      Array.from(title.parentElement!.children).indexOf(title),
    );
    tap(back);
    expect(routerState.back).toHaveBeenCalledTimes(1);
  });

  it("keeps one right-aligned Submit Check-In action at the bottom of the new entry card", async () => {
    renderScreen();
    await findFirstByTestId("gate-first-name");

    const submitButtons = screen.getAllByTestId("check-in-btn");
    expect(submitButtons).toHaveLength(1);
    const row = firstByTestId("gate-submit-row");
    expect(row.contains(submitButtons[0])).toBe(true);
    expect(row.getAttribute("style")).toContain("align-items: flex-end");
    expect(submitButtons[0].getAttribute("data-height")).toBe("30");
    expect(screen.getByText("gatekeeper.submitCheckIn")).toBeTruthy();
  });

  it("does not show phone or email fields", async () => {
    renderScreen();
    await findFirstByTestId("gate-first-name");
    expect(screen.queryByText("visitor.phone")).toBeNull();
    expect(screen.queryByText("visitor.email")).toBeNull();
    expect(screen.queryByTestId("input-gate-phone")).toBeNull();
    expect(screen.queryByTestId("input-gate-email")).toBeNull();
  });

  it("shows tag and vehicle photo capture on the main form before site lookup", async () => {
    renderScreen();
    await findFirstByTestId("gate-first-name");
    expect(firstByTestId("gate-capture-tag-photo")).toBeTruthy();
    expect(firstByTestId("gate-capture-vehicle-photo")).toBeTruthy();
    expect(screen.queryByTestId("capture-plate-photo-btn")).toBeNull();
    expect(screen.queryByTestId("capture-vehicle-photo-btn")).toBeNull();
  });

  it("defaults the current location to Flywheel Energy Spur like the web booth", async () => {
    fetchSiteContextMock.mockResolvedValue({
      ...SITE_CTX,
      site: {
        ...SITE_CTX.site,
        name: "Flywheel Energy Spur",
        siteCode: "SITE-B40D77D2",
      },
    });
    renderScreen();
    expect(await screen.findByTestId("site-gate-selector")).toBeTruthy();
    expect(
      (await screen.findAllByText(/Flywheel Energy Spur/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("gate-site-code")).toBeNull();
    await waitFor(() => {
      expect(fetchSiteContextMock).toHaveBeenCalledWith("SITE-B40D77D2");
    });
  });

  it("renders site-preferred plate states immediately before the plate input", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    fetchPreferredPlateStatesMock.mockResolvedValue({
      preferred: ["TX"],
    });

    renderScreen();

    await waitFor(() => {
      expect(fetchPreferredPlateStatesMock).toHaveBeenCalledWith(
        42,
        "SITE-B40D77D2",
      );
    });
    const trigger = screen.getByRole("button", { name: "Select plate state" });
    const plateInput = firstByTestId("gate-vehicle-plate");
    expect(
      trigger.compareDocumentPosition(plateInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    tap(trigger);
    const stateOptions = screen.getAllByRole("button", {
      name: /state option$/,
    });
    expect(
      stateOptions
        .slice(0, 3)
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual([
      "Oklahoma (OK), state option",
      "Texas (TX), state option",
      "Alabama (AL), state option",
    ]);
  });

  it("uses the national state fallback when site preferences fail", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    fetchPreferredPlateStatesMock.mockRejectedValue(new Error("unavailable"));
    renderScreen();

    await waitFor(() =>
      expect(fetchPreferredPlateStatesMock).toHaveBeenCalledWith(
        42,
        "SITE-B40D77D2",
      ),
    );
    tap(screen.getByRole("button", { name: "Select plate state" }));
    const stateOptions = screen.getAllByRole("button", {
      name: /state option$/,
    });
    expect(
      stateOptions
        .slice(0, 3)
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual([
      "Oklahoma (OK), state option",
      "California (CA), state option",
      "Texas (TX), state option",
    ]);
  });

  it("waits for state before filling a returning driver and then chooses the exact composite match", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    fetchGatekeeperRecentVisitsMock.mockResolvedValue([
      {
        id: 2,
        firstName: "Wrong",
        lastName: "State",
        company: "Peak Energy",
        vehiclePlate: "4412",
        plateState: "OK",
        purpose: "Wrong match",
        expectedDurationMinutes: 60,
        checkInTime: "2026-08-23T10:00:00Z",
      },
      {
        id: 1,
        siteLocationId: 42,
        firstName: "Exact",
        lastName: "Texas",
        company: "Peak Energy",
        vehiclePlate: "44-12",
        plateState: "TX",
        purpose: "Exact match",
        expectedDurationMinutes: 45,
        checkInTime: "2026-08-20T10:00:00Z",
      },
    ]);
    renderScreen();

    fireEvent.change(await findFirstByTestId("gate-vehicle-plate"), {
      target: { value: "4412" },
    });
    tap(screen.getByRole("button", { name: "Select plate state" }));
    tap(screen.getByRole("button", { name: "Texas (TX), state option" }));

    await waitFor(() => {
      expect((firstByTestId("gate-first-name") as HTMLInputElement).value).toBe(
        "Exact",
      );
      expect((firstByTestId("gate-last-name") as HTMLInputElement).value).toBe(
        "Texas",
      );
    });
  });

  it("replaces prior composite auto-fill after switching to a state with a different exact match and preserves manual edits", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    fetchGatekeeperRecentVisitsMock.mockResolvedValue([
      {
        id: 1,
        siteLocationId: 42,
        firstName: "Oklahoma",
        lastName: "Visitor",
        company: "Sooner Services",
        vehiclePlate: "4412",
        plateState: "OK",
        purpose: "Delivery",
        expectedDurationMinutes: 30,
        checkInTime: "2026-08-23T10:00:00Z",
      },
      {
        id: 2,
        siteLocationId: 42,
        firstName: "Texas",
        lastName: "Driver",
        company: "Lone Star Services",
        vehiclePlate: "4412",
        plateState: "TX",
        purpose: "Inspection",
        expectedDurationMinutes: 45,
        checkInTime: "2026-08-22T10:00:00Z",
      },
    ]);
    renderScreen();

    fireEvent.change(await findFirstByTestId("gate-vehicle-plate"), {
      target: { value: "4412" },
    });
    tap(screen.getByRole("button", { name: "Select plate state" }));
    tap(screen.getByRole("button", { name: "Oklahoma (OK), state option" }));
    await waitFor(() => {
      expect((firstByTestId("gate-first-name") as HTMLInputElement).value).toBe(
        "Oklahoma",
      );
      expect((firstByTestId("gate-last-name") as HTMLInputElement).value).toBe(
        "Visitor",
      );
    });

    fireEvent.change(firstByTestId("gate-first-name"), {
      target: { value: "Manual" },
    });
    tap(
      screen.getByRole("button", {
        name: "Selected plate state: Oklahoma (OK)",
      }),
    );
    tap(screen.getByRole("button", { name: "Texas (TX), state option" }));

    await waitFor(() => {
      expect((firstByTestId("gate-first-name") as HTMLInputElement).value).toBe(
        "Manual",
      );
      expect((firstByTestId("gate-last-name") as HTMLInputElement).value).toBe(
        "Driver",
      );
    });
  });

  it("clears prior composite auto-fill when OCR corrects the state to one with no match and preserves manual edits", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    fetchGatekeeperRecentVisitsMock.mockResolvedValue([
      {
        id: 1,
        siteLocationId: 42,
        firstName: "Oklahoma",
        lastName: "Visitor",
        company: "Sooner Services",
        vehiclePlate: "4412",
        plateState: "OK",
        purpose: "Delivery",
        expectedDurationMinutes: 30,
        checkInTime: "2026-08-23T10:00:00Z",
      },
    ]);
    captureAndUploadImageMock.mockResolvedValue({
      objectPath: "/uploads/tx.jpg",
    });
    readGatePlateMock.mockResolvedValue({
      plate: "4412",
      state: "TX",
      plateConfidence: 0.98,
      stateConfidence: 0.91,
    });
    renderScreen();

    fireEvent.change(await findFirstByTestId("gate-vehicle-plate"), {
      target: { value: "4412" },
    });
    tap(screen.getByRole("button", { name: "Select plate state" }));
    tap(screen.getByRole("button", { name: "Oklahoma (OK), state option" }));
    await waitFor(() => {
      expect((firstByTestId("gate-last-name") as HTMLInputElement).value).toBe(
        "Visitor",
      );
    });

    fireEvent.change(firstByTestId("gate-first-name"), {
      target: { value: "Manual" },
    });
    tap(firstByTestId("gate-capture-tag-photo"));
    await waitFor(() => expect(readGatePlateMock).toHaveBeenCalled());

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Selected plate state: Texas (TX)",
        }),
      ).toBeTruthy();
      expect((firstByTestId("gate-first-name") as HTMLInputElement).value).toBe(
        "Manual",
      );
      expect((firstByTestId("gate-last-name") as HTMLInputElement).value).toBe(
        "",
      );
    });
  });

  it("allows a plate-only check-in when state is unknown", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 88 });
    renderScreen();

    fireEvent.change(await findFirstByTestId("gate-first-name"), {
      target: { value: "Jordan" },
    });
    fireEvent.change(firstByTestId("gate-last-name"), {
      target: { value: "Hale" },
    });
    fireEvent.change(firstByTestId("gate-vehicle-plate"), {
      target: { value: "4412" },
    });
    const submit = await findFirstByTestId("check-in-btn");
    await waitFor(() => expect(isDisabled(submit)).toBe(false));
    tap(submit);

    await waitFor(() =>
      expect(submitGatekeeperVisitMock).toHaveBeenCalledTimes(1),
    );
    expect(submitGatekeeperVisitMock.mock.calls[0][0]).toMatchObject({
      vehiclePlate: "4412",
      plateState: null,
    });
  });

  it("applies the OCR threshold, keeps manual correction, sends state, and clears it after success", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    captureAndUploadImageMock
      .mockResolvedValueOnce({ objectPath: "/uploads/low.jpg" })
      .mockResolvedValueOnce({ objectPath: "/uploads/high.jpg" });
    readGatePlateMock
      .mockResolvedValueOnce({
        plate: "4412",
        state: "TX",
        plateConfidence: 0.97,
        stateConfidence: 0.79,
      })
      .mockResolvedValueOnce({
        plate: "4412",
        state: "TX",
        plateConfidence: 0.97,
        stateConfidence: 0.8,
      });
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 88 });
    renderScreen();

    fireEvent.change(await findFirstByTestId("gate-vehicle-plate"), {
      target: { value: "4412" },
    });
    tap(await screen.findByRole("button", { name: "Select plate state" }));
    tap(screen.getByRole("button", { name: "Oklahoma (OK), state option" }));
    tap(firstByTestId("gate-capture-tag-photo"));
    await waitFor(() => expect(readGatePlateMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Selected plate state: Oklahoma (OK)",
        }),
      ).toBeTruthy();
      expect(
        (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
      ).toBe("4412");
      expect(isDisabled(firstByTestId("gate-capture-tag-photo"))).toBe(false);
    });

    tap(firstByTestId("gate-capture-tag-photo"));
    await waitFor(() => expect(readGatePlateMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Selected plate state: Texas (TX)",
        }),
      ).toBeTruthy();
      expect(screen.getByText("Suggested state: TX")).toBeTruthy();
    });
    tap(
      screen.getByRole("button", { name: "Selected plate state: Texas (TX)" }),
    );
    tap(screen.getByRole("button", { name: "Oklahoma (OK), state option" }));
    expect(screen.getByText("State corrected: OK")).toBeTruthy();

    fireEvent.change(firstByTestId("gate-first-name"), {
      target: { value: "Jordan" },
    });
    fireEvent.change(firstByTestId("gate-last-name"), {
      target: { value: "Hale" },
    });
    await waitFor(() =>
      expect(isDisabled(firstByTestId("check-in-btn"))).toBe(false),
    );
    tap(firstByTestId("check-in-btn"));

    await waitFor(() =>
      expect(submitGatekeeperVisitMock).toHaveBeenCalledTimes(1),
    );
    expect(submitGatekeeperVisitMock.mock.calls[0][0]).toMatchObject({
      plateState: "OK",
      vehiclePlate: "4412",
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Select plate state" }),
      ).toBeTruthy();
      expect(screen.queryByText("State corrected: OK")).toBeNull();
    });
  });

  it("clears stale state across sequential OCR plates and replaces both when OCR supplies state", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    captureAndUploadImageMock
      .mockResolvedValueOnce({ objectPath: "/uploads/old.jpg" })
      .mockResolvedValueOnce({ objectPath: "/uploads/new.jpg" })
      .mockResolvedValueOnce({ objectPath: "/uploads/final.jpg" });
    readGatePlateMock
      .mockResolvedValueOnce({
        plate: "OLD-123",
        state: "OK",
        plateConfidence: 0.98,
        stateConfidence: 0.9,
      })
      .mockResolvedValueOnce({
        plate: "NEW-456",
        state: "TX",
        plateConfidence: 0.98,
        stateConfidence: 0.79,
      })
      .mockResolvedValueOnce({
        plate: "FINAL-9",
        state: "TX",
        plateConfidence: 0.98,
        stateConfidence: 0.9,
      });
    renderScreen();

    tap(await findFirstByTestId("gate-capture-tag-photo"));
    await waitFor(() => expect(readGatePlateMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(
        (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
      ).toBe("OLD-123");
      expect(
        screen.getByRole("button", {
          name: "Selected plate state: Oklahoma (OK)",
        }),
      ).toBeTruthy();
      expect(isDisabled(firstByTestId("gate-capture-tag-photo"))).toBe(false);
    });

    tap(firstByTestId("gate-capture-tag-photo"));
    await waitFor(() => expect(readGatePlateMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(
        (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
      ).toBe("NEW-456");
      expect(
        screen.getByRole("button", { name: "Select plate state" }),
      ).toBeTruthy();
      expect(isDisabled(firstByTestId("gate-capture-tag-photo"))).toBe(false);
    });
    fireEvent.change(firstByTestId("gate-first-name"), {
      target: { value: "Jane" },
    });
    fireEvent.change(firstByTestId("gate-last-name"), {
      target: { value: "Doe" },
    });

    tap(firstByTestId("gate-capture-tag-photo"));
    await waitFor(() => expect(readGatePlateMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(
        (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
      ).toBe("FINAL-9");
      expect(
        screen.getByRole("button", {
          name: "Selected plate state: Texas (TX)",
        }),
      ).toBeTruthy();
    });
  });

  it("sends captured tag and vehicle photos with check-in and omits phone/email", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    captureAndUploadImageMock
      .mockResolvedValueOnce({ objectPath: "/uploads/tag.jpg" })
      .mockResolvedValueOnce({ objectPath: "/uploads/truck.jpg" });
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 88 });

    renderScreen();
    await findFirstByTestId("gate-first-name");

    fireEvent.change(firstByTestId("gate-first-name"), {
      target: { value: "Jordan" },
    });
    fireEvent.change(firstByTestId("gate-last-name"), {
      target: { value: "Hale" },
    });
    tap(screen.getByRole("button", { name: "Select plate state" }));
    tap(screen.getByRole("button", { name: "Oklahoma (OK), state option" }));

    tap(firstByTestId("gate-capture-tag-photo"));
    await waitFor(() => {
      expect(captureAndUploadImageMock).toHaveBeenCalledTimes(1);
      expect(isDisabled(firstByTestId("gate-capture-vehicle-photo"))).toBe(
        false,
      );
    });
    tap(firstByTestId("gate-capture-vehicle-photo"));
    await waitFor(() => {
      expect(captureAndUploadImageMock).toHaveBeenCalledTimes(2);
      expect(isDisabled(firstByTestId("gate-capture-tag-photo"))).toBe(false);
    });

    await waitFor(() =>
      expect(isDisabled(firstByTestId("check-in-btn"))).toBe(false),
    );
    tap(firstByTestId("check-in-btn"));

    await waitFor(() => {
      expect(submitGatekeeperVisitMock).toHaveBeenCalledTimes(1);
    });
    const payload = submitGatekeeperVisitMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("phone");
    expect(payload).not.toHaveProperty("email");
    expect(payload.platePhotoUrl).toBe("/uploads/tag.jpg");
    expect(payload.vehiclePhotoUrl).toBe("/uploads/truck.jpg");
    expect(payload.firstName).toBe("Jordan");
  });

  it("leaves Gate push-to-talk disabled when the global Ask V voice owner is enabled", async () => {
    voiceFeature.enabled = true;
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    renderScreen();
    await findFirstByTestId("gate-first-name");

    requestGateVoiceEntry();
    await Promise.resolve();

    expect(createPttRecorderMock).not.toHaveBeenCalled();
    expect(recorderStartMock).not.toHaveBeenCalled();
  });
  it("fills vehicle recognition immediately without automatically submitting", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    captureAndUploadImageMock.mockResolvedValue({
      objectPath: "/uploads/vehicle.jpg",
    });
    readGatePlateMock.mockResolvedValue({
      plate: "TRK123",
      state: "OK",
      plateConfidence: 0.99,
      stateConfidence: 0.99,
      appearance: {
        color: "white",
        bodyType: "pickup",
        make: "Ford",
        model: null,
        markings: ["unit 12"],
      },
    });
    renderScreen();
    tap(await findFirstByTestId("gate-capture-vehicle-photo"));
    await waitFor(() => expect((firstByTestId("gate-vehicle-plate") as HTMLInputElement).value).toBe("TRK123"));
    expect(readGatePlateMock).toHaveBeenCalledWith(
      "/uploads/vehicle.jpg",
      "vehicle",
    );
    expect(
      (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
    ).toBe("TRK123");
    expect(screen.queryByTestId("gate-confirm-recognition")).toBeNull();
    await waitFor(() =>
      expect(
        (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
      ).toBe("TRK123"),
    );
    expect(submitGatekeeperVisitMock).not.toHaveBeenCalled();
    expect(gatekeeperCheckOutMock).not.toHaveBeenCalled();
  });

  it("keeps manual entry available and reports a provider outage", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    captureAndUploadImageMock.mockResolvedValue({
      objectPath: "/uploads/vehicle.jpg",
    });
    readGatePlateMock.mockRejectedValue(new Error("provider failed"));
    renderScreen();
    tap(await findFirstByTestId("gate-capture-vehicle-photo"));
    expect(
      await screen.findByText("gatekeeper.recognitionUnavailable"),
    ).toBeTruthy();
    expect(screen.queryByTestId("gate-confirm-recognition")).toBeNull();
    fireEvent.change(firstByTestId("gate-vehicle-plate"), {
      target: { value: "MANUAL1" },
    });
    expect(
      (firstByTestId("gate-vehicle-plate") as HTMLInputElement).value,
    ).toBe("MANUAL1");
  });
});

describe("AskV on the native Gate form", () => {
  const BOB = { firstName: "Bob", lastName: "Villa", company: "NewCo", vehiclePlate: "ABC123", plateState: "TX" };
  const value = (id: string) => (firstByTestId(id) as HTMLInputElement).value;
  const MAIN_GATE = { id: "g-main", siteId: 42, name: "Main Gate", latitude: null, longitude: null, version: 1, active: true, topology: null };
  const INNER_GATE = { id: "g-inner", siteId: 42, name: "Inner Gate", latitude: null, longitude: null, version: 1, active: true, topology: { kind: "series", area: "Pad A", parentGateId: "g-main", parallelGateId: null } };
  /** The site has a main gate and one secure area behind it; `station` is the gate this phone is working. */
  function secureSite(station: { id: string; name: string }) {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/gate-change-over/stations")) return { stations: [{ id: station.id, name: station.name, latitude: null, longitude: null, geofenceRadiusM: 500 }] };
      if (path.startsWith("/api/gate-change-over/movements?")) return { gates: [MAIN_GATE, INNER_GATE], visits: [], canManage: false, movementGateIds: [] };
      return undefined;
    });
  }
  async function dictate(values: Record<string, string> = BOB) {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    renderScreen();
    await findFirstByTestId("gate-first-name");
    await waitFor(() => expect(readGateVoiceDraft()?.siteLocationId).toBe(42));
    act(() => {
      openGateCheckIn();
      fillGateCheckIn(values);
    });
    await waitFor(() => expect(gateCheckInReview(readGateVoiceDraft())?.ready).toBe(true));
    return gateCheckInReview(readGateVoiceDraft())!;
  }
  afterEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it("reads the spoken check-in back with its site and saves it without a dialog", async () => {
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 91 });
    const review = await dictate();
    expect(readGateVoiceDraft()).toMatchObject({ silentCheckIn: true, siteLocationId: 42, siteName: "Acme HQ", capturePending: false });
    expect(value("gate-first-name")).toBe("Bob");
    expect(value("gate-vehicle-plate")).toBe("ABC123");

    await act(async () => {
      await confirmGateCheckIn(review.key);
    });

    expect(submitGatekeeperVisitMock).toHaveBeenCalledWith(expect.objectContaining({ ...BOB, ctx: expect.objectContaining({ site: expect.objectContaining({ id: 42 }) }) }));
    expect(Alert.alert).not.toHaveBeenCalled();
    await waitFor(() => expect(value("gate-first-name")).toBe(""));
    expect(gateCheckInReview(readGateVoiceDraft())).toBeNull();
  });

  it("gives AskV the reason when the check-in is refused, and keeps the form", async () => {
    submitGatekeeperVisitMock.mockRejectedValue(new Error("refused"));
    const review = await dictate();
    let reason = "";
    await act(async () => {
      await confirmGateCheckIn(review.key).catch((error: Error) => {
        reason = error.message;
      });
    });
    expect(reason).toBeTruthy();
    expect(firstByTestId("gate-entry-error").textContent).toBe(reason);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(value("gate-first-name")).toBe("Bob");
  });

  it("does not save a check-in that changed after AskV read it back", async () => {
    const review = await dictate();
    fireEvent.change(firstByTestId("gate-first-name"), { target: { value: "Robert" } });
    await expect(confirmGateCheckIn(review.key)).rejects.toThrow(/changed/i);
    expect(submitGatekeeperVisitMock).not.toHaveBeenCalled();
  });

  it("clears the form when AskV cancels the check-in", async () => {
    await dictate();
    act(() => cancelGateVoiceDraft());
    await waitFor(() => expect(value("gate-first-name")).toBe(""));
    expect(value("gate-vehicle-plate")).toBe("");
    expect(gateCheckInReview(readGateVoiceDraft())).toBeNull();
  });

  it("waits for a photo that is still saving before submitting, then attaches it", async () => {
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 92 });
    readGatePlateMock.mockResolvedValue({ plate: null, state: null, plateConfidence: null, stateConfidence: null });
    let finishUpload: (photo: { objectPath: string }) => void = () => {};
    captureAndUploadImageMock.mockReturnValue(new Promise((resolve) => { finishUpload = resolve; }));
    const review = await dictate();

    tap(firstByTestId("gate-capture-tag-photo"));
    await waitFor(() => expect(readGateVoiceDraft()?.capturePending).toBe(true));
    let saved = false;
    const confirming = confirmGateCheckIn(review.key).then(() => { saved = true; });
    await act(async () => { await Promise.resolve(); });
    expect(submitGatekeeperVisitMock).not.toHaveBeenCalled();

    await act(async () => {
      finishUpload({ objectPath: "/uploads/tag.jpg" });
      await confirming;
    });
    expect(saved).toBe(true);
    expect(submitGatekeeperVisitMock).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Bob", platePhotoUrl: "/uploads/tag.jpg" }));
  });

  it("routes a spoken destination to its secure area and writes an unknown one into the notes", async () => {
    secureSite(MAIN_GATE);
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 93 });
    await dictate({ ...BOB, destination: "pad a" });
    await waitFor(() => expect(readGateVoiceDraft()).toMatchObject({ gateStationId: "g-main", gateStationName: "Main Gate", destinationId: "g-inner", destinationName: "Pad A", destinationNeedsReview: false }));
    expect(firstByTestId("gate-destination-g-inner").textContent).toBe("✓ Pad A");
    await act(async () => {
      await confirmGateCheckIn(gateCheckInReview(readGateVoiceDraft())!.key);
    });
    expect(submitGatekeeperVisitMock).toHaveBeenLastCalledWith(expect.objectContaining({ destinationId: "g-inner", gateStationId: "g-main", notes: "" }));

    await waitFor(() => expect(value("gate-first-name")).toBe(""));
    act(() => {
      openGateCheckIn();
      fillGateCheckIn({ ...BOB, destination: "the tank farm", note: "Trailer has a flat" });
    });
    await waitFor(() => expect(readGateVoiceDraft()).toMatchObject({ destinationName: "the tank farm", destinationNeedsReview: true }));
    expect(readGateVoiceDraft()?.destinationId).toBeUndefined();
    await act(async () => {
      await confirmGateCheckIn(gateCheckInReview(readGateVoiceDraft())!.key);
    });
    const last = submitGatekeeperVisitMock.mock.calls.at(-1)![0] as { destinationId?: string; notes: string };
    expect(last.destinationId).toBeUndefined();
    expect(last.notes).toBe("Trailer has a flat\nDestination stated: the tank farm");
  });

  it("records a check-out at an inner gate as leaving the area, not as leaving the site", async () => {
    secureSite(INNER_GATE);
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    fetchGatekeeperVisitsMock.mockResolvedValue([{ id: 88, firstName: "Taylor", lastName: "Reed", company: "Acme", siteLocationId: 42, siteName: "Acme HQ", vehiclePlate: "ABC123", plateState: "TX", expectedDurationMinutes: 60, checkInTime: "2026-08-27T12:00:00Z", checkOutTime: null }]);
    renderScreen();
    await waitFor(() => expect(readGateVoiceDraft()?.gateStationId).toBe("g-inner"));
    tap(await findFirstByTestId("gate-checkout-88"));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path, init]) => path === "/api/gate-change-over/movements" && (init as RequestInit | undefined)?.method === "POST")).toBe(true));
    const [, init] = vi.mocked(apiFetch).mock.calls.find(([path, request]) => path === "/api/gate-change-over/movements" && (request as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ siteId: 42, gateId: "g-inner", visitId: 88, kind: "leave", destination: "site_exit" });
    expect(gatekeeperCheckOutMock).not.toHaveBeenCalled();
  });

  it("tells AskV which form is showing and what is still missing", async () => {
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    renderScreen();
    await findFirstByTestId("gate-first-name");
    fireEvent.change(firstByTestId("gate-first-name"), { target: { value: "Pat" } });
    const page = readVoicePageContext("/mobile/gate");
    expect(page).toMatchObject({ path: "/gate", title: "Gate", activity: { kind: "form" } });
    expect(page!.activity!.fields.map((field) => [field.label, field.filled, field.required])).toEqual([
      ["Vehicle plate", false, true],
      ["Plate state", false, false],
      ["First name", true, true],
      ["Last name", false, true],
      ["Company", false, false],
    ]);
  });

  it("opens the native check-in on the Gate tab and keeps the website page one tap away", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <GateTab />
      </QueryClientProvider>,
    );
    await findFirstByTestId("gate-first-name");
    expect(screen.queryByTestId("gate-web-page")).toBeNull();
    tap(firstByTestId("gate-open-website"));
    expect((await screen.findByTestId("gate-web-page")).textContent).toBe("/gate");
    expect(screen.queryByTestId("gate-first-name")).toBeNull();
    tap(firstByTestId("gate-open-native"));
    await findFirstByTestId("gate-first-name");
    expect(screen.queryByTestId("gate-web-page")).toBeNull();
  });
});

describe("V on the native iPhone Gate tab", () => {
  const ACME = { id: 42, name: "Acme HQ", siteCode: "ACME-HQ", latitude: 37.7, longitude: -122.4, assignmentId: 1 };
  const gates = [{ id: "g-north", name: "North Gate" }, { id: "g-south", name: "South Gate" }];
  let session: ReturnType<typeof useAskVVoiceSession>;
  function Probe() { session = useAskVVoiceSession(); return null; }
  beforeEach(() => {
    voice.sessions = []; voice.speak.mockReset(); voice.typedSend.mockReset().mockResolvedValue(undefined);
    vi.mocked(getToken).mockResolvedValue("token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ clientSecret: "ek", model: "gpt-realtime", voice: "marin", instructions: "You are V", tools: [], toolMetadata: [] }))));
    fetchAssignedGateSitesMock.mockResolvedValue({ sites: [ACME], defaultSite: ACME });
    fetchSiteContextMock.mockResolvedValue(SITE_CTX);
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 101 });
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/gate-change-over/stations")) return { stations: gates.map(gate => ({ ...gate, latitude: null, longitude: null, geofenceRadiusM: 500 })) };
      if (path.startsWith("/api/gate-change-over/map")) return { gates: gates.map(gate => ({ ...gate, siteId: 42 })) };
      return undefined;
    });
  });
  afterEach(() => { vi.mocked(apiFetch).mockReset(); vi.unstubAllGlobals(); Object.assign(operatingContext, { gate: { siteId: 1, stationId: "gate" }, refreshing: null, strict: false }); });
  /** The operator picks North Gate in the Gate screen's site and gate selector, then turns V on. */
  async function openGateWithV({ pickGateAfterV = false, pickGate = true, shell = false } = {}) {
    const screenWithV = shell ? <GateAppShell><GateTab /></GateAppShell> : <GatekeeperScreen />;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <AskVVoiceProvider><Probe />{screenWithV}</AskVVoiceProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(readGateVoiceDraft()?.siteLocationId).toBe(42));
    const start = async () => { await act(async () => { await session.startConversation(); }); };
    if (pickGateAfterV || !pickGate) await start();
    if (pickGate) {
      tap(await findFirstByTestId("site-gate-selector"));
      tap(await screen.findByText("Acme HQ | North Gate"));
      await waitFor(() => expect(readGateVoiceDraft()?.gateStationId).toBe("g-north"));
    }
    if (pickGate && !pickGateAfterV) await start();
    expect(voice.sessions).toHaveLength(1);
  }
  const hear = (id: string, transcript: string) => act(() => {
    voice.sessions[0].emit("transport_event", { type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript });
  });
  async function approveAndExpectSavedAtNorthGate() {
    expect(voice.typedSend).not.toHaveBeenCalled();
    await waitFor(() => expect(session.checkInReview).toMatchObject({ firstName: "John", lastName: "Smith", company: "Halliburton", vehiclePlate: "ABC123", plateState: "TX", ready: true }));
    hear("yes", "Yes.");
    await waitFor(() => expect(submitGatekeeperVisitMock).toHaveBeenCalledWith(expect.objectContaining({ firstName: "John", lastName: "Smith", gateStationId: "g-north" })));
    expect(voice.typedSend).not.toHaveBeenCalled();
  }

  it("shows, reads back and saves a spoken check-in at the selected gate", async () => {
    await openGateWithV();
    hear("all", "Check in John Smith, Halliburton, Texas plate ABC123.");
    await approveAndExpectSavedAtNorthGate();
  });

  const LABELED = "First name John, last name Smith, company Halliburton, Texas plate ABC123.";
  it("uses the gate picked after V was turned on", async () => {
    await openGateWithV({ pickGateAfterV: true });
    hear("visitor", LABELED);
    await approveAndExpectSavedAtNorthGate();
  });

  it("keeps collecting at the selected gate after the operator says Hey V", async () => {
    await openGateWithV();
    hear("wake", "Hey V.");
    await waitFor(() => expect(voice.typedSend).toHaveBeenCalled());
    voice.typedSend.mockClear();
    hear("visitor", LABELED);
    await approveAndExpectSavedAtNorthGate();
  });

  it.each([
    "Hey V, first name John, last name Smith, company Halliburton, Texas plate ABC123.",
    "V, can you check in John Smith, Halliburton, Texas plate ABC123.",
    "Hey V, please check in John Smith, Halliburton, Texas plate ABC123.",
  ])("collects a check-in addressed to V: %s", async transcript => {
    await openGateWithV();
    hear("all", transcript);
    await approveAndExpectSavedAtNorthGate();
  });

  it("shows the website's readback in the iPhone app shell and saves it on yes", async () => {
    await openGateWithV({ shell: true });
    hear("visitor", "Check in John Smith, Halliburton, Texas plate ABC123.");
    expect((await screen.findByTestId("gate-askv-check-in")).textContent).toBe("Check in:John SmithHalliburtonTX ABC123Confirm?Pause");
    await approveAndExpectSavedAtNorthGate();
  });

  it("saves a spoken yes once the operating gate refresh finishes instead of refusing it", async () => {
    Object.assign(operatingContext, { strict: true, gate: { siteId: 42, stationId: "g-north" } });
    await openGateWithV();
    let refreshed!: () => void;
    operatingContext.refreshing = new Promise<void>(resolve => { refreshed = resolve; });
    hear("visitor", LABELED);
    await waitFor(() => expect(session.checkInReview?.ready).toBe(true));
    hear("yes", "Yes.");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(submitGatekeeperVisitMock).not.toHaveBeenCalled();
    await act(async () => { operatingContext.refreshing = null; refreshed(); });
    await waitFor(() => expect(submitGatekeeperVisitMock).toHaveBeenCalledWith(expect.objectContaining({ firstName: "John", gateStationId: "g-north" })));
    expect(voice.speak).not.toHaveBeenCalledWith("gateOperating.readOnly", expect.anything(), expect.anything());
  });

  it("checks in at the operator's gate on the selected site when no gate is picked", async () => {
    Object.assign(operatingContext, { strict: true, gate: { siteId: 42, stationId: "g-south" } });
    await openGateWithV({ pickGate: false });
    expect(readGateVoiceDraft()?.gateStationId).toBeUndefined();
    hear("visitor", "Check in John Smith, Halliburton, Texas plate ABC123.");
    await waitFor(() => expect(session.checkInReview?.ready).toBe(true));
    hear("yes", "Yes.");
    await waitFor(() => expect(submitGatekeeperVisitMock).toHaveBeenCalledWith(expect.objectContaining({ firstName: "John", gateStationId: "g-south" })));
  });

  it("keeps a picked gate that the loaded station list did not have yet", async () => {
    let stationReads = 0;
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/gate-change-over/stations")) return { stations: gates.slice(++stationReads === 1 ? 1 : 0).map(gate => ({ ...gate, latitude: null, longitude: null, geofenceRadiusM: 500 })) };
      if (path.startsWith("/api/gate-change-over/map")) return { gates: gates.map(gate => ({ ...gate, siteId: 42 })) };
      return undefined;
    });
    await openGateWithV();
    hear("visitor", LABELED);
    await approveAndExpectSavedAtNorthGate();
  });

  it("collects the next visitor at the selected gate after a check-out or a cancel", async () => {
    await openGateWithV();
    hear("out", "Check out.");
    hear("cancel", "Cancel.");
    await waitFor(() => expect(voice.typedSend).toHaveBeenCalled());
    voice.typedSend.mockClear();
    hear("visitor", LABELED);
    await approveAndExpectSavedAtNorthGate();
  });
});

describe("John's spoken check-in of Mary Lamb on the iPhone Gate tab", () => {
  const GUTTER = { id: 77, name: "Gutter Circle", siteCode: "GUTTER", latitude: 35.4, longitude: -97.5, assignmentId: 7 };
  const gates = [{ id: "g-east", name: "East Gate" }, { id: "g-west", name: "West Gate" }];
  let session: ReturnType<typeof useAskVVoiceSession>;
  function Probe() { session = useAskVVoiceSession(); return null; }
  beforeEach(() => {
    voice.sessions = []; voice.speak.mockReset(); voice.typedSend.mockReset().mockResolvedValue(undefined);
    vi.mocked(getToken).mockResolvedValue("token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ clientSecret: "ek", model: "gpt-realtime", voice: "marin", instructions: "You are V", tools: [], toolMetadata: [] }))));
    fetchAssignedGateSitesMock.mockResolvedValue({ sites: [GUTTER], defaultSite: GUTTER });
    fetchSiteContextMock.mockResolvedValue({ ...SITE_CTX, site: { ...SITE_CTX.site, id: 77, name: "Gutter Circle" } });
    submitGatekeeperVisitMock.mockResolvedValue({ ok: true, visitId: 202 });
    vi.mocked(apiFetch).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/gate-change-over/stations")) return { stations: gates.map(gate => ({ ...gate, latitude: null, longitude: null, geofenceRadiusM: 500 })) };
      if (path.startsWith("/api/gate-change-over/map")) return { gates: gates.map(gate => ({ ...gate, siteId: 77 })) };
      return undefined;
    });
  });
  afterEach(() => { vi.mocked(apiFetch).mockReset(); vi.unstubAllGlobals(); });
  async function openGutterCircleEastGateWithV() {
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <AskVVoiceProvider><Probe /><GateAskVStatus gatePage pagePath="/gate" /><GatekeeperScreen /></AskVVoiceProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(readGateVoiceDraft()?.siteLocationId).toBe(77));
    tap(await findFirstByTestId("site-gate-selector"));
    tap(await screen.findByText("Gutter Circle | East Gate"));
    await waitFor(() => expect(readGateVoiceDraft()?.gateStationId).toBe("g-east"));
    await act(async () => { await session.startConversation(); });
    expect(voice.sessions).toHaveLength(1);
    return view;
  }
  /** One operator turn the way the Realtime transcriber delivers it. */
  const speak = async (id: string, transcript: string) => {
    const emit = (event: Record<string, unknown>) => act(() => { voice.sessions[0].emit("transport_event", event); });
    await emit({ type: "input_audio_buffer.speech_started" });
    await emit({ type: "input_audio_buffer.speech_stopped" });
    for (const delta of transcript.match(/.{1,12}/g) ?? []) await emit({ type: "conversation.item.input_audio_transcription.delta", item_id: id, delta });
    await emit({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript });
  };
  const spoken = () => voice.speak.mock.calls.map(call => String(call[0]));

  async function expectReadBackAndSaveAtEastGate() {
    const panel = await screen.findByTestId("gate-askv-check-in", {}, { timeout: 4000 });
    expect(panel.textContent).toContain("Mary Lamb");
    expect(panel.textContent).toContain("Lambs painting");
    expect(panel.textContent).toContain("OK LY0011");
    await waitFor(() => expect(spoken()).toContain("Mary Lamb, Lambs painting, L Y zero zero one one, OK. Say yes to check in."), { timeout: 4000 });
    await speak("yes", "Yes.");
    await waitFor(() => expect(submitGatekeeperVisitMock).toHaveBeenCalledWith(expect.objectContaining({
      firstName: "Mary", lastName: "Lamb", company: "Lambs painting", vehiclePlate: "LY0011", plateState: "OK", gateStationId: "g-east",
      ctx: expect.objectContaining({ site: expect.objectContaining({ id: 77 }) }),
    })));
    await waitFor(() => expect(spoken()).toContain("Mary Lamb is checked in."));
    expect(voice.typedSend).not.toHaveBeenCalled();
    expect(session.state).toBe("listening");
  }

  it.each([
    "V check in Mary Lamb, Lambs painting, Oklahoma LY0011.",
    // How the transcriber writes the same request when V is not heard as a bare "V".
    "Okay V, check in Mary Lamb, Lambs painting, Oklahoma LY0011.",
    "Vee, check in Mary Lamb, Lambs painting, Oklahoma LY0011.",
    "V: check in Mary Lamb, Lambs painting, Oklahoma LY0011.",
    "V, can you check in Mary Lamb, Lambs painting, Oklahoma LY0011.",
    "V, let's check in Mary Lamb, Lambs painting, Oklahoma LY0011.",
  ])("shows, reads back and saves at the selected gate: %s", async transcript => {
    await openGutterCircleEastGateWithV();
    await speak("visitor", transcript);
    await expectReadBackAndSaveAtEastGate();
  });

  it("collects the same check-in spoken in separate turns", async () => {
    await openGutterCircleEastGateWithV();
    for (const [index, turn] of ["V, check in.", "Mary Lamb.", "Lambs painting.", "Oklahoma LY0011."].entries()) await speak("turn-" + index, turn);
    await expectReadBackAndSaveAtEastGate();
  });

  it("asks for the first missing field when yes is said before anything was dictated", async () => {
    await openGutterCircleEastGateWithV();
    await speak("early", "Yes.");
    await waitFor(() => expect(spoken()).toContain("First name?"));
    expect(submitGatekeeperVisitMock).not.toHaveBeenCalled();
  });
});

vi.mock("@/hooks/use-gate-operating-context", () => ({
  useGateOperatingContext: () => {
    const { gate, refreshing, strict } = operatingContext;
    const canOperate = (siteId?: number | null, stationId?: string) => !strict || (!refreshing && gate?.siteId === siteId && gate?.stationId === stationId);
    return {
      operating: gate, canOperate, myGate: () => {},
      settled: async () => {
        await operatingContext.refreshing;
        const latest = operatingContext.gate;
        return { operating: latest, canOperate: (siteId?: number | null, stationId?: string) => !strict || (latest?.siteId === siteId && latest?.stationId === stationId) };
      },
    };
  },
}));
