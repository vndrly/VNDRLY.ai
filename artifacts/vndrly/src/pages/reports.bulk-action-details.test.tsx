import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BulkActionDetailsDialog renders inside the shared Dialog primitive,
// which pulls in PortalLogoOverlay → useAuth → the generated API
// client. None of that is relevant to the snapshot pagination flow
// under test, so we stub both the auth hook and the api-client to
// keep these tests focused on fetch + dialog state. Mirrors the
// same setup used in reports.bulk-undo.test.tsx.
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

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  BulkActionDetailsDialog,
  type QbBulkActionRow,
} from "./reports";

// ── Test helpers ─────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

function makeRow(overrides: Partial<QbBulkActionRow> = {}): QbBulkActionRow {
  return {
    id: 101,
    kind: "bulk_apply",
    summary: "Set Subcontracted Labor for 5 vendors",
    snapshotCount: 5,
    actorUserId: 1,
    actorRole: "admin",
    actorDisplayName: "Pat Admin",
    actorUsername: "pat",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    undoneAt: null,
    undoneByUserId: null,
    undoneByDisplayName: null,
    undoneByUsername: null,
    hasNewerOverlap: false,
    overlappingActionIds: [],
    expiresAt: FUTURE,
    isExpired: false,
    expiresSoon: false,
    affectedVendorIds: [],
    affectedPartnerIds: [],
    affectedIncludesGlobalVendor: false,
    affectedIncludesGlobalPartner: false,
    ...overrides,
  };
}

interface CellOverrides {
  vendorId?: number | null;
  vendorName?: string | null;
  partnerId?: number | null;
  partnerName?: string | null;
  lineType?: string;
  previous?: { accountName: string; accountNumber: string | null } | null;
  applied?: { accountName: string; accountNumber: string | null };
}

function makeCell(overrides: CellOverrides = {}) {
  return {
    vendorId: 10,
    vendorName: "Acme Drilling",
    partnerId: 20,
    partnerName: "Boggs Operating",
    lineType: "labor_regular",
    previous: { accountName: "Old Labor", accountNumber: "5000" },
    applied: { accountName: "New Labor", accountNumber: "5100" },
    ...overrides,
  };
}

interface DetailOverrides {
  id?: number;
  snapshotCount?: number;
  offset?: number;
  limit?: number;
  cells?: ReturnType<typeof makeCell>[];
}

function makeDetail(overrides: DetailOverrides = {}) {
  return {
    id: 101,
    kind: "bulk_apply" as const,
    summary: "Set Subcontracted Labor for 5 vendors",
    actorUserId: 1,
    actorRole: "admin",
    actorDisplayName: "Pat Admin",
    actorUsername: "pat",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    undoneAt: null,
    undoneByUserId: null,
    undoneByDisplayName: null,
    undoneByUsername: null,
    snapshotCount: 0,
    offset: 0,
    limit: 200,
    cells: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── BulkActionDetailsDialog component tests ──────────────────────

describe("BulkActionDetailsDialog", () => {
  it("renders one row per cell with vendor / partner / line type / previous / applied columns", async () => {
    const row = makeRow({ id: 800, snapshotCount: 3 });
    const detail = makeDetail({
      id: 800,
      snapshotCount: 3,
      offset: 0,
      limit: 200,
      cells: [
        makeCell({
          vendorName: "Acme Drilling",
          partnerName: "Boggs Operating",
          lineType: "labor_regular",
          previous: { accountName: "Old Labor", accountNumber: "5000" },
          applied: { accountName: "New Labor", accountNumber: "5100" },
        }),
        // vendorId/partnerId null → "All vendors" / "All partners"
        // labels, exercising the global-scope branch.
        makeCell({
          vendorId: null,
          vendorName: null,
          partnerId: null,
          partnerName: null,
          lineType: "parts",
          previous: null,
          applied: { accountName: "Materials", accountNumber: null },
        }),
        // Deleted vendor (id present, name missing) hits the
        // "Vendor #N (deleted)" fallback, and a previous == null
        // exercises the "(no override)" placeholder.
        makeCell({
          vendorId: 99,
          vendorName: null,
          partnerId: 88,
          partnerName: null,
          lineType: "mileage",
          previous: null,
          applied: { accountName: "Travel", accountNumber: "7300" },
        }),
      ],
    });

    vi.spyOn(global, "fetch").mockImplementation(async () =>
      jsonResponse(detail),
    );

    render(<BulkActionDetailsDialog row={row} onClose={vi.fn()} />);

    // First cell: real vendor + partner names, full previous → applied.
    await waitFor(() => screen.getByTestId("row-detail-0"));
    const row0 = screen.getByTestId("row-detail-0");
    expect(row0.textContent).toContain("Acme Drilling");
    expect(row0.textContent).toContain("Boggs Operating");
    expect(row0.textContent).toContain("labor_regular");
    expect(screen.getByTestId("cell-previous-0").textContent).toContain(
      "Old Labor",
    );
    expect(screen.getByTestId("cell-previous-0").textContent).toContain(
      "5000",
    );
    expect(screen.getByTestId("cell-applied-0").textContent).toContain(
      "New Labor",
    );
    expect(screen.getByTestId("cell-applied-0").textContent).toContain(
      "5100",
    );

    // Second cell: global scope → "All vendors" / "All partners",
    // and the no-previous branch shows the "(no override)" copy.
    const row1 = screen.getByTestId("row-detail-1");
    expect(row1.textContent).toContain("All vendors");
    expect(row1.textContent).toContain("All partners");
    expect(screen.getByTestId("cell-previous-1").textContent).toContain(
      "(no override)",
    );
    // Account number omitted on the applied side → just the name.
    expect(screen.getByTestId("cell-applied-1").textContent).toContain(
      "Materials",
    );

    // Third cell: deleted vendor/partner ids fall back to the
    // "#N (deleted)" labels so admins can still tell which row was
    // affected even if the FK is gone.
    const row2 = screen.getByTestId("row-detail-2");
    expect(row2.textContent).toContain("Vendor #99 (deleted)");
    expect(row2.textContent).toContain("Partner #88 (deleted)");

    // Range footer reflects the server-reported snapshotCount, not
    // the local cell array length, so admins know the slice they're
    // looking at vs the total touched cells.
    expect(screen.getByTestId("text-details-range").textContent).toContain(
      "3",
    );
  });

  it("paginates with Next / Prev using the right offset+limit", async () => {
    // 450 total cells → 3 pages at PAGE_SIZE=200.
    const TOTAL = 450;
    const row = makeRow({ id: 900, snapshotCount: TOTAL });

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const params = new URL(url, "http://x").searchParams;
        const offset = Number(params.get("offset") ?? "0");
        const limit = Number(params.get("limit") ?? "200");
        const remaining = Math.max(0, TOTAL - offset);
        const count = Math.min(limit, remaining);
        const cells = Array.from({ length: count }, (_, i) =>
          makeCell({
            vendorName: `Vendor ${offset + i}`,
            lineType: "labor_regular",
          }),
        );
        return Promise.resolve(
          jsonResponse(
            makeDetail({
              id: 900,
              snapshotCount: TOTAL,
              offset,
              limit,
              cells,
            }),
          ),
        );
      });

    render(<BulkActionDetailsDialog row={row} onClose={vi.fn()} />);

    // Initial fetch is page 1 → offset=0, limit=200. Row index uses
    // the GLOBAL offset, so the first row on page 1 is row-detail-0
    // and shows "Vendor 0".
    await waitFor(() => screen.getByTestId("row-detail-0"));
    expect(screen.getByTestId("row-detail-0").textContent).toContain(
      "Vendor 0",
    );

    const initialUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(
      initialUrls.some(
        (u) =>
          u.includes("/api/reports/qb-account-mapping/bulk-actions/900?") &&
          u.includes("offset=0") &&
          u.includes("limit=200"),
      ),
    ).toBe(true);

    // Prev should be disabled on the first page so admins can't
    // page into negative offsets.
    const prevBtn = screen.getByTestId(
      "button-details-prev",
    ) as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);

    // Click Next → offset jumps to 200 and the visible rows reflect
    // the second slice. The first rendered row's testid uses the
    // global index (200), proving pagination math is wired through.
    fireEvent.click(screen.getByTestId("button-details-next"));

    await waitFor(() => screen.getByTestId("row-detail-200"));
    expect(screen.getByTestId("row-detail-200").textContent).toContain(
      "Vendor 200",
    );

    const afterNextUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(
      afterNextUrls.some(
        (u) => u.includes("offset=200") && u.includes("limit=200"),
      ),
    ).toBe(true);

    // Now Prev should be live.
    expect(
      (screen.getByTestId("button-details-prev") as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // Click Next again → offset=400 (last page, only 50 rows).
    fireEvent.click(screen.getByTestId("button-details-next"));

    await waitFor(() => screen.getByTestId("row-detail-400"));
    const finalUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(
      finalUrls.some(
        (u) => u.includes("offset=400") && u.includes("limit=200"),
      ),
    ).toBe(true);

    // On the final page, Next should be disabled — totalPages=3,
    // safePage=2, so safePage >= totalPages-1.
    await waitFor(() => {
      expect(
        (screen.getByTestId("button-details-next") as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    // Click Prev → back to offset=200.
    fireEvent.click(screen.getByTestId("button-details-prev"));
    await waitFor(() => screen.getByTestId("row-detail-200"));
    const afterPrevUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(
      afterPrevUrls.filter(
        (u) => u.includes("offset=200") && u.includes("limit=200"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("highlights the matched substring inside cells when a search query is active", async () => {
    const row = makeRow({ id: 700, snapshotCount: 1 });
    const detail = makeDetail({
      id: 700,
      snapshotCount: 1,
      offset: 0,
      limit: 200,
      cells: [
        makeCell({
          // Mixed casing on each field to prove highlighting is
          // case-insensitive across the vendor / partner / line type
          // / previous / applied columns. The "<script>" segment is
          // never matched but proves the rendered output is React
          // text — never raw HTML — even when the cell text contains
          // angle brackets.
          vendorName: "ACME <script> Drilling",
          partnerName: "Boggs ACME Operating",
          lineType: "labor_acme",
          previous: { accountName: "Old ACME", accountNumber: "5000" },
          applied: { accountName: "New ACME", accountNumber: "5100" },
        }),
      ],
    });

    // Restrict the mock to the per-action snapshot URL so the
    // dialog's *other* mount-time fetches (`/api/vendors`,
    // `/api/partners`, `/downloads`) don't accidentally hand back
    // this snapshot payload — those code paths expect arrays /
    // download lists and would otherwise log noise.
    vi.spyOn(global, "fetch").mockImplementation(
      (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/bulk-actions/700?")) {
          return Promise.resolve(jsonResponse(detail));
        }
        return Promise.resolve(jsonResponse([]));
      },
    );

    render(<BulkActionDetailsDialog row={row} onClose={vi.fn()} />);

    await waitFor(() => screen.getByTestId("row-detail-0"));

    // No query yet → no highlights anywhere.
    expect(screen.queryAllByTestId("mark-details-highlight")).toHaveLength(
      0,
    );
    // The literal "<script>" must render as plain text inside the
    // cell, never as an actual <script> element — that's what makes
    // the highlight XSS-safe.
    expect(within(screen.getByTestId("row-detail-0")).queryByText(
      (_, el) => el?.tagName.toLowerCase() === "script",
    )).toBeNull();
    expect(screen.getByTestId("row-detail-0").textContent).toContain(
      "<script>",
    );

    // Type a lowercase "acme" → after the 250ms debounce a highlight
    // should appear in every column whose visible label contains it.
    fireEvent.change(screen.getByTestId("input-details-search"), {
      target: { value: "acme" },
    });

    await waitFor(
      () => {
        const marks = within(
          screen.getByTestId("row-detail-0"),
        ).getAllByTestId("mark-details-highlight");
        // 5 cells, each containing "acme" in some casing → 5 marks.
        expect(marks.length).toBe(5);
      },
      { timeout: 2000 },
    );

    // Each highlight preserves the ORIGINAL casing of the matched
    // substring (we only lowercased for the comparison, not for
    // rendering). So matching "acme" against "ACME Drilling" must
    // emit a <mark> reading "ACME", not "acme".
    const marks = within(screen.getByTestId("row-detail-0")).getAllByTestId(
      "mark-details-highlight",
    );
    const markTexts = marks.map((m) => m.textContent);
    expect(markTexts).toContain("ACME");
    expect(markTexts).toContain("acme");

    // Clearing the search box must remove every highlight so the
    // un-searched render path is unchanged.
    fireEvent.change(screen.getByTestId("input-details-search"), {
      target: { value: "" },
    });

    await waitFor(
      () => {
        expect(
          screen.queryAllByTestId("mark-details-highlight"),
        ).toHaveLength(0);
      },
      { timeout: 2000 },
    );
  });

  // CI runs the dialog through three full re-fetch cycles in this
  // test, and once the highlighting test was added to the file the
  // shared jsdom + radix overhead pushed the worst case past the
  // default 5s vitest timeout. Bumping just this case keeps the
  // intent clear without relaxing the file-wide budget.
  it("resets to page 1 when a different action is opened", async () => {
    const TOTAL_A = 450;
    const TOTAL_B = 50;

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        const idMatch = url.match(/bulk-actions\/(\d+)\?/);
        const id = Number(idMatch?.[1] ?? 0);
        const params = new URL(url, "http://x").searchParams;
        const offset = Number(params.get("offset") ?? "0");
        const total = id === 1001 ? TOTAL_A : TOTAL_B;
        const remaining = Math.max(0, total - offset);
        const count = Math.min(200, remaining);
        const cells = Array.from({ length: count }, (_, i) =>
          makeCell({ vendorName: `Action${id} Vendor ${offset + i}` }),
        );
        return Promise.resolve(
          jsonResponse(
            makeDetail({
              id,
              snapshotCount: total,
              offset,
              limit: 200,
              cells,
            }),
          ),
        );
      });

    const rowA = makeRow({ id: 1001, snapshotCount: TOTAL_A });
    const rowB = makeRow({ id: 1002, snapshotCount: TOTAL_B });

    const { rerender } = render(
      <BulkActionDetailsDialog row={rowA} onClose={vi.fn()} />,
    );

    // Page through to page 3 of action A (offset=400).
    await waitFor(() => screen.getByTestId("row-detail-0"));
    fireEvent.click(screen.getByTestId("button-details-next"));
    await waitFor(() => screen.getByTestId("row-detail-200"));
    fireEvent.click(screen.getByTestId("button-details-next"));
    await waitFor(() => screen.getByTestId("row-detail-400"));

    // Sanity: an offset=400 fetch happened for action 1001.
    expect(
      fetchSpy.mock.calls.some((c) => {
        const u = String(c[0]);
        return (
          u.includes("/bulk-actions/1001?") && u.includes("offset=400")
        );
      }),
    ).toBe(true);

    const callsBefore = fetchSpy.mock.calls.length;

    // Now switch to a *different* action. The dialog must reset
    // page back to 0 — otherwise admins opening a small 50-cell
    // action after browsing a big 5,000-cell one would land on an
    // empty/clamped page with no rows to look at.
    rerender(<BulkActionDetailsDialog row={rowB} onClose={vi.fn()} />);

    await waitFor(() => screen.getByTestId("row-detail-0"));

    const newCalls = fetchSpy.mock.calls.slice(callsBefore).map((c) =>
      String(c[0]),
    );
    // After the reset effect fires, the dialog must end up issuing a
    // page-1 fetch (offset=0) for the newly-opened action — that's
    // what guarantees the user lands on the first page of the new
    // action even though they had paged deep into the previous one.
    expect(
      newCalls.some(
        (u) =>
          u.includes("/bulk-actions/1002?") && u.includes("offset=0"),
      ),
    ).toBe(true);

    // Visible content reflects action 1002's first page — so the
    // settled state really is page 1, not whatever page the user
    // had been browsing for the previous action.
    expect(screen.getByTestId("row-detail-0").textContent).toContain(
      "Action1002 Vendor 0",
    );
  }, 30_000);

  it("forwards the active search query into the Download CSV link so the download mirrors the filtered list", async () => {
    // The dialog's CSV download is a plain <a href>; this test
    // proves that typing into the search box updates that href to
    // include `q=` (and `format=csv`) so admins who narrow a
    // 5,000-cell snapshot down to a handful actually receive only
    // those matching rows in the CSV they share with their
    // accountant — not the full snapshot.
    const row = makeRow({ id: 4242, snapshotCount: 1 });
    const detail = makeDetail({
      id: 4242,
      snapshotCount: 1,
      offset: 0,
      limit: 200,
      cells: [
        makeCell({
          vendorName: "Acme Drilling",
          partnerName: "Boggs Operating",
          lineType: "labor_regular",
        }),
      ],
    });

    // Use a per-call implementation so the dialog's downloads-list
    // fetch (`/bulk-actions/:id/downloads`) doesn't share a
    // already-consumed Response body with the snapshot fetch — and
    // so we can hand the downloads endpoint back a sane empty list.
    vi.spyOn(global, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/downloads")) {
        return Promise.resolve(
          jsonResponse({ downloadCount: 0, downloads: [] }),
        );
      }
      return Promise.resolve(jsonResponse(detail));
    });

    render(<BulkActionDetailsDialog row={row} onClose={vi.fn()} />);

    await waitFor(() => screen.getByTestId("row-detail-0"));

    const downloadLink = screen.getByTestId(
      "link-details-download-csv",
    ) as HTMLAnchorElement;

    // Empty search → no `q=` in the CSV URL, but still requests CSV.
    expect(downloadLink.href).toContain("/bulk-actions/4242?");
    expect(downloadLink.href).toContain("format=csv");
    expect(downloadLink.href).not.toMatch(/[?&]q=/);

    // Typing a query (debounced 250ms before it is "applied") must
    // flow into the CSV link so a downloaded file matches what the
    // user sees in the table.
    const searchBox = screen.getByTestId(
      "input-details-search",
    ) as HTMLInputElement;
    fireEvent.change(searchBox, { target: { value: "acme" } });

    await waitFor(() => {
      const link = screen.getByTestId(
        "link-details-download-csv",
      ) as HTMLAnchorElement;
      expect(link.href).toMatch(/[?&]q=acme(?:&|$)/);
      expect(link.href).toContain("format=csv");
    });
  });
});
