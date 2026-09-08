import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
}));
const liveMonitor = vi.hoisted(() => ({
  flash: null as Record<string, unknown> | null,
}));

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
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

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
  api.list.mockResolvedValue([]);
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
