import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The bulk-actions history dialog and the QB account-mapping card both
// pull in the shared Dialog primitive, which renders a PortalLogoOverlay
// that talks to useAuth + the generated API client. None of that is
// relevant to the undo flow under test, and wiring real providers would
// require a query client + an /api/auth/me fetch we don't need. Stubbing
// both keeps these tests focused on the undo-banner / overlap-warning
// behaviour.
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
import {
  BulkActionsHistoryDialog,
  QbAccountMappingCard,
  type QbBulkActionRow,
} from "./reports";

// ── Test helpers ─────────────────────────────────────────────────

// Far enough in the future that the wall-clock expiry check inside the
// dialog won't tip the row into the "Undo expired" branch mid-test.
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

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/** Build a deferred promise so we can hold a fetch open mid-test and
 *  assert on the in-flight UI state. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── BulkActionsHistoryDialog component tests ─────────────────────

describe("BulkActionsHistoryDialog", () => {
  it("renders the per-row overlap warning when hasNewerOverlap is true", async () => {
    const overlappingRow = makeRow({
      id: 200,
      hasNewerOverlap: true,
      overlappingActionIds: [201, 202],
    });
    const cleanRow = makeRow({
      id: 201,
      hasNewerOverlap: false,
      summary: "Untouched action",
    });

    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ rows: [overlappingRow, cleanRow], retentionDays: 90 }),
    );

    render(
      <BulkActionsHistoryDialog
        open={true}
        onOpenChange={vi.fn()}
        onAfterUndo={vi.fn()}
      />,
    );

    // The amber overlap warning is keyed by row id and only renders for
    // rows that the server flagged with hasNewerOverlap. The "clean"
    // row should not get one even though it's a sibling in the same
    // table — guards against a regression where the warning leaks
    // across rows.
    await waitFor(() => {
      // getByTestId throws if absent, so a successful resolution is
      // proof the overlap warning rendered for row 200.
      screen.getByTestId("text-overlap-200");
    });
    expect(screen.queryByTestId("text-overlap-201")).toBeNull();
    expect(screen.getByTestId("text-overlap-200").textContent).toContain(
      "newer change",
    );

    // Undo is rendered as the muted "outline" variant (instead of the
    // default emphasised button) when overlap is present, so admins
    // get a visual nudge before the confirm dialog appears. We don't
    // assert the variant directly, but the button must still be there
    // and enabled so the flow proceeds.
    const undoBtn = screen.getByTestId(
      "button-undo-200",
    ) as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);
  });

  it("disables the Undo button while a request is in flight", async () => {
    const row = makeRow({ id: 300 });
    const fetchSpy = vi.spyOn(global, "fetch");

    // Initial bulk-actions list load: resolve immediately.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ rows: [row], retentionDays: 90 }),
    );
    // The undo POST: hold open until we resolve manually so we can
    // observe the in-flight state.
    const undoCall = deferred<Response>();
    fetchSpy.mockReturnValueOnce(undoCall.promise);

    const onAfterUndo = vi.fn();
    render(
      <BulkActionsHistoryDialog
        open={true}
        onOpenChange={vi.fn()}
        onAfterUndo={onAfterUndo}
      />,
    );

    const undoBtn = await waitFor(
      () => screen.getByTestId("button-undo-300") as HTMLButtonElement,
    );
    expect(undoBtn.disabled).toBe(false);

    fireEvent.click(undoBtn);

    // Once the request is in flight the button must lock so we can't
    // queue duplicate undo POSTs against the same snapshot id, and the
    // label flips to the "Undoing…" copy.
    await waitFor(() => {
      const live = screen.getByTestId("button-undo-300") as HTMLButtonElement;
      expect(live.disabled).toBe(true);
      expect(live.textContent).toContain("Undoing");
    });

    // The undo hasn't completed, so the parent's onAfterUndo callback
    // must not have fired yet.
    expect(onAfterUndo).not.toHaveBeenCalled();

    // Let the request settle so the test doesn't leak an open fetch.
    undoCall.resolve(jsonResponse({ restored: 5, removed: 0 }));
  });

  it("fires onAfterUndo after a successful undo", async () => {
    const row = makeRow({ id: 400 });
    const fetchSpy = vi.spyOn(global, "fetch");

    // 1) Initial GET of the bulk-actions list.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ rows: [row], retentionDays: 90 }),
    );
    // 2) POST /undo succeeds.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ restored: 5, removed: 0 }),
    );
    // 3) Post-undo reload of the bulk-actions list (the dialog calls
    //    reload() internally before invoking onAfterUndo). Return the
    //    same row marked as undone so the table state is plausible.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        rows: [
          {
            ...row,
            undoneAt: new Date().toISOString(),
            undoneByDisplayName: "Pat Admin",
            undoneByUsername: "pat",
            undoneByUserId: 1,
          },
        ],
        retentionDays: 90,
      }),
    );

    const onAfterUndo = vi.fn();
    render(
      <BulkActionsHistoryDialog
        open={true}
        onOpenChange={vi.fn()}
        onAfterUndo={onAfterUndo}
      />,
    );

    const undoBtn = await waitFor(
      () => screen.getByTestId("button-undo-400") as HTMLButtonElement,
    );
    fireEvent.click(undoBtn);

    await waitFor(() => {
      expect(onAfterUndo).toHaveBeenCalledTimes(1);
    });

    // The bulk-actions endpoint must have been re-fetched as part of the
    // dialog's own refresh, so admins see the new "undone" status
    // without needing to close + reopen the dialog.
    const undoUrls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(
      undoUrls.filter((u) =>
        u.includes("/api/reports/qb-account-mapping/bulk-actions?limit=100"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      undoUrls.some((u) =>
        u.includes(
          "/api/reports/qb-account-mapping/bulk-actions/400/undo",
        ),
      ),
    ).toBe(true);
  });
});

// ── Banner refresh integration test ──────────────────────────────

describe("QbAccountMappingCard undo banner", () => {
  it("refreshes the mapping table and the banner action after a successful undo", async () => {
    const initialRow = makeRow({
      id: 500,
      summary: "Set Job Materials for 3 vendors",
    });
    const refreshedRow = makeRow({
      id: 501,
      summary: "Updated summary after undo",
    });

    const calls: string[] = [];
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push(url);
        if (url.includes("/api/vendors")) {
          return Promise.resolve(jsonResponse([]));
        }
        if (url.includes("/api/partners")) {
          return Promise.resolve(jsonResponse([]));
        }
        if (
          url.includes(
            "/api/reports/qb-account-mapping/bulk-actions/500/undo",
          )
        ) {
          return Promise.resolve(
            jsonResponse({ restored: 3, removed: 0 }),
          );
        }
        if (
          url.includes(
            "/api/reports/qb-account-mapping/bulk-actions?limit=10",
          )
        ) {
          // First call returns the original action so the banner shows;
          // subsequent calls (after the undo) return a different row to
          // prove reloadLatestAction actually re-fetched. The Set keeps
          // membership concise without us having to track call count
          // explicitly.
          const seenBefore = calls
            .slice(0, -1)
            .some((u) =>
              u.includes(
                "/api/reports/qb-account-mapping/bulk-actions?limit=10",
              ),
            );
          return Promise.resolve(
            jsonResponse({
              rows: [seenBefore ? refreshedRow : initialRow],
              retentionDays: 90,
            }),
          );
        }
        if (url.includes("/api/reports/qb-account-mapping")) {
          return Promise.resolve(jsonResponse({ items: [] }));
        }
        return Promise.resolve(jsonResponse({}));
      });

    render(<QbAccountMappingCard />);

    // Banner waits on the bulk-actions fetch; once it resolves the
    // initial summary should be visible so admins know there is
    // something to undo.
    const summary = await waitFor(() =>
      screen.getByTestId("text-bulk-undo-summary"),
    );
    expect(summary.textContent).toContain("Set Job Materials for 3 vendors");

    const before = calls.length;

    fireEvent.click(screen.getByTestId("button-undo-bulk"));

    // After the undo succeeds the banner content must reflect the
    // refreshed row, not a stale copy of the original. That requires
    // both reload() (the mapping table) and reloadLatestAction() (the
    // banner) to have re-fired.
    await waitFor(() => {
      expect(
        screen.getByTestId("text-bulk-undo-summary").textContent,
      ).toContain("Updated summary after undo");
    });

    const newCalls = calls.slice(before);
    // Reload of the mapping table.
    expect(
      newCalls.some(
        (u) =>
          u.includes("/api/reports/qb-account-mapping") &&
          !u.includes("/bulk-actions"),
      ),
    ).toBe(true);
    // Re-pull of the latest bulk action so the banner is fresh.
    expect(
      newCalls.some((u) =>
        u.includes("/api/reports/qb-account-mapping/bulk-actions?limit=10"),
      ),
    ).toBe(true);
    // And of course the undo POST itself happened exactly once.
    expect(
      newCalls.filter((u) =>
        u.includes(
          "/api/reports/qb-account-mapping/bulk-actions/500/undo",
        ),
      ).length,
    ).toBe(1);

    fetchSpy.mockRestore();
  });
});

// ── History trigger active-count badge ───────────────────────────

describe("QbAccountMappingCard history badge", () => {
  it("shows the count of active (not undone, not expired) bulk actions next to the History trigger and refreshes after an undo", async () => {
    // Build a mix of rows so the badge has to actually filter:
    // - 2 active rows (no undoneAt, expiresAt in the future)
    // - 1 undone row (should NOT count)
    // - 1 expired row (should NOT count)
    const PAST = new Date(Date.now() - 60_000).toISOString();
    const activeA = makeRow({ id: 600, summary: "Active A" });
    const activeB = makeRow({ id: 601, summary: "Active B" });
    const undoneRow = makeRow({
      id: 602,
      summary: "Undone row",
      undoneAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const expiredRow = makeRow({
      id: 603,
      summary: "Expired row",
      expiresAt: PAST,
      isExpired: true,
    });

    // After we click Undo on row 600 the badge should drop from 2 → 1.
    let undoHappened = false;

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/vendors") || url.includes("/api/partners")) {
          return Promise.resolve(jsonResponse([]));
        }
        if (
          url.includes("/api/reports/qb-account-mapping/bulk-actions/600/undo")
        ) {
          undoHappened = true;
          return Promise.resolve(jsonResponse({ restored: 1, removed: 0 }));
        }
        if (
          url.includes("/api/reports/qb-account-mapping/bulk-actions?limit=100")
        ) {
          // After an undo, return activeA marked as undone so the count
          // drops; activeB stays active. The badge driver counts rows
          // with undoneAt == null and expiresAt > now, so this proves
          // the refresh is wired through.
          const rows = undoHappened
            ? [
                {
                  ...activeA,
                  undoneAt: new Date().toISOString(),
                  undoneByDisplayName: "Pat Admin",
                },
                activeB,
                undoneRow,
                expiredRow,
              ]
            : [activeA, activeB, undoneRow, expiredRow];
          return Promise.resolve(
            jsonResponse({
              rows,
              retentionDays: 90,
              expiresSoonDays: 7,
            }),
          );
        }
        if (
          url.includes("/api/reports/qb-account-mapping/bulk-actions?limit=10")
        ) {
          return Promise.resolve(
            jsonResponse({
              rows: [undoHappened ? activeB : activeA],
              retentionDays: 90,
            }),
          );
        }
        if (
          url.includes(
            "/api/reports/qb-account-mapping/bulk-actions/cleanup-audit",
          )
        ) {
          return Promise.resolve(jsonResponse({ rows: [] }));
        }
        if (url.includes("/api/reports/qb-account-mapping")) {
          return Promise.resolve(jsonResponse({ items: [] }));
        }
        return Promise.resolve(jsonResponse({}));
      });

    render(<QbAccountMappingCard />);

    // Badge should appear with "2 active" once the limit=100 fetch
    // resolves; undone + expired rows are filtered out by the same
    // rule the History dialog uses.
    const badge = await waitFor(() =>
      screen.getByTestId("badge-bulk-history-active"),
    );
    expect(badge.textContent).toContain("2");

    // Now click the in-card Undo to roll back the most recent active
    // row. This drives QbAccountMappingCard → handleUndoLatest, which
    // must call reloadActiveBulkActionCount() so the badge drops.
    fireEvent.click(screen.getByTestId("button-undo-bulk"));

    await waitFor(() => {
      expect(
        screen.getByTestId("badge-bulk-history-active").textContent,
      ).toContain("1");
    });

    fetchSpy.mockRestore();
  });

  it("hides the badge entirely when there are no active bulk actions", async () => {
    // Only undone and expired rows — nothing actively undoable.
    const PAST = new Date(Date.now() - 60_000).toISOString();
    const undoneRow = makeRow({
      id: 700,
      undoneAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const expiredRow = makeRow({
      id: 701,
      expiresAt: PAST,
      isExpired: true,
    });

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/vendors") || url.includes("/api/partners")) {
          return Promise.resolve(jsonResponse([]));
        }
        if (
          url.includes("/api/reports/qb-account-mapping/bulk-actions?limit=100")
        ) {
          return Promise.resolve(
            jsonResponse({
              rows: [undoneRow, expiredRow],
              retentionDays: 90,
              expiresSoonDays: 7,
            }),
          );
        }
        if (
          url.includes("/api/reports/qb-account-mapping/bulk-actions?limit=10")
        ) {
          return Promise.resolve(
            jsonResponse({ rows: [], retentionDays: 90 }),
          );
        }
        if (url.includes("/api/reports/qb-account-mapping")) {
          return Promise.resolve(jsonResponse({ items: [] }));
        }
        return Promise.resolve(jsonResponse({}));
      });

    render(<QbAccountMappingCard />);

    // Wait for the History trigger itself to render (proves the card
    // mounted and the limit=100 fetch had a chance to resolve).
    await waitFor(() => screen.getByTestId("button-bulk-history"));

    // Give the badge fetch a tick to settle, then assert the badge
    // is *not* present — zero active actions means no clutter on the
    // toolbar.
    await waitFor(() => {
      expect(screen.queryByTestId("badge-bulk-history-active")).toBeNull();
    });

    fetchSpy.mockRestore();
  });
});
