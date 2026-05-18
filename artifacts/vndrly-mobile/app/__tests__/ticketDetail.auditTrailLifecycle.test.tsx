import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Task #859 — mobile-side coverage for the Audit Trail rendering across
// a full invite → deny → reinvite → accept lifecycle. Task #850 already
// added the banner / deny-modal coverage for vendors and verified the
// web admin viewer end-to-end via Playwright. The mobile close-out
// screen rendering of the Audit Trail itself was only covered
// indirectly via the shared OpenAPI contract + a typecheck pass, so a
// regression in apiFetch's response handling, the kind classification,
// or the red-bordered denial reason box would ship unnoticed.
//
// Detox / Maestro are NOT wired up in this monorepo (no native
// toolchains, no simulator orchestration) — see the same note on the
// sibling `ticketDetail.vendorAcceptDeny.test.tsx`. The accepted
// substitute for "mobile e2e" coverage in this artifact is
// vitest + jsdom + react-native-web rendering of the screen, with
// `apiFetch` stubbed at the module boundary so we can drive the same
// /accept, /deny, /reinvite, /transitions endpoints the real server
// exposes. This file exercises the lifecycle end-to-end against an
// in-memory ticket + transitions log that mirrors the server
// transition recorder (`recordTicketTransition` writes one row per
// state change; `GET /api/tickets/:id/transitions` enriches reinvite
// rows with `fromVendorName`/`toVendorName`/`displayReason`).
//
// What this locks in:
//   1. Vendor #1 sees the invite banner, denies with a reason, and
//      the close-out's Audit Trail picks up the "denied" entry on the
//      next load — including the red-bordered denial reason box that
//      renders the actual reason text from the deny modal.
//   2. After the partner reinvites Vendor #2, Vendor #1's screen no
//      longer shows the banner (the role+vendorId gate flips off) but
//      the Audit Trail keeps the prior entries and adds the reinvite
//      row with the resolved "from / to" vendor names that the server
//      attaches.
//   3. After Vendor #2 accepts, the Audit Trail shows all four events
//      (invite_sent + denied + reinvited + accepted) in chronological
//      order, with the denial reason box still anchored to the second
//      entry and the reinvite row still showing the vendor-name
//      headline.

// === Module mocks (must be hoisted before importing the screen) ===

vi.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    background: "#fff",
    foreground: "#000",
    card: "#f5f5f5",
    border: "#ccc",
    primary: "#f59e0b",
    primaryForeground: "#fff",
    accent: "#fef3c7",
    accentForeground: "#92400e",
    muted: "#e5e5e5",
    mutedForeground: "#666",
    destructive: "#dc2626",
  }),
}));

vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));

vi.mock("expo-image", async () => {
  const ReactLib = (await import("react")).default;
  return { Image: () => ReactLib.createElement("img") };
});

vi.mock("expo-linear-gradient", async () => {
  const ReactLib = (await import("react")).default;
  return {
    LinearGradient: ({ children }: { children?: React.ReactNode }) =>
      ReactLib.createElement("div", null, children),
  };
});

const { routerReplaceMock } = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
}));
vi.mock("expo-router", () => ({
  router: { replace: routerReplaceMock, push: vi.fn(), back: vi.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "859" }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(() => cb(), [cb]);
  },
}));

const {
  requestForegroundPermissionsAsyncMock,
  getCurrentPositionAsyncMock,
  getForegroundPermissionsAsyncMock,
  watchPositionAsyncMock,
} = vi.hoisted(() => ({
  requestForegroundPermissionsAsyncMock: vi.fn(),
  getCurrentPositionAsyncMock: vi.fn(),
  getForegroundPermissionsAsyncMock: vi.fn(),
  watchPositionAsyncMock: vi.fn(),
}));
vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: () => ({ remove: () => {} }),
}));
vi.mock("expo-location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  requestForegroundPermissionsAsync: (...a: unknown[]) =>
    requestForegroundPermissionsAsyncMock(...a),
  getCurrentPositionAsync: (...a: unknown[]) =>
    getCurrentPositionAsyncMock(...a),
  getForegroundPermissionsAsync: (...a: unknown[]) =>
    getForegroundPermissionsAsyncMock(...a),
  watchPositionAsync: (...a: unknown[]) => watchPositionAsyncMock(...a),
}));

// Smarter translator than the sibling spec: real audit-trail rendering
// interpolates `{{from}}` / `{{to}}` into `tickets.auditReinvitedFromTo`,
// `{{name}}` / `{{role}}` into `tickets.auditByActor`, and `{{count}}`
// into `tickets.auditTrail`. Without interpolation we can't assert the
// reinvite headline carries the vendor names the server resolved, which
// is the whole point of this lock-in. Returning a plain string from a
// stable Map of templates avoids dragging i18next into the test sandbox
// while keeping the assertions human-readable.
const I18N_TEMPLATES: Record<string, string> = {
  "tickets.auditTrail": "Audit Trail ({{count}})",
  "tickets.auditCreated": "Ticket created",
  "tickets.auditInviteSent": "Invite sent to vendor",
  "tickets.auditInviteAccepted": "Vendor accepted invite",
  "tickets.auditInviteDenied": "Vendor denied invite",
  "tickets.auditReinvited": "Reassigned to a different vendor",
  "tickets.auditReinvitedFromTo": "Reassigned from {{from}} to {{to}}",
  "tickets.auditByActor": "By {{name}} ({{role}})",
  "tickets.auditBySystem": "By the system",
  "tickets.auditUnknownRole": "unknown role",
  "tickets.auditDenialReasonLabel": "Denial reason:",
  "tickets.reasonLabel": "Reason:",
  "tickets.auditRole_admin": "admin",
  "tickets.auditRole_partner": "partner",
  "tickets.auditRole_vendor": "vendor",
  "tickets.auditRole_field_employee": "field employee",
};
function tInterpolating(
  key: string,
  vars?: Record<string, unknown> | { defaultValue?: string },
): string {
  const template =
    I18N_TEMPLATES[key] ??
    (vars && typeof (vars as { defaultValue?: string }).defaultValue === "string"
      ? (vars as { defaultValue: string }).defaultValue
      : key.startsWith("errors.")
        ? `tx:${key}`
        : key);
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const v = (vars as Record<string, unknown>)[name];
    return v == null ? "" : String(v);
  });
}
const useTranslationReturn = { t: tInterpolating };
vi.mock("react-i18next", () => ({
  useTranslation: () => useTranslationReturn,
}));

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetchMock(...a),
  getApiBase: () => "https://example.test",
  initApi: vi.fn(),
}));

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getUser: (...a: unknown[]) => getUserMock(...a),
  setUser: vi.fn(),
  setToken: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@/lib/maps", () => ({
  MAP_TILE_SIZE: 256,
  getOsmTile: () => ({ url: "x", offsetX: 0, offsetY: 0 }),
  openInMaps: vi.fn(),
}));

vi.mock("@/lib/photos", () => ({
  captureAndUploadImage: vi.fn(async () => null),
}));

vi.mock("@workspace/db/format", () => ({
  formatTicketTrackingNumber: (id: number) => `T-${id}`,
}));

// Heavy children stubbed out — they pull in the native bridge for
// reanimated / SVG / route-map tiles and add no value for an
// audit-trail rendering test.
vi.mock("@/components/ActiveOrgIndicator", () => ({ default: () => null }));
vi.mock("@/components/TicketRouteMap", () => ({ TicketRouteMap: () => null }));
vi.mock("@/components/TicketTrackingTimeline", () => ({
  TicketTrackingTimeline: () => null,
}));
vi.mock("@/components/CrewTimeSection", () => ({ default: () => null }));
vi.mock("@/components/CommentsPanel", () => ({ default: () => null }));
vi.mock("@/components/TicketStatusStepper", () => ({ default: () => null }));

function makeButtonShim() {
  return async () => {
    const ReactLib = (await import("react")).default;
    return {
      default: ({
        children,
        onPress,
        disabled,
        loading,
        testID,
      }: {
        children?: React.ReactNode;
        onPress?: () => void;
        disabled?: boolean;
        loading?: boolean;
        testID?: string;
      }) => {
        const isDisabled = !!(disabled || loading);
        return ReactLib.createElement(
          "button",
          {
            "data-testid": testID,
            "aria-disabled": isDisabled || undefined,
            disabled: isDisabled,
            onClick: isDisabled ? undefined : onPress,
          },
          typeof children === "string" ? children : "btn",
        );
      },
    };
  };
}
vi.mock("@/components/AmberButton", makeButtonShim());
vi.mock("@/components/BlueButton", makeButtonShim());
vi.mock("@/components/GreyButton", makeButtonShim());

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alert } from "react-native";

import TicketDetailScreen from "../ticket/[id]";

afterEach(() => {
  cleanup();
});

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  requestForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
  getForegroundPermissionsAsyncMock.mockResolvedValue({ status: "denied" });
  watchPositionAsyncMock.mockResolvedValue({ remove: vi.fn() });
  alertSpy = vi.spyOn(Alert, "alert").mockImplementation(() => {});
});

const TICKET_ID = 859;
const VENDOR_1_ID = 5001;
const VENDOR_2_ID = 5002;
const VENDOR_1_NAME = "Vendor One LLC";
const VENDOR_2_NAME = "Vendor Two LLC";
const VENDOR_1_USER_ID = 9101;
const VENDOR_2_USER_ID = 9102;
const PARTNER_USER_ID = 9201;

type TicketStub = {
  id: number;
  status: string;
  description: string | null;
  siteName: string | null;
  siteLocationId: number | null;
  state: string | null;
  workTypeName: string | null;
  partnerName: string | null;
  vendorId: number | null;
  vendorName: string | null;
  lifecycleState: "pending_arrival" | "en_route" | "on_site" | "off_site" | null;
  arrivedAt: string | null;
  createdAt: string;
};

type TransitionStub = {
  id: number;
  ticketId: number;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  reason: string | null;
  displayReason: string | null;
  fromVendorName: string | null;
  toVendorName: string | null;
  createdAt: string;
};

function makeTicket(overrides: Partial<TicketStub> = {}): TicketStub {
  return {
    id: TICKET_ID,
    status: "awaiting_acceptance",
    description: "T859 audit trail lifecycle ticket",
    siteName: "Acme HQ",
    siteLocationId: null,
    state: null,
    workTypeName: "Maintenance",
    partnerName: "Acme Partner",
    vendorId: VENDOR_1_ID,
    vendorName: VENDOR_1_NAME,
    lifecycleState: "pending_arrival",
    arrivedAt: null,
    createdAt: "2026-05-01T09:00:00Z",
    ...overrides,
  };
}

/**
 * In-memory mirror of the server-side ticket + transitions log. Each
 * mutation appends a transition row matching what the real server
 * writes via `recordTicketTransition()` so the screen sees the same
 * shape on its next /transitions GET.
 *
 * - /accept appends a `awaiting_acceptance → initiated` row attributed
 *   to the currently signed-in user (vendor admin).
 * - /deny appends a `awaiting_acceptance → denied` row carrying the
 *   trimmed reason from the modal's body.
 * - /reinvite appends a `denied → awaiting_acceptance` row whose
 *   `displayReason` / `fromVendorName` / `toVendorName` mirror the
 *   server's vendor-name resolution — this is the lookup the close-out
 *   audit trail relies on for the headline that includes vendor names.
 */
function setupApi(initial: TicketStub) {
  let current: TicketStub = { ...initial };
  const transitions: TransitionStub[] = [
    // Initial invite_sent transition the server writes when a partner
    // self-service ticket is created (`fromStatus=null`,
    // `toStatus="awaiting_acceptance"`). Pre-seeding it keeps the
    // first GET realistic — the screen would never see an empty trail
    // for an awaiting_acceptance ticket in production.
    {
      id: 7001,
      ticketId: TICKET_ID,
      fromStatus: null,
      toStatus: "awaiting_acceptance",
      actorUserId: PARTNER_USER_ID,
      actorName: "Partner Admin",
      actorRole: "partner",
      reason: null,
      displayReason: null,
      fromVendorName: null,
      toVendorName: null,
      createdAt: "2026-05-01T09:00:01Z",
    },
  ];
  let nextTransitionId = 7002;
  let actingUserId: number | null = VENDOR_1_USER_ID;
  let actingActorName: string | null = "Vendor 1 Admin";
  let actingActorRole: "vendor" | "partner" | "admin" | "field_employee" | null =
    "vendor";

  function appendTransition(
    row: Omit<TransitionStub, "id" | "ticketId" | "createdAt"> & {
      createdAt?: string;
    },
  ) {
    transitions.push({
      ticketId: TICKET_ID,
      id: nextTransitionId++,
      createdAt:
        row.createdAt ??
        new Date(2026, 4, 1, 9, transitions.length + 5).toISOString(),
      ...row,
    });
  }

  let getCalls = 0;
  let transitionsGetCalls = 0;
  const acceptCalls: Array<unknown> = [];
  const denyCalls: Array<{ reason: string }> = [];
  const reinviteCalls: Array<{ vendorId: number }> = [];

  apiFetchMock.mockImplementation(
    (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";

      if (url === `/api/tickets/${TICKET_ID}` && method === "GET") {
        getCalls += 1;
        return Promise.resolve({ ...current });
      }
      if (url === `/api/tickets/${TICKET_ID}/transitions`) {
        transitionsGetCalls += 1;
        // Snapshot copy so the screen's setState can't mutate our log.
        return Promise.resolve(transitions.map((t) => ({ ...t })));
      }
      if (url === `/api/tickets/${TICKET_ID}/line-items`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/note-logs`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/gps-logs`)
        return Promise.resolve([]);
      if (url === `/api/tickets/${TICKET_ID}/unlocks`)
        return Promise.resolve([]);

      if (url === `/api/tickets/${TICKET_ID}/accept` && method === "POST") {
        acceptCalls.push(init?.body ?? null);
        appendTransition({
          fromStatus: "awaiting_acceptance",
          toStatus: "initiated",
          actorUserId: actingUserId,
          actorName: actingActorName,
          actorRole: actingActorRole,
          reason: null,
          displayReason: null,
          fromVendorName: null,
          toVendorName: null,
        });
        current = { ...current, status: "initiated" };
        return Promise.resolve({ id: TICKET_ID, status: current.status });
      }
      if (url === `/api/tickets/${TICKET_ID}/deny` && method === "POST") {
        const parsed = init?.body
          ? (JSON.parse(init.body as string) as { reason: string })
          : { reason: "" };
        denyCalls.push(parsed);
        appendTransition({
          fromStatus: "awaiting_acceptance",
          toStatus: "denied",
          actorUserId: actingUserId,
          actorName: actingActorName,
          actorRole: actingActorRole,
          // Server stores the raw reason as `reason`; for non-reinvite
          // rows `displayReason` is the same value (no vendor-name
          // enrichment needed), matching the close-out screen's
          // fallback (`entry.displayReason ?? entry.reason`).
          reason: parsed.reason,
          displayReason: parsed.reason,
          fromVendorName: null,
          toVendorName: null,
        });
        current = { ...current, status: "denied" };
        return Promise.resolve({ id: TICKET_ID, status: current.status });
      }
      if (url === `/api/tickets/${TICKET_ID}/reinvite` && method === "POST") {
        const parsed = init?.body
          ? (JSON.parse(init.body as string) as { vendorId: number })
          : { vendorId: 0 };
        reinviteCalls.push(parsed);
        const previousVendorId = current.vendorId;
        const previousVendorName = current.vendorName;
        const newVendorName =
          parsed.vendorId === VENDOR_2_ID
            ? VENDOR_2_NAME
            : `vendor #${parsed.vendorId}`;
        appendTransition({
          fromStatus: current.status,
          toStatus: "awaiting_acceptance",
          actorUserId: PARTNER_USER_ID,
          actorName: "Partner Admin",
          actorRole: "partner",
          // Mirrors the server's raw row text:
          //   `reassigned from vendor #${prev} to vendor #${new}`
          // and the GET enrichment that turns those IDs into names.
          reason: `reassigned from vendor #${previousVendorId ?? 0} to vendor #${parsed.vendorId}`,
          displayReason: `reassigned from ${previousVendorName ?? `vendor #${previousVendorId ?? 0}`} to ${newVendorName}`,
          fromVendorName: previousVendorName,
          toVendorName: newVendorName,
        });
        current = {
          ...current,
          status: "awaiting_acceptance",
          vendorId: parsed.vendorId,
          vendorName: newVendorName,
        };
        return Promise.resolve({ id: TICKET_ID, status: current.status });
      }

      return Promise.reject(new Error(`unexpected url ${method} ${url}`));
    },
  );

  return {
    snapshot: () => ({ ...current }),
    transitionsSnapshot: () => transitions.map((t) => ({ ...t })),
    setActor: (
      userId: number | null,
      actorName: string | null,
      actorRole: "vendor" | "partner" | "admin" | "field_employee" | null,
    ) => {
      actingUserId = userId;
      actingActorName = actorName;
      actingActorRole = actorRole;
    },
    getTicketGetCount: () => getCalls,
    getTransitionsGetCount: () => transitionsGetCalls,
    acceptCalls,
    denyCalls,
    reinviteCalls,
  };
}

function firstByTestId(id: string): HTMLElement {
  return screen.getAllByTestId(id)[0];
}

function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
}

async function renderAndWaitForLoad() {
  const utils = render(<TicketDetailScreen />);
  await waitFor(() => {
    expect(firstByTestId("text-ticket-tracking-number")).toBeTruthy();
  });
  return utils;
}

async function waitForUserLoaded() {
  await waitFor(() => {
    expect(getUserMock).toHaveBeenCalled();
  });
  await Promise.resolve();
}

const vendor1User = {
  id: VENDOR_1_USER_ID,
  username: "v1-admin@example.com",
  role: "vendor",
  vendorId: VENDOR_1_ID,
  displayName: "Vendor 1 Admin",
};

const vendor2User = {
  id: VENDOR_2_USER_ID,
  username: "v2-admin@example.com",
  role: "vendor",
  vendorId: VENDOR_2_ID,
  displayName: "Vendor 2 Admin",
};

const DENIAL_REASON = "T859 audit trail: not staffed this week, please reinvite";

describe("TicketDetailScreen — Audit Trail across invite/deny/reinvite/accept (Task #859)", () => {
  it("vendor #1 deny: audit trail picks up the denied entry with a red-bordered reason box that quotes the actual reason text", async () => {
    getUserMock.mockResolvedValue(vendor1User);
    const api = setupApi(makeTicket());
    api.setActor(VENDOR_1_USER_ID, "Vendor 1 Admin", "vendor");

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    // Sanity: vendor #1 sees the invite banner on the awaiting_acceptance
    // ticket. (Asserted in detail by the sibling vendorAcceptDeny spec —
    // checked here to anchor the lifecycle.)
    expect(firstByTestId("vendor-invite-banner")).toBeTruthy();

    // The pre-seeded invite_sent transition is already on the screen
    // before the user denies anything.
    await waitFor(() => {
      expect(firstByTestId("audit-trail-timeline")).toBeTruthy();
    });
    const seedEntry = api
      .transitionsSnapshot()
      .find((t) => t.fromStatus === null && t.toStatus === "awaiting_acceptance");
    expect(seedEntry).toBeTruthy();
    expect(firstByTestId(`audit-trail-entry-${seedEntry!.id}`)).toBeTruthy();
    // The invite_sent row is in the HIDE_REASON_KINDS set, so no reason
    // box should render even if `reason` were ever populated.
    expect(
      screen.queryAllByTestId(`audit-trail-reason-${seedEntry!.id}`).length,
    ).toBe(0);

    // ── Open deny modal, type the reason, submit. ──
    tap(firstByTestId("button-deny-invite"));
    await waitFor(() => {
      expect(firstByTestId("input-deny-reason")).toBeTruthy();
    });
    fireEvent.change(firstByTestId("input-deny-reason"), {
      target: { value: DENIAL_REASON },
    });

    const transitionsBefore = api.getTransitionsGetCount();
    tap(firstByTestId("button-submit-deny"));

    await waitFor(() => {
      expect(api.denyCalls.length).toBe(1);
    });
    expect(api.denyCalls[0]).toEqual({ reason: DENIAL_REASON });

    // load() refetches transitions after the mutation resolves; the
    // count must increase before we can assert against the new entry.
    await waitFor(() => {
      expect(api.getTransitionsGetCount()).toBeGreaterThan(transitionsBefore);
    });

    // Locate the denied row by walking the in-memory log instead of
    // the timeline DOM — this keeps the assertion robust against
    // chronological re-ordering.
    const deniedEntry = api
      .transitionsSnapshot()
      .find(
        (t) =>
          t.fromStatus === "awaiting_acceptance" && t.toStatus === "denied",
      );
    expect(deniedEntry).toBeTruthy();
    const deniedRow = await waitFor(() =>
      firstByTestId(`audit-trail-entry-${deniedEntry!.id}`),
    );
    expect(deniedRow).toBeTruthy();

    // The headline should localize to "Vendor denied invite".
    expect(deniedRow.textContent ?? "").toContain("Vendor denied invite");
    // Actor block carries the vendor admin's name + their role.
    expect(deniedRow.textContent ?? "").toContain("By Vendor 1 Admin (vendor)");

    // Red-bordered denial reason box renders for the denied entry.
    const reasonBox = firstByTestId(`audit-trail-reason-${deniedEntry!.id}`);
    expect(reasonBox).toBeTruthy();
    expect(reasonBox.textContent ?? "").toContain("Denial reason:");
    // The exact text from the deny modal must be on the screen — no
    // truncation or substitution.
    expect(reasonBox.textContent ?? "").toContain(DENIAL_REASON);

    // Style sanity for the "red-bordered" requirement. react-native-web
    // serializes RN style objects to inline CSS, so the destructive
    // colors used in the screen (`#fecaca` border, `#fef2f2` bg,
    // `#7f1d1d` foreground) end up as concrete style properties.
    const inlineStyle = reasonBox.getAttribute("style") ?? "";
    expect(inlineStyle).toContain("rgb(254, 202, 202)"); // #fecaca border
    expect(inlineStyle).toContain("rgb(254, 242, 242)"); // #fef2f2 background

    // Banner gone now that the ticket is denied.
    await waitFor(() => {
      expect(screen.queryAllByTestId("vendor-invite-banner").length).toBe(0);
    });
    expect(api.snapshot().status).toBe("denied");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("partner reinvites vendor #2 → vendor #2 accepts: audit trail shows all four lifecycle events (invite_sent, denied, reinvited, accepted) with vendor names on the reinvite headline", async () => {
    // ── Step 1: vendor #1 denies. ──
    getUserMock.mockResolvedValue(vendor1User);
    const api = setupApi(makeTicket());
    api.setActor(VENDOR_1_USER_ID, "Vendor 1 Admin", "vendor");

    const v1Render = await renderAndWaitForLoad();
    await waitForUserLoaded();

    expect(firstByTestId("vendor-invite-banner")).toBeTruthy();
    tap(firstByTestId("button-deny-invite"));
    await waitFor(() => {
      expect(firstByTestId("input-deny-reason")).toBeTruthy();
    });
    fireEvent.change(firstByTestId("input-deny-reason"), {
      target: { value: DENIAL_REASON },
    });
    tap(firstByTestId("button-submit-deny"));
    await waitFor(() => {
      expect(api.snapshot().status).toBe("denied");
    });
    v1Render.unmount();
    cleanup();

    // ── Step 2: partner reinvites vendor #2 via /reinvite. ──
    // Drive the same endpoint the partner web UI hits; this appends a
    // `denied → awaiting_acceptance` transition with vendor-name
    // enrichment so the close-out can render the "Reassigned from X to
    // Y" headline.
    api.setActor(PARTNER_USER_ID, "Partner Admin", "partner");
    const reinviteResp = (await apiFetchMock(
      `/api/tickets/${TICKET_ID}/reinvite`,
      {
        method: "POST",
        body: JSON.stringify({ vendorId: VENDOR_2_ID }),
      },
    )) as { id: number; status: string };
    expect(reinviteResp.status).toBe("awaiting_acceptance");
    expect(api.snapshot().vendorId).toBe(VENDOR_2_ID);
    expect(api.reinviteCalls).toEqual([{ vendorId: VENDOR_2_ID }]);

    // ── Step 3: vendor #1 reopens the ticket — banner is gone but
    // the audit trail still loads with the prior + reinvite entries.
    getUserMock.mockResolvedValue(vendor1User);
    await renderAndWaitForLoad();
    await waitForUserLoaded();

    // Vendor #1's role+vendorId gate now flips off because the ticket
    // is pinned to vendor #2 — no banner shows even though the ticket
    // is back in awaiting_acceptance.
    expect(screen.queryAllByTestId("vendor-invite-banner").length).toBe(0);

    // Audit trail still renders with the reinvite headline including
    // the resolved vendor names.
    expect(firstByTestId("audit-trail-timeline")).toBeTruthy();
    const reinviteEntry = api
      .transitionsSnapshot()
      .find(
        (t) =>
          t.fromStatus === "denied" && t.toStatus === "awaiting_acceptance",
      );
    expect(reinviteEntry).toBeTruthy();
    const reinviteRow = firstByTestId(
      `audit-trail-entry-${reinviteEntry!.id}`,
    );
    expect(reinviteRow.textContent ?? "").toContain(
      `Reassigned from ${VENDOR_1_NAME} to ${VENDOR_2_NAME}`,
    );
    // Reinvite rows are in HIDE_REASON_KINDS so we should NOT render
    // the warning-amber reason box (that box is reserved for denied
    // and other meaningful-reason events).
    expect(
      screen.queryAllByTestId(`audit-trail-reason-${reinviteEntry!.id}`).length,
    ).toBe(0);
    cleanup();

    // ── Step 4: vendor #2 opens the ticket and accepts. ──
    api.setActor(VENDOR_2_USER_ID, "Vendor 2 Admin", "vendor");
    getUserMock.mockResolvedValue(vendor2User);

    await renderAndWaitForLoad();
    await waitForUserLoaded();

    // Banner now addressed to vendor #2.
    expect(firstByTestId("vendor-invite-banner")).toBeTruthy();
    tap(firstByTestId("button-accept-invite"));

    await waitFor(() => {
      expect(api.acceptCalls.length).toBe(1);
    });
    await waitFor(() => {
      expect(api.snapshot().status).toBe("initiated");
    });
    await waitFor(() => {
      expect(screen.queryAllByTestId("vendor-invite-banner").length).toBe(0);
    });

    // ── Final assertion: all four lifecycle events render in the
    // audit trail, in chronological order, with the right vendors. ──
    const finalLog = api.transitionsSnapshot();
    expect(finalLog.length).toBe(4);

    const [seed, denied, reinvited, accepted] = finalLog;

    // 1. Invite sent (server-recorded on partner self-service create).
    expect(seed.fromStatus).toBeNull();
    expect(seed.toStatus).toBe("awaiting_acceptance");
    const seedRow = firstByTestId(`audit-trail-entry-${seed.id}`);
    expect(seedRow.textContent ?? "").toContain("Invite sent to vendor");
    expect(seedRow.textContent ?? "").toContain("By Partner Admin (partner)");

    // 2. Denied — red reason box still anchored to entry #2 with the
    // exact reason from the deny step.
    expect(denied.fromStatus).toBe("awaiting_acceptance");
    expect(denied.toStatus).toBe("denied");
    const deniedRow = firstByTestId(`audit-trail-entry-${denied.id}`);
    expect(deniedRow.textContent ?? "").toContain("Vendor denied invite");
    expect(deniedRow.textContent ?? "").toContain("By Vendor 1 Admin (vendor)");
    const deniedReason = firstByTestId(`audit-trail-reason-${denied.id}`);
    expect(deniedReason.textContent ?? "").toContain("Denial reason:");
    expect(deniedReason.textContent ?? "").toContain(DENIAL_REASON);

    // 3. Reinvited — server-resolved vendor names render in headline.
    expect(reinvited.fromStatus).toBe("denied");
    expect(reinvited.toStatus).toBe("awaiting_acceptance");
    expect(reinvited.fromVendorName).toBe(VENDOR_1_NAME);
    expect(reinvited.toVendorName).toBe(VENDOR_2_NAME);
    const reinvitedRow = firstByTestId(`audit-trail-entry-${reinvited.id}`);
    expect(reinvitedRow.textContent ?? "").toContain(
      `Reassigned from ${VENDOR_1_NAME} to ${VENDOR_2_NAME}`,
    );
    expect(reinvitedRow.textContent ?? "").toContain(
      "By Partner Admin (partner)",
    );

    // 4. Accepted by vendor #2.
    expect(accepted.fromStatus).toBe("awaiting_acceptance");
    expect(accepted.toStatus).toBe("initiated");
    const acceptedRow = firstByTestId(`audit-trail-entry-${accepted.id}`);
    expect(acceptedRow.textContent ?? "").toContain("Vendor accepted invite");
    expect(acceptedRow.textContent ?? "").toContain(
      "By Vendor 2 Admin (vendor)",
    );

    // The Audit Trail header includes the count interpolation so the
    // i18n contract for `tickets.auditTrail` stays exercised on
    // mobile.
    expect(document.body.textContent ?? "").toContain("Audit Trail (4)");

    expect(alertSpy).not.toHaveBeenCalled();
  });
});
