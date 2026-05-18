import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuditCard pulls in the shared Dialog primitive (via AuditDetailDialog),
// which renders a PortalLogoOverlay that talks to useAuth + the generated
// API client. None of that is relevant to the reconciliation-link path
// under test, so stub them out the same way the sibling AuditCard tests do.
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
import { AuditCard, PushResultPanel } from "./reports";

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

// ── AuditDetailDialog: per-invoice link + per-state badge ─────────

describe("AuditDetailDialog reconciliation links", () => {
  it("renders per-invoice link and period-aware per-state badge with the expected hrefs", async () => {
    // Audit row mixes a per-invoice reconciliation drift warning (INV-42)
    // with a per-state aggregate (CA). Scope carries vendorId (so the
    // invoice link is enabled) and a period (so the state badge can
    // deep-link into Sales-Tax-by-State).
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        rows: [
          {
            id: 7,
            reportKind: "vendor.quickbooksPush",
            format: "qbo_api_push",
            rowCount: 1,
            fileBytes: 0,
            userRole: "admin",
            downloadedByUserId: 1,
            createdAt: new Date().toISOString(),
            scope: {
              vendorId: 99,
              periodStart: "2025-01-01T00:00:00.000Z",
              periodEnd: "2025-02-01T00:00:00.000Z",
            },
            detailJson: {
              warnings: [
                {
                  kind: "invoice",
                  identifier: "INV-42",
                  message:
                    "reconciliation: QuickBooks total 12.00 does not match posted total 13.00",
                },
                {
                  kind: "invoice",
                  identifier: "(state:CA)",
                  message:
                    "reconciliation: QuickBooks tax for CA totals 1.00 but VNDRLY's Sales-Tax-by-State report shows 1.50",
                },
              ],
            },
          },
        ],
        chainRows: [],
        page: 1,
        pageSize: 100,
        totalRows: 1,
        totalWithWarnings: 1,
      }),
    );

    render(<AuditCard />);

    fireEvent.click(await screen.findByTestId("link-audit-details-7"));

    // Per-invoice link: rendered as a button (window.open is called on
    // click, so we don't have a static href to assert) — assert the
    // testid + label so a refactor of the cell is caught.
    const invoiceBtn = await screen.findByTestId(
      "link-audit-reconciliation-invoice-0",
    );
    expect(invoiceBtn.tagName).toBe("BUTTON");
    expect(invoiceBtn.textContent).toContain("INV-42");

    // Click should call window.open synchronously (popup-blocker dance)
    // followed by a fetch to /api/invoices?invoiceNumber=INV-42&...
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse({ items: [{ id: 555 }] }));

    fireEvent.click(invoiceBtn);

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      "noopener",
    );
    // The audit-card may refetch on its own polling cadence — what
    // matters is that exactly one /api/invoices?invoiceNumber=… call
    // was triggered by our click, with the expected query params.
    const invoiceCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/api/invoices?invoiceNumber="),
    );
    expect(invoiceCalls).toHaveLength(1);
    const calledUrl = String(invoiceCalls[0][0]);
    expect(calledUrl).toContain("invoiceNumber=INV-42");
    expect(calledUrl).toContain("vendorId=99");

    // Per-state badge: deep-links to /reports?card=salesTaxByState&state=CA
    // scoped to the audit row's period (inclusive end, so 2025-02-01
    // exclusive becomes 2025-01-31 inclusive).
    const stateLink = screen.getByTestId(
      "link-audit-reconciliation-state-0",
    ) as HTMLAnchorElement;
    expect(stateLink.tagName).toBe("A");
    expect(stateLink.target).toBe("_blank");
    const href = stateLink.getAttribute("href") ?? "";
    expect(href).toContain("/reports?");
    expect(href).toContain("card=salesTaxByState");
    expect(href).toContain("state=CA");
    expect(href).toContain("periodStart=2025-01-01");
    expect(href).toContain("periodEnd=2025-01-31");
  });
});

// ── PushResultPanel: vendorId-aware invoice + period-aware state ──

describe("PushResultPanel reconciliation links", () => {
  it("renders vendor-aware invoice links and period-aware state badges alongside failed-push warnings", async () => {
    // Mix of: one failed sync warning (real push error), one per-invoice
    // reconciliation drift warning, and one per-state aggregate. The
    // panel must surface all three rendering modes simultaneously and
    // the reconciliation links must use the vendorId + the parsed
    // period from the result label.
    const state = {
      provider: "qbo" as const,
      wasRetry: false,
      result: {
        ok: true,
        period: "2025-03-01 – 2025-03-31",
        auditLogId: 12,
        retriedFromAuditId: null,
        customersCreated: 0,
        vendorsCreated: 0,
        invoicesCreated: 0,
        customersAlreadyExisted: 0,
        vendorsAlreadyExisted: 0,
        invoicesAlreadyUpToDate: 0,
        warnings: [
          {
            kind: "invoice" as const,
            identifier: "INV-1",
            message: "Push failed: 401 from QuickBooks",
          },
          {
            kind: "invoice" as const,
            identifier: "INV-7",
            message:
              "reconciliation: QuickBooks total 50.00 does not match posted total 60.00",
          },
          {
            kind: "invoice" as const,
            identifier: "(state:NY)",
            message:
              "reconciliation: QuickBooks tax for NY totals 2.00 but VNDRLY's Sales-Tax-by-State report shows 3.00",
          },
        ],
      },
    };

    render(
      <PushResultPanel
        state={state}
        retrying={false}
        onRetry={() => {}}
        vendorId={42}
      />,
    );

    // Failed-push row renders alongside the two reconciliation rows.
    expect(screen.getByTestId("row-push-warning-0")).toBeTruthy();

    // Per-invoice reconciliation cell is a clickable button (vendorId
    // is non-null and identifier is invoice-like) that fires
    // openInvoiceByNumberInNewTab with the panel's vendorId.
    const invoiceBtn = screen.getByTestId(
      "link-push-reconciliation-invoice-0",
    );
    expect(invoiceBtn.tagName).toBe("BUTTON");
    expect(invoiceBtn.textContent).toContain("INV-7");

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse({ items: [{ id: 999 }] }));
    fireEvent.click(invoiceBtn);

    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      "_blank",
      "noopener",
    );
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("invoiceNumber=INV-7");
    // Critically: the vendorId comes from the panel prop, not from the
    // warning identifier — guards against a future refactor that
    // accidentally drops the prop.
    expect(calledUrl).toContain("vendorId=42");

    // Per-state badge renders an anchor scoped to the parsed period.
    const stateLink = screen.getByTestId(
      "link-push-reconciliation-state-0",
    ) as HTMLAnchorElement;
    expect(stateLink.tagName).toBe("A");
    const href = stateLink.getAttribute("href") ?? "";
    expect(href).toContain("card=salesTaxByState");
    expect(href).toContain("state=NY");
    // Period parsed straight from the server label — both bounds
    // forwarded as-is so the deep-link round-trips through the server's
    // resolvePeriod (which re-bumps date-only periodEnd by one day).
    expect(href).toContain("periodStart=2025-03-01");
    expect(href).toContain("periodEnd=2025-03-31");

    // Wait for the fetch promise to settle so the test doesn't leak
    // the in-flight request into the next case.
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("renders the per-invoice identifier as plain text when vendorId resolution would be ambiguous", () => {
    // A synthetic '(reconciliation)' warning isn't a real invoice number,
    // and there's no vendor-scoped lookup we could do anyway. The cell
    // must degrade to a plain span instead of producing a useless link.
    const state = {
      provider: "oa" as const,
      wasRetry: false,
      result: {
        ok: true,
        period: "2025-04-01 – 2025-04-30",
        auditLogId: null,
        retriedFromAuditId: null,
        customersCreated: 0,
        vendorsCreated: 0,
        invoicesCreated: 0,
        customersAlreadyExisted: 0,
        vendorsAlreadyExisted: 0,
        invoicesAlreadyUpToDate: 0,
        warnings: [
          {
            kind: "invoice" as const,
            identifier: "(reconciliation)",
            message: "reconciliation: reconcile step itself failed",
          },
        ],
      },
    };

    render(
      <PushResultPanel
        state={state}
        retrying={false}
        onRetry={() => {}}
        vendorId={42}
      />,
    );

    // The cell is rendered, but as a plain span (no testid attached
    // because the fallback path doesn't carry one).
    const row = screen.getByTestId("row-push-reconciliation-0");
    expect(row.textContent).toContain("(reconciliation)");
    expect(row.querySelector("button")).toBeNull();
    expect(row.querySelector("a")).toBeNull();
  });
});
