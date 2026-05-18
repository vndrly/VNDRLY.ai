import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same provider stubs as reports.audit-warnings.test.tsx — AuditCard pulls
// in the shared Dialog primitive (via AuditDetailDialog) which talks to
// useAuth + the generated API client; neither matters for the
// reconciliation-copy assertion under test.
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

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function seedAuditRow(reportKind: string) {
  return {
    rows: [
      {
        id: 7,
        reportKind,
        format: "oa_api_push",
        rowCount: 1,
        fileBytes: 0,
        userRole: "admin",
        downloadedByUserId: 1,
        createdAt: new Date().toISOString(),
        scope: { vendorId: 1 },
        detailJson: {
          warnings: [
            {
              kind: "invoice",
              identifier: "INV-1",
              message:
                "reconciliation: OpenAccountant total 12.00 does not match posted total 13.00",
            },
            {
              kind: "invoice",
              identifier: "(state:CA)",
              message:
                "reconciliation: OpenAccountant tax for CA totals 1.00 but VNDRLY's Sales-Tax-by-State report shows 1.50",
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
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuditCard reconciliation provider copy", () => {
  it("renders the reconciliation badge and OpenAccountant-flavored description for an OA push row", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(seedAuditRow("vendor.openaccountantPush")),
    );

    render(<AuditCard />);

    // Badge on the row signals reconciliation drift count (2 here:
    // one per-invoice + one per-state).
    const badge = await screen.findByTestId("badge-audit-reconciliation-7");
    expect(badge.textContent).toContain("2");

    // Open the details dialog and assert the description names
    // OpenAccountant, not QuickBooks.
    fireEvent.click(screen.getByTestId("link-audit-details-7"));

    await waitFor(() => {
      expect(screen.getByTestId("section-audit-reconciliation")).toBeTruthy();
    });
    const section = screen.getByTestId("section-audit-reconciliation");
    expect(section.textContent).toContain("OpenAccountant accepted these rows");
    expect(section.textContent).not.toContain("QuickBooks accepted these rows");
    // Both buckets render — per-invoice mismatch and per-state mismatch.
    expect(screen.getByTestId("row-audit-reconciliation-0")).toBeTruthy();
    expect(screen.getByTestId("row-audit-reconciliation-state-0")).toBeTruthy();
  });

  it("keeps the QuickBooks-flavored description for a QBO push row", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(seedAuditRow("vendor.quickbooksPush")),
    );

    render(<AuditCard />);

    fireEvent.click(await screen.findByTestId("link-audit-details-7"));
    await waitFor(() => {
      expect(screen.getByTestId("section-audit-reconciliation")).toBeTruthy();
    });
    const section = screen.getByTestId("section-audit-reconciliation");
    expect(section.textContent).toContain("QuickBooks accepted these rows");
    expect(section.textContent).not.toContain(
      "OpenAccountant accepted these rows",
    );
  });
});
