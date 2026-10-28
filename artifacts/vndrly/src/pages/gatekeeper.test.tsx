import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASKV_NATURAL_VOICE_FLAG } from "@/lib/askv-natural-voice";

const api = vi.hoisted(() => ({
  gateCheckIn: vi.fn(),
  gateCheckOut: vi.fn(),
  getSiteContext: vi.fn(),
  list: vi.fn(),
  listAllVisits: vi.fn(),
  listAssignedGateSites: vi.fn(),
  listPreferredPlateStates: vi.fn(),
  readPlate: vi.fn(),
  gateAdmit: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/lib/gate-arrivals-api", () => ({ gateArrivalsApi: {
  list: vi.fn(async () => ({ arrivals: [], truncated: false, generatedAt: "now" })),
  visitLinks: vi.fn(async () => ({ runs: [] })),
} }));
const liveMonitor = vi.hoisted(() => ({
  flash: null as Record<string, unknown> | null,
}));
const locale = vi.hoisted(() => ({ spanish: false }));

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
        "gatekeeper.plateStateSuggested": "Suggested state: {{state}}",
        "gatekeeper.plateStateCorrected": "State corrected: {{state}}",
        "gatekeeper.selectCompany": locale.spanish ? "Seleccionar empresa" : "Select company",
        "gatekeeper.selectSite": locale.spanish ? "Seleccione el sitio asignado" : "Select assigned site",
        "changeOver.site": locale.spanish ? "Sitio" : "Site",
        "changeOver.gate": locale.spanish ? "Acceso" : "Gate",
      };
      const template = strings[key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(options?.[name] ?? ""),
      );
    },
  }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { role: "vendor", vendorRole: "gatekeeper", vendorId: 1054 },
  }),
}));

vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ isOrgBranded: false, primary: "#f59e0b" }),
}));

vi.mock("@/hooks/use-gate-live-monitor", () => ({
  useGateLiveMonitor: () => ({ flash: liveMonitor.flash, liveStatus: "live" }),
}));

vi.mock("@/components/live-connection-pill", () => ({
  LiveConnectionPill: () =>
    React.createElement("span", { "data-testid": "live-pill" }),
}));

vi.mock("@/lib/gatekeeper-log-export", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/gatekeeper-log-export")>();
  return {
    ...actual,
    exportExcel: vi.fn(),
    exportPdf: vi.fn(),
    exportWord: vi.fn(),
    toGateLogRows: () => [],
  };
});

vi.mock("@/lib/visits-api", () => ({
  listAllVisits: (...args: unknown[]) => api.listAllVisits(...args),
  visitsApi: api,
}));

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});
const resize = { update: () => {} };
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(update: () => void) { resize.update = update; }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: query.includes("max-width") && window.innerWidth < 768,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
}));

import GatekeeperPage from "./gatekeeper";

const ASSIGNED_SITE = {
  id: 42,
  name: "Acme HQ",
  address: "123 Main St",
  siteCode: "ACME-HQ",
  latitude: 37.7,
  longitude: -122.4,
  assignmentId: 9,
};

const SITE_CONTEXT = {
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

let geolocationMock: ReturnType<typeof vi.fn>;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GatekeeperPage />
    </QueryClientProvider>,
  );
}

function recentVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    firstName: "Oklahoma",
    lastName: "Visitor",
    company: "Sooner Services",
    phone: null,
    email: null,
    vehiclePlate: "4412",
    plateState: "OK",
    platePhotoUrl: null,
    vehiclePhotoUrl: null,
    purpose: "Delivery",
    expectedDurationMinutes: 30,
    hostType: "partner",
    hostPartnerId: 7,
    hostVendorId: null,
    hostPartnerName: "Acme Partner",
    hostVendorName: null,
    siteLocationId: 42,
    siteName: "Acme HQ",
    checkInTime: "2026-08-23T10:00:00Z",
    checkOutTime: "2026-08-23T10:30:00Z",
    autoCheckedOut: false,
    checkInLatitude: 35.4,
    checkInLongitude: -97.5,
    ...overrides,
  };
}

async function selectState(name: string) {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", {
    name: /^(Select plate state|Selected plate state:)/,
  });
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem(ASKV_NATURAL_VOICE_FLAG, "0");
  liveMonitor.flash = null;
  locale.spanish = false;
  api.list.mockResolvedValue([]);
  api.get.mockImplementation(async (id: number) => recentVisit({ id, checkOutTime: null }));
  api.listAllVisits.mockResolvedValue([]);
  api.listAssignedGateSites.mockResolvedValue({
    sites: [ASSIGNED_SITE],
    defaultSite: ASSIGNED_SITE,
  });
  api.getSiteContext.mockResolvedValue(SITE_CONTEXT);
  api.listPreferredPlateStates.mockResolvedValue({
    preferred: ["CA", "TX", "NY", "FL", "OH"],
  });
  api.readPlate.mockResolvedValue({
    plate: null,
    state: null,
    plateConfidence: null,
    stateConfidence: null,
  });
  api.gateCheckIn.mockResolvedValue({ id: 88 });
  geolocationMock = vi.fn(
    (
      success: (position: {
        coords: { latitude: number; longitude: number };
      }) => void,
    ) => {
      success({ coords: { latitude: 37.7, longitude: -122.4 } });
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: geolocationMock,
      watchPosition: (
        success: (position: {
          coords: { latitude: number; longitude: number };
        }) => void,
      ) => {
        success({ coords: { latitude: 37.7, longitude: -122.4 } });
        return 1;
      },
      clearWatch: vi.fn(),
    },
  });
});

describe("GatekeeperPage plate state", () => {
  it("defaults to On Site and marks only visits beyond their estimated duration as overdue", async () => {
    api.list.mockResolvedValue([
      recentVisit({ id: 1, firstName: "Overdue", checkOutTime: null, checkInTime: new Date(Date.now() - 61 * 60_000).toISOString(), expectedDurationMinutes: 60 }),
      recentVisit({ id: 2, firstName: "Within", checkOutTime: null, checkInTime: new Date(Date.now() - 10 * 60_000).toISOString(), expectedDurationMinutes: 60 }),
      recentVisit({ id: 3, firstName: "Unestimated", checkOutTime: null, checkInTime: new Date(Date.now() - 120 * 60_000).toISOString(), expectedDurationMinutes: null }),
    ]);
    renderPage();
    const list = await screen.findByTestId("gate-on-site-entries");
    expect(screen.getByRole("button", { name: "gatekeeper.onSiteTab" }).getAttribute("aria-pressed")).toBe("true");
    expect((await within(list).findByRole("button", { name: /^Overdue/ })).parentElement?.dataset.overdue).toBe("true");
    expect(within(list).getByRole("button", { name: /^Within/ }).parentElement?.dataset.overdue).toBe("false");
    expect(within(list).getByRole("button", { name: /^Unestimated/ }).parentElement?.dataset.overdue).toBe("false");
  });

  it("opens an on-site record without checking it out", async () => {
    api.list.mockResolvedValue([recentVisit({ id: 28, checkOutTime: null, admissionStatus: "admitted" })]);
    renderPage();
    const card = await screen.findByTestId("gate-on-site-card");
    fireEvent.click(await within(card).findByRole("button", { name: /Oklahoma Visitor/ }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(28));
    expect(api.gateCheckOut).not.toHaveBeenCalled();
    expect(api.gateCheckIn).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("shows departures newest first with check-in, check-out and dwell time", async () => {
    api.listAllVisits.mockResolvedValue([
      recentVisit({ id: 1, firstName: "Earlier", checkInTime: "2026-10-22T10:00:00Z", checkOutTime: "2026-10-22T10:30:00Z" }),
      recentVisit({ id: 2, firstName: "Latest", checkInTime: "2026-10-22T11:00:00Z", checkOutTime: "2026-10-22T12:00:00Z" }),
    ]);
    renderPage();
    await screen.findByTestId("button-gate-full-history");
    fireEvent.click(screen.getByRole("button", { name: "gatekeeper.departuresTab" }));
    const records = await screen.findAllByTestId("gate-recent-departure");
    expect(records[0].textContent).toContain("Latest");
    expect(records[0].textContent).toContain("gatekeeper.historyCheckedIn");
    expect(records[0].textContent).toContain("gatekeeper.historyCheckedOut");
    expect(records[0].textContent).toContain("Time On Site: 01:00");
    expect(records[0].parentElement?.querySelector("a")?.getAttribute("href")).toContain("recordId=visit%3A2");
    expect(records[1].textContent).toContain("Earlier");
  });

  it("submits a gate entry when GPS is unavailable", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    renderPage();
    await screen.findByTestId("input-gate-plate");
    fireEvent.change(screen.getByTestId("input-gate-first-name"), { target: { value: "Jordan" } });
    fireEvent.change(screen.getByTestId("input-gate-last-name"), { target: { value: "Hale" } });
    fireEvent.change(screen.getByTestId("input-gate-plate"), { target: { value: "4412" } });
    const button = screen.getByTestId("button-gate-check-in") as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(api.gateCheckIn).toHaveBeenCalledTimes(1));
    expect(api.gateCheckIn.mock.calls[0][0].latitude).toBeUndefined();
    expect(api.gateCheckIn.mock.calls[0][0].longitude).toBeUndefined();
  });
  it("locks the GPS-determined company and localizes the current-location selector", async () => {
    locale.spanish = true;
    renderPage();
    expect(screen.queryByTestId("gate-locked-partner")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Seleccionar empresa" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sitio | Acceso" })).toBeTruthy();
  });
  it("associates Gate entry labels and required state with every field", async () => {
    renderPage();
    const plate = await screen.findByRole("combobox", { name: /gatekeeper\.vehiclePlate/ });
    expect(plate.getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("combobox", { name: /gatekeeper\.firstName/ }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("combobox", { name: /gatekeeper\.lastName/ }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("combobox", { name: "gatekeeper.company" })).toBeTruthy();
    expect(screen.queryByTestId("gate-locked-partner")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /gatekeeper\.host/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "gatekeeper.purpose" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "gatekeeper.notes" })).toBeTruthy();
  });
  it("renders state-qualified plates from both the live event and active gate rows", async () => {
    api.list.mockResolvedValue([
      recentVisit({
        id: 87,
        vehiclePlate: "4412",
        plateState: "OK",
        checkOutTime: null,
      }),
    ]);
    liveMonitor.flash = {
      kind: "checked_in",
      visitId: 88,
      firstName: "Taylor",
      lastName: "Reed",
      company: "Acme",
      vehiclePlate: "ABC123",
      plateState: "TX",
      platePhotoUrl: null,
      siteName: "Acme HQ",
      at: "2026-08-27T12:00:00Z",
    };

    const view = renderPage();

    expect(
      (await screen.findByTestId("gate-live-flash")).textContent,
    ).toContain("TX • ABC123");
    await waitFor(() =>
      expect(view.container.textContent).toContain("OK • 4412"),
    );
  });

  it("waits for the authorized site id and renders its preferred states immediately before the plate input", async () => {
    let resolveSite!: (value: typeof SITE_CONTEXT) => void;
    api.getSiteContext.mockReturnValue(
      new Promise((resolve) => {
        resolveSite = resolve;
      }),
    );
    api.listPreferredPlateStates.mockResolvedValue({ preferred: ["OK", "TX"] });

    renderPage();
    await waitFor(() =>
      expect(api.getSiteContext).toHaveBeenCalledWith("ACME-HQ"),
    );
    expect(api.listPreferredPlateStates).not.toHaveBeenCalled();

    resolveSite(SITE_CONTEXT);
    await waitFor(() =>
      expect(api.listPreferredPlateStates).toHaveBeenCalledWith(42, "ACME-HQ"),
    );
    const trigger = screen.getByRole("button", { name: "Select plate state" });
    const plateInput = screen.getByTestId("input-gate-plate");
    expect(
      plateInput.compareDocumentPosition(trigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.setup().click(trigger);
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .slice(0, 3)
        .map((option) => option.textContent),
    ).toEqual(["Oklahoma (OK)", "Texas (TX)", "Alabama (AL)"]);
  });

  it("uses the national state fallback when site preferences fail", async () => {
    api.listPreferredPlateStates.mockRejectedValue(new Error("unavailable"));
    renderPage();

    await waitFor(() =>
      expect(api.listPreferredPlateStates).toHaveBeenCalledWith(42, "ACME-HQ"),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Select plate state" }));
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .slice(0, 3)
        .map((option) => option.textContent),
    ).toEqual(["California (CA)", "Texas (TX)", "New York (NY)"]);
  });

  it("allows a plate-only check-in when state is unknown and GPS is inside the fence", async () => {
    renderPage();
    await screen.findByTestId("input-gate-plate");
    fireEvent.change(screen.getByTestId("input-gate-first-name"), {
      target: { value: "Jordan" },
    });
    fireEvent.change(screen.getByTestId("input-gate-last-name"), {
      target: { value: "Hale" },
    });
    fireEvent.change(screen.getByTestId("input-gate-plate"), {
      target: { value: "4412" },
    });
    fireEvent.change(document.getElementById("gate-entry-category")!, {
      target: { value: "vendor_admin" },
    });
    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            name: "gatekeeper.checkInVisitor",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "gatekeeper.checkInVisitor" }),
    );

    await waitFor(() => expect(api.gateCheckIn).toHaveBeenCalledTimes(1));
    expect(api.gateCheckIn.mock.calls[0][0]).toMatchObject({
      vehiclePlate: "4412",
      entryCategory: "vendor_admin",
    });
    expect(api.gateCheckIn.mock.calls[0][0].plateState).toBeUndefined();
  });

  it("uses the OCR confidence threshold, preserves manual correction, sends state, and resets it", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("request-url")) {
          return {
            ok: true,
            json: async () => ({
              uploadURL: "/upload",
              objectPath: "/objects/plate.jpg",
            }),
          };
        }
        if (url.includes("finalize") || init?.method === "PUT")
          return { ok: true };
        return { ok: true };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    api.readPlate
      .mockResolvedValueOnce({
        plate: "4412",
        state: "TX",
        plateConfidence: 0.97,
        stateConfidence: 0.79,
      })
      .mockResolvedValueOnce({
        plate: "4412",
        state: "tx",
        plateConfidence: 0.97,
        stateConfidence: 0.8,
      });
    const { container } = renderPage();
    await screen.findByTestId("input-gate-plate");

    fireEvent.change(screen.getByTestId("input-gate-plate"), {
      target: { value: "4412" },
    });
    await selectState("Oklahoma (OK)");
    const plateInput = container.querySelector<HTMLInputElement>(
      'input[type="file"][capture="environment"]',
    )!;
    const file = new File(["plate"], "plate.jpg", { type: "image/jpeg" });
    fireEvent.change(plateInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Selected plate state: Oklahoma (OK)",
        }),
      ).toBeTruthy();
      expect(
        (screen.getByTestId("input-gate-plate") as HTMLInputElement).value,
      ).toBe("4412");
    });

    fireEvent.change(plateInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Selected plate state: Texas (TX)",
        }),
      ).toBeTruthy();
      expect(screen.getByText("Suggested state: TX")).toBeTruthy();
    });
    await selectState("Oklahoma (OK)");
    expect(screen.getByText("State corrected: OK")).toBeTruthy();
    fireEvent.change(screen.getByTestId("input-gate-first-name"), {
      target: { value: "Jordan" },
    });
    fireEvent.change(screen.getByTestId("input-gate-last-name"), {
      target: { value: "Hale" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "gatekeeper.checkInVisitor" }),
    );

    await waitFor(() => expect(api.gateCheckIn).toHaveBeenCalledTimes(1));
    expect(api.gateCheckIn.mock.calls[0][0]).toMatchObject({
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

  it("clears stale state across sequential voice plates and replaces both when voice supplies state", async () => {
    const recognitions: Array<{
      onresult: ((event: any) => void) | null;
      onend: (() => void) | null;
    }> = [];
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((event: any) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      start = vi.fn(() => this.onstart?.());
      stop = vi.fn(() => this.onend?.());

      constructor() {
        recognitions.push(this);
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    const speak = async (transcript: string) => {
      if (!recognitions.at(-1)?.onresult) {
        window.dispatchEvent(new Event("vndrly:gate-voice"));
      }
      await waitFor(() => expect(recognitions.at(-1)?.onresult).toBeTypeOf("function"));
      const recognition = recognitions.at(-1)!;
      recognition.onresult?.({
        results: { 0: { 0: { transcript } }, length: 1 },
      });
      recognition.onend?.();
    };

    try {
      renderPage();
      await screen.findByTestId("input-gate-plate");

      await speak("state OK plate OLD 123 driver Jane Doe");
      await waitFor(() => {
        expect(
          (screen.getByTestId("input-gate-plate") as HTMLInputElement).value,
        ).toBe("OLD123");
        expect(
          screen.getByRole("button", {
            name: "Selected plate state: Oklahoma (OK)",
          }),
        ).toBeTruthy();
      });

      // Model a slower render/assertion cycle where continuous recognition has
      // already restarted. Feeding the live recognizer must not toggle it off.
      await waitFor(() => expect(recognitions.at(-1)?.onresult).toBeTypeOf("function"));
      await speak("plate NEW 456 driver Jane Doe");
      await waitFor(() => {
        expect(
          (screen.getByTestId("input-gate-plate") as HTMLInputElement).value,
        ).toBe("NEW456");
        expect(
          screen.getByRole("button", { name: "Select plate state" }),
        ).toBeTruthy();
      });
      fireEvent.click(
        screen.getByRole("button", { name: "gatekeeper.checkInVisitor" }),
      );
      await waitFor(() => expect(api.gateCheckIn).toHaveBeenCalled());

      await speak("state TX plate FINAL 9 driver Jane Doe");
      await waitFor(() => {
        expect(
          (screen.getByTestId("input-gate-plate") as HTMLInputElement).value,
        ).toBe("FINAL9");
        expect(
          screen.getByRole("button", {
            name: "Selected plate state: Texas (TX)",
          }),
        ).toBeTruthy();
      });
    } finally {
      delete (window as typeof window & { SpeechRecognition?: unknown })
        .SpeechRecognition;
    }
  });

  it("replaces prior composite auto-fill after switching to a state with a different exact match and preserves manual edits", async () => {
    api.listAllVisits.mockResolvedValue([
      recentVisit(),
      recentVisit({
        id: 2,
        firstName: "Texas",
        lastName: "Driver",
        company: "Lone Star Services",
        plateState: "TX",
        purpose: "Inspection",
        expectedDurationMinutes: 45,
        checkInTime: "2026-08-22T10:00:00Z",
      }),
    ]);
    renderPage();
    await screen.findByTestId("input-gate-plate");

    await selectState("Oklahoma (OK)");
    fireEvent.change(screen.getByTestId("input-gate-plate"), {
      target: { value: "4412" },
    });
    await waitFor(() => {
      expect(
        (screen.getByTestId("input-gate-first-name") as HTMLInputElement).value,
      ).toBe("Oklahoma");
      expect(
        (screen.getByTestId("input-gate-company") as HTMLInputElement).value,
      ).toBe("Sooner Services");
    });

    fireEvent.change(screen.getByTestId("input-gate-company"), {
      target: { value: "Manual Company" },
    });
    fireEvent.change(screen.getByTestId("input-gate-plate"), {
      target: { value: "4412" },
    });
    await selectState("Texas (TX)");

    await waitFor(() => {
      expect(
        (screen.getByTestId("input-gate-first-name") as HTMLInputElement).value,
      ).toBe("Texas");
      expect(
        (screen.getByTestId("input-gate-last-name") as HTMLInputElement).value,
      ).toBe("Driver");
      expect(
        (screen.getByTestId("input-gate-company") as HTMLInputElement).value,
      ).toBe("Manual Company");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "gatekeeper.checkInVisitor" }),
    );
    await waitFor(() => expect(api.gateCheckIn).toHaveBeenCalledTimes(1));
    expect(api.gateCheckIn.mock.calls[0][0]).toMatchObject({
      firstName: "Texas",
      lastName: "Driver",
      company: "Manual Company",
      plateState: "TX",
      vehiclePlate: "4412",
    });
  });

  it("clears prior composite auto-fill after switching to a state with no match and preserves manual edits", async () => {
    api.listAllVisits.mockResolvedValue([recentVisit()]);
    renderPage();
    await screen.findByTestId("input-gate-plate");

    await selectState("Oklahoma (OK)");
    fireEvent.change(screen.getByTestId("input-gate-plate"), {
      target: { value: "4412" },
    });
    await waitFor(() => {
      expect(
        (screen.getByTestId("input-gate-last-name") as HTMLInputElement).value,
      ).toBe("Visitor");
    });

    fireEvent.change(screen.getByTestId("input-gate-first-name"), {
      target: { value: "Manual" },
    });
    fireEvent.change(screen.getByTestId("input-gate-plate"), {
      target: { value: "4412" },
    });
    await selectState("Texas (TX)");

    await waitFor(() => {
      expect(
        (screen.getByTestId("input-gate-first-name") as HTMLInputElement).value,
      ).toBe("Manual");
      expect(
        (screen.getByTestId("input-gate-last-name") as HTMLInputElement).value,
      ).toBe("");
      expect(
        (screen.getByTestId("input-gate-company") as HTMLInputElement).value,
      ).toBe("");
    });
  });

  it("does not show or prefill previous-visit details before a plate state is selected", async () => {
    api.list.mockResolvedValue([recentVisit()]);
    renderPage();
    await screen.findByTestId("input-gate-plate");

    fireEvent.change(screen.getByTestId("input-gate-plate"), {
      target: { value: "4412" },
    });

    await waitFor(() => {
      expect(
        (screen.getByTestId("input-gate-first-name") as HTMLInputElement).value,
      ).toBe("");
      expect(screen.queryByText("gatekeeper.previousVisit")).toBeNull();
      expect(screen.queryByTestId("gate-last-driver-hint")).toBeNull();
    });
  });

  it("uses the selected state for same-number previous-visit behavior", async () => {
    api.listAllVisits.mockResolvedValue([
      recentVisit(),
      recentVisit({
        id: 2,
        firstName: "Texas",
        lastName: "Driver",
        company: "Lone Star Services",
        plateState: "TX",
        checkInTime: "2026-08-20T10:00:00Z",
      }),
    ]);
    renderPage();
    await screen.findByTestId("input-gate-plate");

    await selectState("Texas (TX)");
    fireEvent.change(screen.getByTestId("input-gate-plate"), {
      target: { value: "4412" },
    });

    await waitFor(() => {
      expect(
        (screen.getByTestId("input-gate-first-name") as HTMLInputElement).value,
      ).toBe("Texas");
      expect(
        (screen.getByTestId("input-gate-last-name") as HTMLInputElement).value,
      ).toBe("Driver");
      expect(screen.getByTestId("gate-last-driver-hint")).toBeTruthy();
    });
  });
});

describe("GatekeeperPage compact branded workspace", () => {
  it("shows the standard back control and a shadow-free branded Gate icon", () => {
    renderPage();
    expect(screen.getByTestId("button-back").getAttribute("href")).toBe("/gate/change-over");
    const icon = screen.getByTestId("gate-header-icon");
    expect(icon.getAttribute("class")).toContain("text-[var(--brand-primary)]");
    expect(icon.getAttribute("class")).not.toContain("card-icon-drop-shadow");
    expect(screen.queryByTestId("gate-watch-header")).toBeNull();
  });
  it("uses the top selectors and a GPS gauge without a selected-location card", async () => {
    renderPage();
    expect(await screen.findByTestId("select-gate-current-location")).toBeTruthy();
    expect(screen.getByTestId("gate-gps-indicator")).toBeTruthy();
    expect(screen.queryByTestId("gate-selected-location")).toBeNull();
    expect(screen.queryByText("123 Main St")).toBeNull();
  });

  it("uses successful plate and state OCR to fill the newest exact authorized history match", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("request-url")) return {
        ok: true,
        json: async () => ({ uploadURL: "/upload", objectPath: "/objects/plate.jpg" }),
      };
      if (url.includes("finalize") || init?.method === "PUT") return { ok: true };
      return { ok: true };
    }));
    api.listAllVisits.mockResolvedValue([
      recentVisit({ checkInTime: "2026-08-20T10:00:00Z" }),
      recentVisit({
        id: 2,
        firstName: "Latest",
        lastName: "Driver",
        company: "Current Hauling",
        purpose: "Fresh delivery",
        expectedDurationMinutes: 120,
        checkInTime: "2026-08-25T10:00:00Z",
      }),
    ]);
    api.readPlate.mockResolvedValue({
      plate: "44-12",
      state: "OK",
      plateConfidence: 0.98,
      stateConfidence: 0.95,
    });
    const { container } = renderPage();
    await screen.findByTestId("input-gate-plate");
    const plateInput = container.querySelector<HTMLInputElement>('input[type="file"][capture="environment"]')!;
    fireEvent.change(plateInput, {
      target: { files: [new File(["plate"], "plate.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("Latest");
      expect((screen.getByTestId("input-gate-last-name") as HTMLInputElement).value).toBe("Driver");
      expect((screen.getByTestId("input-gate-company") as HTMLInputElement).value).toBe("Current Hauling");
      expect((screen.getByTestId("input-gate-purpose") as HTMLTextAreaElement).value).toBe("Fresh delivery");
      expect((screen.getByTestId("input-gate-duration") as HTMLInputElement).value).toBe("240");
    });

    fireEvent.change(screen.getByTestId("input-gate-company"), { target: { value: "Manual Company" } });
    await waitFor(() => expect((screen.getByTestId("input-gate-company") as HTMLInputElement).value).toBe("Manual Company"));
    expect(api.listAllVisits).toHaveBeenCalledWith();
  });

  it("does not guess identity from low-confidence or state-free OCR", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("request-url")) return {
        ok: true,
        json: async () => ({ uploadURL: "/upload", objectPath: "/objects/plate.jpg" }),
      };
      if (url.includes("finalize") || init?.method === "PUT") return { ok: true };
      return { ok: true };
    }));
    api.listAllVisits.mockResolvedValue([recentVisit()]);
    api.readPlate.mockResolvedValue({
      plate: "4412",
      state: "OK",
      plateConfidence: 0.98,
      stateConfidence: 0.79,
    });
    const { container } = renderPage();
    await screen.findByTestId("input-gate-plate");
    const plateInput = container.querySelector<HTMLInputElement>('input[type="file"][capture="environment"]')!;
    fireEvent.change(plateInput, {
      target: { files: [new File(["plate"], "plate.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect((screen.getByTestId("input-gate-plate") as HTMLInputElement).value).toBe("4412"));
    expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-gate-company") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Select plate state" })).toBeTruthy();
  });

  it("does not restore identity when plate confidence is low even if state confidence is high", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("request-url")) return {
        ok: true,
        json: async () => ({ uploadURL: "/upload", objectPath: "/objects/plate.jpg" }),
      };
      if (url.includes("finalize") || init?.method === "PUT") return { ok: true };
      return { ok: true };
    }));
    api.listAllVisits.mockResolvedValue([recentVisit()]);
    api.readPlate.mockResolvedValue({
      plate: "4412",
      state: "OK",
      plateConfidence: 0.79,
      stateConfidence: 0.95,
    });
    const { container } = renderPage();
    await screen.findByTestId("input-gate-plate");
    const plateInput = container.querySelector<HTMLInputElement>('input[type="file"][capture="environment"]')!;
    fireEvent.change(plateInput, {
      target: { files: [new File(["plate"], "plate.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect((screen.getByTestId("input-gate-plate") as HTMLInputElement).value).toBe("4412"));
    expect((screen.getByTestId("input-gate-first-name") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("input-gate-company") as HTMLInputElement).value).toBe("");
  });

  it("gives on-site entries the scrollable card area without checkout notes", async () => {
    renderPage();

    const card = await screen.findByTestId("gate-on-site-card");
    expect(card.getAttribute("data-brand-outline")).toBe("true");
    expect(card.style.height).toBe("560px");

    const entries = within(card).getByTestId("gate-on-site-entries");
    expect(entries.className).toContain("flex-1");
    expect(entries.className).toContain("overflow-y-auto");
    expect(within(card).queryByTestId("gate-checkout-notes-region")).toBeNull();
  });

  it("uses mini-card buttons for Gate actions and keeps history anchored in the on-site card", async () => {
    renderPage();
    const card = await screen.findByTestId("gate-on-site-card");

    const history = await within(card).findByTestId("button-gate-full-history");
    expect(history.getAttribute("href")).toBe("/gate/history?siteLocationId=42");
    expect(history.querySelector("img")).toBeNull();
    expect(history.querySelector("svg")).toBeTruthy();
    expect(history.className).toContain("gate-log-text-link");

    const refresh = screen.getByTestId("button-gate-refresh");
    expect(refresh.querySelector("img")).toBeNull();
    expect(refresh.querySelector("svg")).toBeTruthy();
    const actionIds = [
      "button-gate-read-plate",
      "button-gate-vehicle-photo",
      "button-gate-check-in",
    ];
    for (const id of actionIds) {
      expect(screen.getByTestId(id).querySelector("img")).toBeNull();
      expect(screen.getByTestId(id).className).toContain("gate-history-filter");
    }
    expect(screen.getByTestId("gate-new-entry-card").getAttribute("data-brand-outline")).toBe("true");
  });

  it("uses the compact branded form-control standard for a new gate entry", async () => {
    renderPage();

    for (const id of [
      "input-gate-plate",
      "input-gate-first-name",
      "input-gate-last-name",
      "input-gate-company",
      "input-gate-duration",
    ]) {
      const control = await screen.findByTestId(id);
      expect(control.className).toContain("h-9");
      expect(control.className).toContain("rounded-full");
      expect(control.className).toContain("border-2");
      expect(control.className).toContain("border-[color:var(--brand-primary)]");
      expect(control.className).toContain("bg-white");
    }

    for (const id of ["select-gate-current-location"]) {
      const control = await screen.findByTestId(id);
      expect(control.className).toContain("h-9");
      expect(control.className).toContain("rounded-full");
      expect(control.className).toContain("border-2");
      expect(control.className).toContain("text-sm");
      expect(control.className).not.toContain("h-14");
      expect(control.className).not.toContain("text-lg");
    }

    expect(screen.queryByTestId("gate-locked-partner")).toBeNull();

    for (const id of ["input-gate-purpose", "input-gate-notes"]) {
      const control = await screen.findByTestId(id);
      expect(control.className).toContain("rounded-xl");
      expect(control.className).toContain("border-2");
      expect(control.className).toContain("border-[color:var(--brand-primary)]");
      expect(control.className).toContain("bg-white");
      expect(control.className).not.toContain("rounded-full");
    }

    expect(screen.getByTestId("input-gate-duration").tagName).toBe("SELECT");
  });

  it("does not offer selected-gate history until the selected site context resolves", async () => {
    let resolveSite!: (site: typeof SITE_CONTEXT) => void;
    api.getSiteContext.mockReturnValue(new Promise((resolve) => {
      resolveSite = resolve;
    }));

    renderPage();
    const card = await screen.findByTestId("gate-on-site-card");
    expect(within(card).queryByTestId("button-gate-full-history")).toBeNull();

    resolveSite(SITE_CONTEXT);
    expect(
      (await within(card).findByTestId("button-gate-full-history")).getAttribute("href"),
    ).toBe("/gate/history?siteLocationId=42");
  });

  it("keeps traffic the same height as the entry form when it resizes", async () => {
    renderPage();
    const entry = await screen.findByTestId("gate-new-entry-card");
    const traffic = screen.getByTestId("gate-on-site-card");
    vi.spyOn(entry, "getBoundingClientRect").mockReturnValue({ height: 920 } as DOMRect);
    act(() => resize.update());
    expect(traffic.style.height).toBe("920px");
    vi.spyOn(entry, "getBoundingClientRect").mockReturnValue({ height: 1150 } as DOMRect);
    act(() => resize.update());
    expect(traffic.style.height).toBe("1150px");
    expect(entry.compareDocumentPosition(traffic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("caps on-site traffic at 100 and moves pending admissions to Arrivals", async () => {
    api.list.mockResolvedValue([
      ...Array.from({ length: 5 }, (_, i) => recentVisit({ id: i + 1, checkOutTime: null, admissionStatus: "pending" })),
      ...Array.from({ length: 105 }, (_, i) => recentVisit({ id: i + 10, checkOutTime: null, admissionStatus: "admitted" })),
      recentVisit({ id: 999, checkOutTime: null, siteLocationId: 999 }),
    ]);
    renderPage();
    const list = await screen.findByTestId("gate-on-site-entries");
    await waitFor(() => expect(within(list).getAllByRole("button", { name: /Oklahoma Visitor/ })).toHaveLength(100));
    expect(within(list).queryByTestId("gate-pending-visitors")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "gatekeeper.arrivalsTab" }));
    expect(within(screen.getByTestId("gate-arrivals")).getAllByTestId(/^button-gate-admit-/)).toHaveLength(5);
    expect((await screen.findByTestId("button-gate-full-history")).getAttribute("href")).toBe("/gate/history?siteLocationId=42");
    expect(list.contains(screen.getByTestId("button-gate-full-history"))).toBe(false);
  });

  it("limits departures to the 100 latest at the selected site", async () => {
    api.listAllVisits.mockResolvedValue(Array.from({ length: 105 }, (_, i) => recentVisit({ id: i + 1, checkOutTime: new Date(Date.UTC(2026, 9, 22, 10, i)).toISOString() })));
    renderPage();
    await screen.findByTestId("button-gate-full-history");
    fireEvent.click(screen.getByRole("button", { name: "gatekeeper.departuresTab" }));
    await waitFor(() => expect(screen.getAllByTestId("gate-recent-departure")).toHaveLength(100));
    fireEvent.click(screen.getAllByTestId("gate-recent-departure")[0]);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(105));
  });

  it("names the independently scrollable Gate regions and associates their form labels", async () => {
    renderPage();
    const card = await screen.findByTestId("gate-on-site-card");
    expect(within(card).getByRole("region", { name: "gatekeeper.onSiteTab" })).toBeTruthy();
    expect(within(card).queryByRole("region", { name: "gatekeeper.checkOutNotes" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "gatekeeper.checkOutNotes" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Expected Time" })).toBe(screen.getByTestId("input-gate-duration"));
  });

  it("exposes selected duration and captured-photo states on the branded Gate controls", async () => {
    renderPage();
    const duration = await screen.findByRole("combobox", { name: "Expected Time" });
    expect(Array.from(duration.querySelectorAll("option"), option => option.value)).toEqual(["240", "600", "720"]);
    expect((duration as HTMLSelectElement).value).toBe("240");
    fireEvent.change(duration, { target: { value: "720" } });
    expect((duration as HTMLSelectElement).value).toBe("720");
    expect(screen.getByTestId("button-gate-read-plate").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("button-gate-vehicle-photo").getAttribute("aria-pressed")).toBe("false");
  });
});
