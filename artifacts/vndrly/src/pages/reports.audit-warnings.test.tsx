import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AuditCard pulls in the shared Dialog primitive (via AuditDetailDialog),
// which renders a PortalLogoOverlay that talks to useAuth + the generated
// API client. None of that is relevant to the warning-rendering path under
// test, and wiring real providers would require a query client + an
// /api/auth/me fetch we don't need. Stubbing both keeps this test focused on
// the "warning without identifier doesn't crash the audit table" regression.
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

import { render, screen, waitFor } from "@testing-library/react";
import { AuditCard } from "./reports";

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

describe("AuditCard warning rendering", () => {
  it("does not crash when an audit row contains a warning without an identifier", async () => {
    // Older audit rows (and any future warning shape that doesn't carry an
    // identifier) used to explode `isReconciliationWarning` because it called
    // `.startsWith` on an undefined `identifier`. The whole AuditCard
    // unmounted, taking the entire Reports page with it. Seeding such a row
    // here is the regression guard: the audit table must still render.
    const malformedWarning = {
      kind: "invoice",
      // identifier intentionally omitted — this is the bug trigger.
      message: "boom: something went wrong without an identifier",
    } as unknown as { kind: "invoice"; identifier: string; message: string };

    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        rows: [
          {
            id: 999,
            reportKind: "qbPush",
            format: "json",
            rowCount: 1,
            fileBytes: 0,
            userRole: "admin",
            downloadedByUserId: 1,
            createdAt: new Date().toISOString(),
            scope: {},
            detailJson: { warnings: [malformedWarning] },
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

    // The row id from the seeded response. If `isReconciliationWarning`
    // throws, AuditCard's render bails before any table row is mounted and
    // this query times out — so the assertion alone is enough to lock in
    // the defensive-parsing fix.
    await waitFor(() => {
      expect(screen.getByTestId("row-audit-999")).toBeTruthy();
    });
  });
});
