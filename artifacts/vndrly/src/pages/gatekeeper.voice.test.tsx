import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  list: vi.fn(),
  listAllVisits: vi.fn(),
  listAssignedGateSites: vi.fn(),
  getSiteContext: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 1, vendorId: 42 } }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ isOrgBranded: true, primary: "#159fb2" }),
}));

vi.mock("@/hooks/use-gate-live-monitor", () => ({
  useGateLiveMonitor: () => ({ flash: null, liveStatus: "live" }),
}));

vi.mock("@/lib/askv-transcribe", () => ({
  transcribeAskVRecording: (...args: unknown[]) => mocks.transcribe(...args),
}));

vi.mock("@/lib/visits-api", () => ({
  listAllVisits: (...args: unknown[]) => mocks.listAllVisits(...args),
  visitsApi: {
    list: (...args: unknown[]) => mocks.list(...args),
    listAssignedGateSites: (...args: unknown[]) => mocks.listAssignedGateSites(...args),
    getSiteContext: (...args: unknown[]) => mocks.getSiteContext(...args),
    readPlate: vi.fn(),
    gateCheckIn: vi.fn(),
    gateCheckOut: vi.fn(),
  },
}));

import GatekeeperPage from "./gatekeeper";
import { ASKV_NATURAL_VOICE_FLAG } from "@/lib/askv-natural-voice";
import { requestGateVoiceEntry } from "@/lib/gate-voice-launch";

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;

  mimeType = "audio/webm";
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
    this.onstop?.();
  });

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }
}

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((event: {
    resultIndex: number;
    results: Array<{ 0: { transcript: string }; isFinal: boolean }>;
  }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());

  constructor() {
    FakeSpeechRecognition.instances.push(this);
  }

  emit(transcript: string, resultIndex = 0) {
    const results = Array.from({ length: resultIndex + 1 }, () => ({
      0: { transcript: "already delivered" },
      isFinal: true,
    }));
    results[resultIndex] = { 0: { transcript }, isFinal: true };
    this.onresult?.({
      resultIndex,
      results,
    });
  }

  emitError(error: string) {
    this.onerror?.({ error });
  }
}

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GatekeeperPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  FakeMediaRecorder.instances = [];
  FakeSpeechRecognition.instances = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
  mocks.list.mockResolvedValue([]);
  mocks.listAllVisits.mockResolvedValue([]);
  mocks.listAssignedGateSites.mockResolvedValue({ sites: [], defaultSite: null });
  mocks.getSiteContext.mockRejectedValue(new Error("No selected test site"));
  mocks.transcribe.mockResolvedValue(
    "check in Bob Villa from NewCo plate ABC123 for equipment delivery",
  );
  window.localStorage.setItem(ASKV_NATURAL_VOICE_FLAG, "0");
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(ASKV_NATURAL_VOICE_FLAG);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GatekeeperPage voice entry", () => {
  it("suppresses a duplicate final transcript delivered by the same recognition capture", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    renderPage();
    await screen.findByTestId("input-gate-first-name");

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
    const recognition = FakeSpeechRecognition.instances[0];
    act(() => recognition.emit("check in Bob Villa plate ABC123"));
    await waitFor(() =>
      expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bob"),
    );

    fireEvent.change(screen.getByTestId("input-gate-first-name"), {
      target: { value: "Alice" },
    });
    act(() => recognition.emit("check in Bob Villa plate ABC123"));

    expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Alice");
  });

  it("allows the same valid command again in a later microphone capture", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    renderPage();
    await screen.findByTestId("input-gate-first-name");

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
    act(() => FakeSpeechRecognition.instances[0].emit("check in Bob Villa plate ABC123"));
    await waitFor(() =>
      expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bob"),
    );
    fireEvent.change(screen.getByTestId("input-gate-first-name"), {
      target: { value: "Alice" },
    });

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeSpeechRecognition.instances[0].abort).toHaveBeenCalledTimes(1));
    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(2));
    act(() => FakeSpeechRecognition.instances[1].emit("check in Bob Villa plate ABC123"));

    await waitFor(() =>
      expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bob"),
    );
  });

  it("keeps listening across distinct utterances and permits a repeated command delivery", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    renderPage();
    await screen.findByTestId("input-gate-first-name");

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
    const recognition = FakeSpeechRecognition.instances[0];
    act(() => recognition.emit("check in Bob Villa plate ABC123", 0));
    await waitFor(() =>
      expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bob"),
    );
    fireEvent.change(screen.getByTestId("input-gate-first-name"), {
      target: { value: "Alice" },
    });

    act(() => recognition.emit("check in Bob Villa plate ABC123", 1));

    await waitFor(() =>
      expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bob"),
    );
    expect(recognition.abort).not.toHaveBeenCalled();
    expect(recognition.stop).not.toHaveBeenCalled();
    const listeningStatus = screen.getByText("gatekeeper.voiceListening");
    expect(listeningStatus.getAttribute("role")).toBe("status");
    expect(listeningStatus.getAttribute("aria-live")).toBe("polite");
  });

  it("keeps listening after a recoverable recognition error", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal("SpeechRecognition", FakeSpeechRecognition);
    renderPage();
    await screen.findByTestId("input-gate-first-name");

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeSpeechRecognition.instances).toHaveLength(1));
    const recognition = FakeSpeechRecognition.instances[0];
    act(() => recognition.emitError("no-speech"));
    act(() => recognition.emit("check in Bob Villa plate ABC123", 0));

    await waitFor(() =>
      expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bob"),
    );
    expect(recognition.abort).not.toHaveBeenCalled();
    expect(recognition.stop).not.toHaveBeenCalled();
    expect(screen.getByText("gatekeeper.voiceListening")).toBeTruthy();
  });

  it("answers a duration question from the selected Gate draft without mutating it", async () => {
    const assignedSite = {
      id: 42,
      name: "Rock Island",
      address: "Grady County, Oklahoma",
      siteCode: "ROCK-ISLAND",
      latitude: 35.1,
      longitude: -97.4,
      assignmentId: 9,
      partnerId: 7,
      partnerName: "Flywheel Energy",
    };
    mocks.listAssignedGateSites.mockResolvedValue({
      sites: [assignedSite],
      defaultSite: assignedSite,
    });
    mocks.getSiteContext.mockResolvedValue({
      site: {
        id: 42,
        name: "Rock Island",
        address: "Grady County, Oklahoma",
        latitude: 35.1,
        longitude: -97.4,
        siteRadiusMeters: 100,
        siteCode: "ROCK-ISLAND",
      },
      partner: { id: 7, name: "Flywheel Energy" },
      vendors: [{ id: 11, name: "Peak Services" }],
    });
    mocks.transcribe.mockResolvedValue(
      "did you capture how long he is supposed to be on site?",
    );

    renderPage();
    const duration = await screen.findByTestId("input-gate-duration");
    await waitFor(() => expect(mocks.getSiteContext).toHaveBeenCalled());
    fireEvent.change(duration, { target: { value: "120" } });

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
    act(() => requestGateVoiceEntry());

    expect((await screen.findByTestId("gate-askv-response")).textContent).toBe(
      "gatekeeper.askvDurationCaptured",
    );
    expect((duration as HTMLInputElement).value).toBe("120");
    expect(screen.queryByTestId("gate-voice-checkin-confirmation")).toBeNull();
  });

  it("leaves the legacy parser unused when AskV natural voice is on", async () => {
    window.localStorage.setItem(ASKV_NATURAL_VOICE_FLAG, "1");
    renderPage();
    await screen.findByTestId("input-gate-first-name");
    act(() => requestGateVoiceEntry());
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("does not replay a persisted microphone request after a page refresh", async () => {
    sessionStorage.setItem("vndrly:gate-voice-pending", "1");

    renderPage();
    await screen.findByTestId("input-gate-first-name");
    await new Promise((resolve) => window.setTimeout(resolve, 100));

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("stops and releases Gate capture when the page unmounts", async () => {
    const view = renderPage();
    await screen.findByTestId("input-gate-first-name");

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
    const recorder = FakeMediaRecorder.instances[0];
    view.unmount();

    await waitFor(() => expect(recorder.stop).toHaveBeenCalledTimes(1));
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("records until the second press, transcribes, fills the draft, and asks for confirmation", async () => {
    renderPage();
    await screen.findByTestId("input-gate-first-name");

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1));
    const recorder = FakeMediaRecorder.instances[0];
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(screen.getByText("gatekeeper.voiceListening")).toBeTruthy();

    act(() => requestGateVoiceEntry());
    await waitFor(() => expect(recorder.stop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("gate-voice-checkin-confirmation")).toBeTruthy());

    expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bob");
    expect((screen.getByTestId("input-gate-last-name") as HTMLInputElement).value).toBe("Villa");
    expect((screen.getByTestId("input-gate-company") as HTMLInputElement).value).toBe("NewCo");
    expect((screen.getByTestId("input-gate-plate") as HTMLInputElement).value).toBe("ABC123");
    expect((screen.getByTestId("input-gate-purpose") as HTMLTextAreaElement).value).toBe("equipment delivery");
  });

  it("loads complete visit memory and replaces a plate-prefilled driver from a first-name prefix", async () => {
    const baseVisit = {
      phone: null,
      email: null,
      platePhotoUrl: null,
      vehiclePhotoUrl: null,
      purpose: "Delivery",
      expectedDurationMinutes: 60,
      hostType: "partner" as const,
      hostPartnerId: 7,
      hostVendorId: null,
      hostPartnerName: "Flywheel Energy",
      hostVendorName: null,
      siteLocationId: 309,
      siteName: "Flywheel Energy Spur",
      siteCode: "SITE-B40D77D2",
      checkOutTime: "2026-08-26T11:00:00Z",
      autoCheckedOut: false,
      plateState: "TX",
      checkInLatitude: 34.64,
      checkInLongitude: -97.66,
    };
    mocks.listAllVisits.mockResolvedValue([
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
    ]);

    renderPage();
    const plate = await screen.findByTestId("input-gate-plate");
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "plateStatePicker.select" }),
    );
    await user.click(screen.getByRole("option", { name: "Texas (TX)" }));
    fireEvent.change(plate, { target: { value: "51D-4A1" } });

    await waitFor(() => {
      expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bob");
      expect((screen.getByTestId("input-gate-last-name") as HTMLInputElement).value).toBe("Villa");
      expect((screen.getByTestId("input-gate-company") as HTMLInputElement).value).toBe("Peak Energy");
    });

    fireEvent.change(screen.getByTestId("input-gate-first-name"), { target: { value: "Bon" } });
    fireEvent.click(await screen.findByText("Bonnie West"));

    expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Bonnie");
    expect((screen.getByTestId("input-gate-last-name") as HTMLInputElement).value).toBe("West");
    expect((screen.getByTestId("input-gate-company") as HTMLInputElement).value).toBe("Peak Energy");
    expect((screen.getByTestId("input-gate-plate") as HTMLInputElement).value).toBe("51D4A1");
  });

  it("opens distinct driver choices after selecting an exact known company", async () => {
    const baseVisit = {
      phone: null,
      email: null,
      platePhotoUrl: null,
      vehiclePhotoUrl: null,
      purpose: "Delivery",
      notes: null,
      checkOutNotes: null,
      admissionStatus: "admitted" as const,
      expectedDurationMinutes: 60,
      hostType: "partner" as const,
      hostPartnerId: 7,
      hostVendorId: null,
      hostPartnerName: "Flywheel Energy",
      hostVendorName: null,
      siteLocationId: 309,
      siteName: "Flywheel Energy Spur",
      siteCode: "SITE-B40D77D2",
      checkOutTime: "2026-08-26T11:00:00Z",
      autoCheckedOut: false,
      plateState: "TX",
      checkInLatitude: 34.64,
      checkInLongitude: -97.66,
    };
    mocks.listAllVisits.mockResolvedValue([
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
    ]);

    renderPage();
    const companyInput = await screen.findByTestId("input-gate-company");
    fireEvent.change(companyInput, { target: { value: "Peak" } });
    await waitFor(() => expect((companyInput as HTMLInputElement).value).toBe("Peak Energy"));
    fireEvent.focus(screen.getByTestId("input-gate-first-name"));

    expect(await screen.findByText("Bob Villa")).toBeTruthy();
    expect(screen.getByText("Bonnie West")).toBeTruthy();
  });
});
