import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// === Module mocks (must be hoisted before importing the component) ===

// useToast — capture every toast() call so the suite can assert that the
// inline-error UX paths NEVER pop a toast on top of the pinned banner.
// This mirrors the mobile mirror's "no Alert.alert from these paths"
// contract (`CrewTimeSection.test.tsx` + `apiErrors.ts`).
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn() }),
  toast: toastSpy,
}));

// Brand-pill PNG-backed buttons — render as plain DOM buttons so jsdom
// doesn't try to decode the bundled sprites. Mirrors the same shim used
// by `crew-time-section.chip-remove.test.tsx`.
vi.mock("@/components/pill-bg", () => ({ default: () => null }));
vi.mock("@/components/brand-button-bg", () => ({
  BrandedSolidFill: () => null,
  BrandedHoverFill: () => null,
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ isOrgBranded: false }),
}));
vi.mock("@assets/36_Green_Left_1775988086352.png", () => ({ default: "p.png" }));
vi.mock("@assets/36_Green_Right_1775988094184.png", () => ({ default: "p.png" }));
vi.mock("@assets/36_Green_Center_1775988081702.png", () => ({ default: "p.png" }));
vi.mock("@assets/900x229_Grey_Button_1777067254819.png", () => ({ default: "p.png" }));
vi.mock("@assets/900x229_Red_Button_1777066896414.png", () => ({ default: "p.png" }));

// react-query client query-key helper — the dialog hands the value back
// to react-query for the silent-refresh invalidate. Returning a stable
// key shape lets the test assert the invalidation by spying on
// `qc.invalidateQueries`.
vi.mock("@workspace/api-client-react", () => ({
  getGetTicketQueryKey: (id: number) => ["/api/tickets", id],
  getGetPartnerQueryKey: (id: number) => ["/api/partners", id],
  getGetVendorQueryKey: (id: number) => ["/api/vendors", id],
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
}));

// useAuth — DialogLogoArea (rendered by every Dialog) reads
// `user.role`, so return a no-org admin shape so neither the partner
// nor vendor logo branch fires.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { userId: 1, role: "admin", vendorId: null, partnerId: null },
    isLoading: false,
  }),
}));

vi.mock("@assets/VNDRLY_Header_Blur_4_1776220762025.png", () => ({
  default: "header.png",
}));
vi.mock("@assets/VNDRLY_Header_Blur_Dark_1778850026167.png", () => ({
  default: "header-dark.png",
}));

// useEligibleVendorFieldEmployeesByVendorId — return a small eligible
// list so the crew checkbox section renders. The dialog reads
// `eligibleForemen` for both the crew checkboxes and the foreman
// dropdown options.
const eligibleEmployees = [
  { id: 200, vendorId: 7, firstName: "Carol", lastName: "Foreman", isActive: true, userId: 5000 },
  { id: 201, vendorId: 7, firstName: "Dave", lastName: "Worker", isActive: true, userId: 5001 },
];
vi.mock("@/hooks/use-eligible-vendor-field-employees", () => ({
  useEligibleVendorFieldEmployeesByVendorId: () => ({
    fieldEmployees: eligibleEmployees,
    eligibleForemen: eligibleEmployees,
  }),
  useClearStaleFieldEmployeeSelection: () => {},
}));

import ScheduleTicketDialog from "./schedule-ticket-dialog";

// ── Helpers ────────────────────────────────────────────────────────────

type ScheduleResponse =
  | { ok: true; body?: unknown }
  | { ok: false; status: number; body: unknown };

const handlers: {
  schedulePost: () => ScheduleResponse;
  postCallCount: number;
} = {
  schedulePost: () => ({ ok: true, body: { ok: true } }),
  postCallCount: 0,
};

function resetHandlers(initial?: { schedulePost?: () => ScheduleResponse }) {
  handlers.schedulePost = initial?.schedulePost ?? (() => ({ ok: true, body: { ok: true } }));
  handlers.postCallCount = 0;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Stub `global.fetch` for every URL the dialog hits while opening +
// saving a schedule. The schedule POST is the path under test; every
// other URL gets a benign default (empty roster / no cert / no
// weather) so the dialog can mount and the Save button is reachable.
function installFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET") {
      if (url.match(/\/api\/tickets\/\d+\/schedule$/)) {
        // Pre-existing schedule snapshot. Returning a populated
        // start/duration/crew lets us click Save without filling
        // anything in by hand — and avoids the `!startInput` early
        // return inside `attemptSave()` short-circuiting before the
        // POST is ever issued.
        return jsonResponse(200, {
          scheduledStartAt: "2026-06-01T15:00:00.000Z",
          scheduledDurationMinutes: 60,
          foremanUserId: 5000,
          crew: [
            { employeeId: 200, userId: 5000, name: "Carol Foreman" },
            { employeeId: 201, userId: 5001, name: "Dave Worker" },
          ],
          warningKinds: ["1d", "1h", "start"],
        });
      }
      if (url.match(/\/api\/tickets\/\d+$/)) {
        return jsonResponse(200, { siteLocationId: 99, workTypeId: null });
      }
      if (url.match(/\/api\/work-types\/\d+\/required-certifications$/)) {
        return jsonResponse(200, { requiredCertifications: [] });
      }
      if (url.match(/\/api\/sites\/\d+\/weather/)) {
        return jsonResponse(200, {
          siteName: "Site",
          time: null,
          temperatureF: null,
          precipitationProbability: null,
          windMph: null,
          weatherCode: null,
        });
      }
      if (url.match(/\/api\/field-employees\/\d+\/certifications$/)) {
        return jsonResponse(200, []);
      }
    }

    if (method === "POST" && url.match(/\/api\/tickets\/\d+\/schedule$/)) {
      handlers.postCallCount += 1;
      const result = handlers.schedulePost();
      if (result.ok) return jsonResponse(200, result.body ?? { ok: true });
      return jsonResponse(result.status, result.body);
    }

    return jsonResponse(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

let qc: QueryClient;
let invalidateSpy: ReturnType<typeof vi.spyOn>;

function renderDialog() {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  return render(
    <QueryClientProvider client={qc}>
      <ScheduleTicketDialog
        open={true}
        onOpenChange={() => {}}
        ticketId={42}
        vendorId={7}
      />
    </QueryClientProvider>,
  );
}

async function clickSave() {
  // The Save button is gated on the snapshot loader resolving, so wait
  // for it to appear before clicking — otherwise the test races the
  // `loaded` state and the POST never fires.
  const btn = await screen.findByTestId("button-save-schedule");
  fireEvent.click(btn);
}

beforeEach(() => {
  toastSpy.mockReset();
  resetHandlers();
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("ScheduleTicketDialog — inline error wiring (Task #881)", () => {
  it("pins a per-control failure inline next to the failing control", async () => {
    // crew_invalid_for_vendor → routes to the crew section. With real
    // i18n the message resolves via errors.crew_invalid_for_vendor in
    // en.json.
    resetHandlers({
      schedulePost: () => ({
        ok: false,
        status: 400,
        body: {
          error: "crew_invalid_for_vendor",
          message: "One or more crew members aren't on this vendor.",
        },
      }),
    });

    renderDialog();
    await clickSave();

    const inline = await screen.findByTestId("error-schedule-crew");
    expect(inline.textContent).toBe(
      "One or more crew members aren't on this vendor.",
    );

    // The failing-control banner is the entire UX — no toast, no
    // duplicate message under any other control.
    expect(toastSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("error-schedule-start")).toBeNull();
    expect(screen.queryByTestId("error-schedule-duration")).toBeNull();
    expect(screen.queryByTestId("error-schedule-foreman")).toBeNull();
    expect(screen.queryByTestId("error-schedule-general")).toBeNull();
  });

  it("silently refreshes (no pinned message, no toast) when the server returns a state-conflict code", async () => {
    // ticket_state_changed is in the canonical
    // TICKET_STATE_CONFLICT_CODES set. The dialog should clear any
    // prior fieldError and invalidate the ticket query rather than
    // pin a stale message under a control that may have just
    // disappeared. Mirrors the mobile mirror's silent-refresh path
    // (CrewTimeSection.test.tsx).
    resetHandlers({
      schedulePost: () => ({
        ok: false,
        status: 409,
        body: {
          error: "ticket_state_changed",
          message: "Ticket state changed",
        },
      }),
    });

    renderDialog();
    await clickSave();

    // The POST resolves and the dialog should react. Wait for the
    // invalidate side-effect rather than racing it.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalled();
    });

    // The invalidate must target the ticket query (the parent screen's
    // re-render is the whole point of the silent refresh).
    const targeted = invalidateSpy.mock.calls.some((call: unknown[]) => {
      const arg = call[0] as { queryKey?: unknown[] } | undefined;
      const key = arg?.queryKey;
      return Array.isArray(key) && key[0] === "/api/tickets" && key[1] === 42;
    });
    expect(targeted).toBe(true);

    // No stale error pinned under any control — and no toast either.
    expect(screen.queryByTestId("error-schedule-start")).toBeNull();
    expect(screen.queryByTestId("error-schedule-duration")).toBeNull();
    expect(screen.queryByTestId("error-schedule-crew")).toBeNull();
    expect(screen.queryByTestId("error-schedule-foreman")).toBeNull();
    expect(screen.queryByTestId("error-schedule-general")).toBeNull();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("re-routes a membership code returned from a non-picker control to the crew section", async () => {
    // foreman_vendor_mismatch is one of the CREW_VALIDATION_CODES that
    // the legacy switch in `inlineErrorFor` did NOT special-case — it
    // used to fall through to the (invisible) "general" branch. The
    // shared CREW_VALIDATION_CODES set now re-routes every membership
    // code to the crew section so the operator sees the message next
    // to the control they need to fix. Mirrors the mobile mirror's
    // CREW_PICKER_CODES re-routing.
    resetHandlers({
      schedulePost: () => ({
        ok: false,
        status: 400,
        body: {
          error: "foreman_vendor_mismatch",
          message: "That foreman isn't on this vendor.",
        },
      }),
    });

    renderDialog();
    await clickSave();

    const inline = await screen.findByTestId("error-schedule-crew");
    expect(inline.textContent).toBe(
      "That foreman isn't on this vendor. Pick a different field employee.",
    );

    // The "general" slot stays empty — the membership re-route is the
    // whole point: a non-picker control's failure surfaces under the
    // crew section, not under a generic banner.
    expect(screen.queryByTestId("error-schedule-general")).toBeNull();
    // And no toast / modal alert from this path either.
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
