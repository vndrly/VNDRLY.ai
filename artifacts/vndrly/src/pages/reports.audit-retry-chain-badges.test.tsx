import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuditCard mounts the shared Dialog primitive (via AuditDetailDialog), which
// renders a PortalLogoOverlay that talks to useAuth + the generated API
// client. None of that is relevant to the retry-chain badge rendering under
// test, and wiring real providers would require a query client + an
// /api/auth/me fetch we don't need. Stubbing both keeps this test focused on
// the "Retry of #N" / "Retried by #N" badges and the anchor-jump fetch.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      userId: 1,
      role: "admin",
      displayName: "Admin",
      partnerId: null,
      vendorId: null,
      preferredLanguage: "en",
      activeMembershipId: null,
      availableMemberships: [],
      requiresContextChoice: false,
    },
    isLoading: false,
    login: async () => {},
    logout: async () => {},
    setPreferredLanguage: () => {},
    switchContext: async () => {},
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPartner: () => ({ data: undefined }),
  useGetVendor: () => ({ data: undefined }),
  getGetPartnerQueryKey: () => ["partner"],
  getGetVendorQueryKey: () => ["vendor"],
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuditCard } from "./reports";

interface AuditRowSeed {
  id: number;
  reportKind: string;
  format: string;
  rowCount: number | null;
  fileBytes: number;
  userRole: string;
  downloadedByUserId: number | null;
  createdAt: string;
  scope: Record<string, unknown>;
  detailJson: { warnings?: unknown[] } | null;
  retryChain?: number[];
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function seedRow(
  id: number,
  retriedFromAuditId: number | null = null,
): AuditRowSeed {
  const scope: Record<string, unknown> = { period: "2026-Q1" };
  if (retriedFromAuditId !== null) {
    scope.retriedFromAuditId = retriedFromAuditId;
  }
  // Larger ids are newer, matching the desc(createdAt), desc(id) ordering
  // the server uses. The exact seconds don't matter for these assertions
  // but giving each row a distinct timestamp makes failures easier to read.
  const createdAt = new Date(2026, 0, 1, 12, 0, id).toISOString();
  return {
    id,
    reportKind: "qb_invoice_push",
    format: "qbo_api_push",
    rowCount: 1,
    fileBytes: 0,
    userRole: "admin",
    downloadedByUserId: 1,
    createdAt,
    scope,
    detailJson: { warnings: [] },
  };
}

// Shared fixture used by every test in this file. Six in-window rows plus
// three chainRows entries cover, in a single response:
//
//   * In-window retry → in-window parent (rows 100 → 90):
//       - row 100 renders "Retry of #90" (in-window)
//       - row 90  renders "Retried by #100" (in-window)
//   * In-window retry → off-page parent (row 50 → 40):
//       - row 50 renders "Retry of #40", clickable (40 is in chainRows)
//   * In-window parent ← off-page descendant (row 60 ← 200):
//       - row 60 renders "Retried by #200" (200 is in chainRows)
//   * In-window parent ← warnings-hidden descendant (row 70 ← 210):
//       - row 70 renders "Retried by #210" (210 is in chainRows; in
//         production the warnings filter would have hidden it from `rows`)
//
// chainRows entries (40, 200, 210) must NOT render as their own table
// rows — they're metadata-only and only contribute to retriedByMap /
// rowsById.
function buildPage1Response() {
  return {
    rows: [
      seedRow(100, 90),
      seedRow(90, null),
      seedRow(70, null),
      seedRow(60, null),
      seedRow(50, 40),
    ],
    chainRows: [
      seedRow(40, null),
      seedRow(200, 60),
      seedRow(210, 70),
    ],
    page: 1,
    pageSize: 100,
    totalRows: 200,
    totalWithWarnings: 0,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom does not implement scrollIntoView, but the in-window jump path
  // calls it synchronously after the row is located. Stub it as a no-op so
  // the click handler doesn't crash before we can assert on the next fetch.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  // AuditCard reads the initial filter / anchor / warnings state from the
  // URL (so a deep link survives a refresh) and writes back to it via
  // history.replaceState every time those change. JSDOM keeps a single
  // window across tests, so without resetting we'd carry an `?anchor=…`
  // from the previous click test into the next render and the initial
  // fetch would fire with `anchorId=…` instead of `page=1`.
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The retry-chain UI in AuditCard depends on three intertwined memos
// (`retriedByMap`, `knownIds`, `rowsById`) plus the
// `pendingAnchorId` → `anchorId` request dance. Server-side coverage for
// the chain enrichment lives in
// artifacts/api-server/src/routes/reports-exports-audit-retry-chain.test.ts;
// this file exercises the matching client surface end-to-end.
describe("AuditCard retry-chain badges — rendering", () => {
  it("renders Retry of / Retried by badges for in-window, off-page, and warnings-hidden chain members", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(buildPage1Response()),
    );

    render(<AuditCard />);

    await waitFor(() => {
      expect(screen.getByTestId("row-audit-100")).toBeTruthy();
    });

    // ── In-window: both ends of the 90 → 100 retry hop are in `rows`, so
    //    the badge resolves the target via knownIds and the hint promises
    //    an in-page jump.
    expect(screen.getByTestId("button-retry-of-100").textContent).toContain(
      "Retry of #90",
    );
    expect(screen.getByTestId("button-retry-of-100").getAttribute("title")).toBe(
      "Jump to the original sync this row retried.",
    );
    expect(
      screen.getByTestId("button-retried-by-90-100").textContent,
    ).toContain("Retried by #100");
    expect(
      screen.getByTestId("button-retried-by-90-100").getAttribute("title"),
    ).toBe("Jump to the later sync that re-ran this row.");

    // ── Off-page parent: row 50's parent (40) is only present via
    //    chainRows. The badge still renders, but the hint promises a
    //    follow-up page load — the user-visible signal of the
    //    knownIds.has(...) === false branch.
    expect(screen.getByTestId("button-retry-of-50").textContent).toContain(
      "Retry of #40",
    );
    expect(screen.getByTestId("button-retry-of-50").getAttribute("title")).toBe(
      "Click to load the page containing the original sync.",
    );

    // ── Off-page descendant: row 60's retry (200) lives off the current
    //    page but the server pulled it into chainRows. retriedByMap walks
    //    `[...rows, ...chainRows]`, so row 60 still advertises
    //    "Retried by #200". This is the regression-prone path: drop the
    //    chainRows merge in retriedByMap and this badge silently vanishes.
    expect(
      screen.getByTestId("button-retried-by-60-200").textContent,
    ).toContain("Retried by #200");
    expect(
      screen.getByTestId("button-retried-by-60-200").getAttribute("title"),
    ).toBe("Click to load the page containing the later sync.");

    // ── Warnings-hidden descendant: same chainRows path as 60 ← 200, but
    //    standing in for the "warnings filter hid the successful retry"
    //    case the server explicitly handles. Row 210 doesn't render as
    //    its own table row, but row 70 still gets the "Retried by #210"
    //    badge. Without chainRows, an admin filtering for warnings would
    //    never know the failed sync was already resolved.
    expect(
      screen.getByTestId("button-retried-by-70-210").textContent,
    ).toContain("Retried by #210");

    // chainRows entries themselves must NOT render as table rows — only
    // their badges leak into the in-window parent rows. Guards against a
    // regression where chainRows accidentally gets unioned into `rows`
    // for rendering.
    expect(screen.queryByTestId("row-audit-40")).toBeNull();
    expect(screen.queryByTestId("row-audit-200")).toBeNull();
    expect(screen.queryByTestId("row-audit-210")).toBeNull();
  });
});

describe("AuditCard retry-chain badges — click behaviour", () => {
  it("does not re-fetch when an in-window badge is clicked (knownIds short-circuit)", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse(buildPage1Response()));

    render(<AuditCard />);

    await waitFor(() => {
      expect(screen.getByTestId("button-retry-of-100")).toBeTruthy();
    });

    // jumpToAuditId short-circuits to scrollToRow when knownIds has the
    // target id, so the only fetch on record should still be the initial
    // page-1 load. Asserting on the call count locks in the
    // "no needless network" promise of the in-window path for both
    // badge directions.
    const callsBefore = fetchSpy.mock.calls.length;
    fireEvent.click(screen.getByTestId("button-retry-of-100"));
    fireEvent.click(screen.getByTestId("button-retried-by-90-100"));
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it("fetches with anchorId when 'Retry of #N' targets a chainRows-only parent", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(jsonResponse(buildPage1Response()));
    // The anchor response: server resolves row 40 onto page 2 and echoes
    // it in `rows` so the user lands on the linked row.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        rows: [seedRow(40, null), seedRow(35, null)],
        chainRows: [],
        page: 2,
        pageSize: 100,
        totalRows: 200,
        totalWithWarnings: 0,
        anchorId: 40,
      }),
    );

    render(<AuditCard />);

    await waitFor(() => {
      expect(screen.getByTestId("button-retry-of-50")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-retry-of-50"));

    await waitFor(() => {
      const lastCall = fetchSpy.mock.calls.at(-1);
      expect(lastCall, "expected an anchor fetch to fire").toBeTruthy();
      const url = String(lastCall![0]);
      expect(url).toContain("/api/reports/exports/audit");
      expect(url).toContain("anchorId=40");
      // The anchor fetch must drop the `page` query param — otherwise the
      // server can't reliably resolve the target's page.
      expect(url).not.toMatch(/[?&]page=/);
    });

    // The user-visible payoff: row 40 is now in the table and the row
    // that triggered the jump (50) has scrolled off the current page.
    await waitFor(() => {
      expect(screen.getByTestId("row-audit-40")).toBeTruthy();
    });
    expect(screen.queryByTestId("row-audit-50")).toBeNull();
  });

  it("fetches with anchorId when 'Retried by #N' targets a chainRows-only descendant (off-page)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(jsonResponse(buildPage1Response()));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        rows: [seedRow(200, 60), seedRow(195, null)],
        // The parent (60) and any sibling chain members slide into
        // chainRows on the new page so the "Retry of #60" badge can
        // resolve from row 200's perspective.
        chainRows: [seedRow(60, null)],
        page: 1,
        pageSize: 100,
        totalRows: 200,
        totalWithWarnings: 0,
        anchorId: 200,
      }),
    );

    render(<AuditCard />);

    await waitFor(() => {
      expect(screen.getByTestId("button-retried-by-60-200")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-retried-by-60-200"));

    await waitFor(() => {
      const lastCall = fetchSpy.mock.calls.at(-1);
      expect(lastCall, "expected an anchor fetch to fire").toBeTruthy();
      const url = String(lastCall![0]);
      expect(url).toContain("anchorId=200");
      expect(url).not.toMatch(/[?&]page=/);
    });

    await waitFor(() => {
      expect(screen.getByTestId("row-audit-200")).toBeTruthy();
    });
    // The previously-visible parent has scrolled off — proves the table
    // actually re-rendered with the anchor response, not just appended.
    expect(screen.queryByTestId("row-audit-60")).toBeNull();
  });

  it("still renders 'Retried by #N' via chainRows after toggling hasWarnings=true filters the linked retry out of rows", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    // Initial unfiltered load — full fixture, row 70 is in `rows` and its
    // descendant 210 lives in chainRows.
    fetchSpy.mockResolvedValueOnce(jsonResponse(buildPage1Response()));
    // After the user flips on the warnings switch, the server applies
    // `hasWarnings=true` and returns only the failing parent row (70).
    // The successful retry (210) that resolved it is not present in
    // `rows` — it never had warnings — so the only way the
    // "Retried by #210" badge can still light up is if AuditCard walks
    // `chainRows` when building retriedByMap. This is the regression we
    // care about: drop chainRows from that memo and an admin filtering
    // for unresolved warnings would be blind to which failures were
    // already fixed by a later sync.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        rows: [seedRow(70, null)],
        chainRows: [seedRow(210, 70)],
        page: 1,
        pageSize: 100,
        totalRows: 1,
        totalWithWarnings: 1,
      }),
    );

    render(<AuditCard />);

    await waitFor(() => {
      expect(screen.getByTestId("row-audit-70")).toBeTruthy();
    });

    // Toggle the warnings-only switch. The component fires a fresh
    // request with hasWarnings=true, which our second mock answers.
    fireEvent.click(screen.getByTestId("switch-audit-only-warnings"));

    await waitFor(() => {
      const lastCall = fetchSpy.mock.calls.at(-1);
      expect(lastCall, "expected a refetch after toggling warnings").toBeTruthy();
      const url = String(lastCall![0]);
      expect(url).toContain("/api/reports/exports/audit");
      expect(url).toContain("hasWarnings=true");
    });

    // The descendant retry (210) must NOT have been pulled into the
    // visible row list — that's the point of the warnings filter.
    await waitFor(() => {
      expect(screen.queryByTestId("row-audit-210")).toBeNull();
    });

    // …yet the parent row's "Retried by #210" badge still renders,
    // sourced exclusively from chainRows.
    expect(
      screen.getByTestId("button-retried-by-70-210").textContent,
    ).toContain("Retried by #210");
    expect(
      screen.getByTestId("button-retried-by-70-210").getAttribute("title"),
    ).toBe("Click to load the page containing the later sync.");
  });

  it("fetches with anchorId when 'Retried by #N' targets a warnings-hidden chain member", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    fetchSpy.mockResolvedValueOnce(jsonResponse(buildPage1Response()));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        rows: [seedRow(210, 70), seedRow(205, null)],
        chainRows: [seedRow(70, null)],
        page: 1,
        pageSize: 100,
        totalRows: 200,
        totalWithWarnings: 0,
        anchorId: 210,
      }),
    );

    render(<AuditCard />);

    await waitFor(() => {
      expect(screen.getByTestId("button-retried-by-70-210")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("button-retried-by-70-210"));

    await waitFor(() => {
      const lastCall = fetchSpy.mock.calls.at(-1);
      expect(lastCall, "expected an anchor fetch to fire").toBeTruthy();
      const url = String(lastCall![0]);
      expect(url).toContain("anchorId=210");
      expect(url).not.toMatch(/[?&]page=/);
    });

    await waitFor(() => {
      expect(screen.getByTestId("row-audit-210")).toBeTruthy();
    });
    expect(screen.queryByTestId("row-audit-70")).toBeNull();
  });
});
