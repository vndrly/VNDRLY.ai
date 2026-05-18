import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

// End-to-end browser test for the admin Reports → Audit log card.
//
// The retry-chain enrichment, server-side pagination, the warnings filter,
// anchor jumps, and out-of-window chain navigation are already exhaustively
// covered by API integration tests
// (artifacts/api-server/src/routes/reports-exports-audit-retry-chain.test.ts).
// Those tests verify the wire format the route returns; what they CAN'T
// catch is a regression in how the AuditCard wires `anchorId` and
// `chainRows` into the row list — for instance, if the "Retry of #N"
// badge stops triggering an anchor refetch when its target lives on
// another page, every API test stays green but the UX silently breaks.
//
// This spec exercises the same flow in a real browser:
//   1. Sign in as admin and open /reports.
//   2. Page from page 1 → page 2 → back, asserting the page summary text
//      tracks the navigation.
//   3. Toggle "with warnings only" and verify the visible row count
//      drops to the seeded warning count, then toggle it back off.
//   4. Click the "Retry of #<rootId>" badge on the chain tip (which
//      lives on page 1) and assert that the page jumps to page 2 and
//      the badged root row scrolls into view.
//
// The deterministic fixture is provisioned by the dev-only
// POST /api/auth/seed-audit-pagination-fixture endpoint, which truncates
// the report_export_audit_log table and re-inserts a known 150-row mix
// (1 chain root on page 2, 3 warning rows on page 1, 96 plain fillers
// on page 1, 49 plain fillers on page 2, and 1 chain tip on page 1
// pointing at the root via scope.retriedFromAuditId).

type FixtureResponse = {
  ok: true;
  totalRows: number;
  pageSize: number;
  totalPages: number;
  rootId: number;
  tipId: number;
  warningIds: number[];
  warningCount: number;
};

async function seedFixture(
  request: APIRequestContext,
): Promise<FixtureResponse> {
  const res = await request.post("/api/auth/seed-audit-pagination-fixture");
  if (!res.ok()) {
    const body = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `seed-audit-pagination-fixture failed: ${res.status()} ${res.statusText()} ${body}`,
    );
  }
  const json = (await res.json()) as FixtureResponse;
  if (
    !json.ok ||
    json.totalRows !== 150 ||
    json.totalPages !== 2 ||
    json.warningCount !== 3 ||
    typeof json.rootId !== "number" ||
    typeof json.tipId !== "number"
  ) {
    throw new Error(
      `seed-audit-pagination-fixture returned unexpected payload: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

test.describe("audit log pagination flow", () => {
  test("admin pages, filters by warnings, and follows a 'Retry of #N' badge across pages", async ({
    page,
    request,
  }) => {
    const fixture = await seedFixture(request);

    await loginAsAdmin(page);
    await page.goto("/reports");

    const card = page.locator('[data-testid="card-audit-log"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();

    const summary = page.locator('[data-testid="text-audit-pagination-summary"]');
    const prev = page.locator('[data-testid="button-audit-prev-page"]');
    const next = page.locator('[data-testid="button-audit-next-page"]');

    // ── Initial load lands on page 1 with the full 150 rows visible. ──
    // The summary text varies by translation (e.g. "Page 1 of 2 · 150
    // rows"); we anchor on the numbers we control via the fixture.
    await expect(summary).toContainText("150");
    await expect(summary).toContainText("1");
    await expect(summary).toContainText("2");
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    // The chain tip row sits at the very top of page 1 and the chain
    // root sits on page 2 — confirm the tip is visible up front and the
    // root is not.
    const tipRow = page.locator(`[data-testid="row-audit-${fixture.tipId}"]`);
    const rootRow = page.locator(`[data-testid="row-audit-${fixture.rootId}"]`);
    await expect(tipRow).toBeVisible();
    await expect(rootRow).toHaveCount(0);

    // The card-header warnings badge reflects the 3 seeded warning rows
    // visible on page 1.
    const warningsBadge = page.locator(
      '[data-testid="badge-audit-warnings-count"]',
    );
    await expect(warningsBadge).toBeVisible();
    await expect(warningsBadge).toContainText("3");

    // ── Page forward to page 2. ──
    await next.click();
    await expect(summary).toContainText("2");
    await expect(prev).toBeEnabled();
    await expect(next).toBeDisabled();
    // Page 2 has 50 rows (49 fillers + the chain root). The tip row is
    // gone, the root row is now visible.
    await expect(rootRow).toBeVisible();
    await expect(tipRow).toHaveCount(0);

    // ── Page back to page 1. ──
    await prev.click();
    await expect(summary).toContainText("1");
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    await expect(tipRow).toBeVisible();
    await expect(rootRow).toHaveCount(0);

    // ── Toggle "with warnings only" — visible rows drop to 3. ──
    const onlyWarnings = page.locator(
      '[data-testid="switch-audit-only-warnings"]',
    );
    // shadcn <Switch> exposes the underlying checkbox via the data-state
    // attribute; clicking the switch root flips it. Wait for the row
    // count to settle on 3 before asserting page-summary text changes
    // since the fetch is async.
    await onlyWarnings.click();
    const visibleRows = page.locator(
      '[data-testid^="row-audit-"]:not([data-testid^="row-audit-pagination"]):not([data-testid^="row-audit-filters"])',
    );
    await expect(visibleRows).toHaveCount(fixture.warningCount);
    // Toggle it back off so the rest of the test runs against the full
    // page again.
    await onlyWarnings.click();
    await expect(visibleRows).toHaveCount(100);

    // ── Click the "Retry of #<rootId>" badge on the tip row. The badge
    // points to the root, which lives on page 2. The endpoint resolves
    // the anchor server-side and the UI jumps to page 2 and scrolls to
    // the highlighted row. ──
    const retryBadge = page.locator(
      `[data-testid="button-retry-of-${fixture.tipId}"]`,
    );
    await expect(retryBadge).toBeVisible();
    await retryBadge.click();

    // After the anchor fetch resolves the summary should report page 2
    // and the root row must be in the DOM and visible.
    await expect(summary).toContainText("2");
    await expect(rootRow).toBeVisible();
    // The tip row no longer renders since we've moved off page 1.
    await expect(tipRow).toHaveCount(0);
  });
});
