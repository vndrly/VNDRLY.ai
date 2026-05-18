import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

// End-to-end browser tests for the two bulk 1099 income-category
// recategorization flows:
//
//   1. Admin opens a draft invoice, multi-selects line items, and applies
//      a 1099 category via the bulk toolbar on /invoices/:id.
//   2. Admin uses the per-vendor "Recategorize draft lines" dropdown on
//      the 1099 dashboard at /reports.
//
// Both tests rely on POST /api/auth/seed-1099-fixture (a dev-only,
// idempotent seed endpoint that resets the fixture's draft invoice lines
// to a known baseline on every call). The tests do not boot any servers
// themselves — they expect the api-server and the web app workflows to be
// running and pointed at the same dev database.

type FixtureResponse = {
  ok: true;
  vendorId: number;
  vendorName: string;
  partnerId: number;
  draftInvoiceId: number;
  draftInvoiceNumber: string;
  draftLineIds: number[];
  paidInvoiceId: number;
  year: number;
};

async function seedFixture(
  request: APIRequestContext,
): Promise<FixtureResponse> {
  const res = await request.post("/api/auth/seed-1099-fixture");
  if (!res.ok()) {
    const body = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `seed-1099-fixture failed: ${res.status()} ${res.statusText()} ${body}`,
    );
  }
  const json = (await res.json()) as FixtureResponse;
  if (!json.ok || json.draftLineIds?.length !== 3) {
    throw new Error(
      `seed-1099-fixture returned unexpected payload: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

test.describe("bulk 1099 category recategorization", () => {
  test("admin multi-selects draft invoice lines and applies a bulk 1099 category", async ({
    page,
    request,
  }) => {
    const fixture = await seedFixture(request);
    await loginAsAdmin(page);

    await page.goto(`/invoices/${fixture.draftInvoiceId}`);

    // All three seeded lines are visible and start out as NEC.
    for (const lineId of fixture.draftLineIds) {
      const row = page.locator(`[data-testid="row-line-${lineId}"]`);
      await expect(row).toBeVisible();
      await expect(
        page.locator(`[data-testid="text-income-category-${lineId}"]`),
      ).toHaveText("Service – 1099-NEC");
    }

    // The bulk toolbar is rendered for admins on draft invoices.
    const masterCheckbox = page.locator(
      '[data-testid="checkbox-select-all-lines"]',
    );
    const bulkCategorySelect = page.locator(
      '[data-testid="select-bulk-income-category"]',
    );
    const applyButton = page.locator(
      '[data-testid="button-apply-bulk-category"]',
    );
    const selectionSummary = page.locator(
      '[data-testid="text-bulk-selection-summary"]',
    );
    await expect(masterCheckbox).toBeVisible();
    await expect(bulkCategorySelect).toBeVisible();
    await expect(applyButton).toBeVisible();

    // Select all three lines.
    await masterCheckbox.click();
    await expect(selectionSummary).toContainText("3");

    // Choose Rent – 1099-MISC Box 1 in the bulk dropdown and apply.
    await bulkCategorySelect.click();
    await page
      .getByRole("option", { name: "Rent – 1099-MISC Box 1" })
      .click();
    await applyButton.click();

    // Success toast. The toast renders both a visible title and an
    // accessibility-only live-region announcement, so two nodes match —
    // assert on the first (visible) one.
    await expect(
      page.getByText(/Updated 1099 category on 3 line\(s\)/i).first(),
    ).toBeVisible();

    // Each line now shows the new category, and the selection clears.
    for (const lineId of fixture.draftLineIds) {
      await expect(
        page.locator(`[data-testid="text-income-category-${lineId}"]`),
      ).toHaveText("Rent – 1099-MISC Box 1");
    }
    await expect(selectionSummary).toContainText("0");
  });

  test("admin recategorizes a vendor's draft 1099 lines from the 1099 dashboard", async ({
    page,
    request,
  }) => {
    const fixture = await seedFixture(request);
    await loginAsAdmin(page);

    await page.goto("/reports");

    // The 1099 dashboard card is rendered for admins.
    const dashboardCard = page.locator('[data-testid="card-1099-dashboard"]');
    await dashboardCard.scrollIntoViewIfNeeded();
    await expect(dashboardCard).toBeVisible();

    // Make sure the dashboard year matches the seeded paid-invoice year.
    const yearInput = page.locator('[data-testid="input-dashboard-year"]');
    await expect(yearInput).toBeVisible();
    const currentYear = await yearInput.inputValue();
    if (currentYear !== String(fixture.year)) {
      await yearInput.fill(String(fixture.year));
      await yearInput.press("Tab");
    }

    // The fixture vendor must appear in the NEC table with the per-vendor
    // recategorize dropdown.
    const recategorizeSelect = page.locator(
      `[data-testid="select-recategorize-${fixture.vendorId}"]`,
    );
    await expect(recategorizeSelect).toBeVisible();

    // Pick "Other income – 1099-MISC Box 3" — this triggers the bulk
    // recategorize POST against the seeded vendor's draft invoice. The
    // dashboard control is a native <select>, so use selectOption with
    // the underlying enum value rather than clicking an option.
    await recategorizeSelect.selectOption("misc_other_income");

    // Success banner with the formatted summary.
    const banner = page.locator('[data-testid="row-1099-recategorize-result"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(fixture.vendorName);
    await expect(banner).toContainText("draft line(s)");
    await expect(banner).toContainText("invoice(s)");

    // The fixture seeds exactly one draft invoice with three lines, so a
    // successful run should report at least one of each.
    const bannerText = (await banner.textContent()) ?? "";
    const linesMatch = bannerText.match(/Updated\s+(\d+)\s+draft line/i);
    const invoicesMatch = bannerText.match(/on\s+(\d+)\s+invoice/i);
    expect(linesMatch?.[1]).toBeDefined();
    expect(invoicesMatch?.[1]).toBeDefined();
    expect(Number(linesMatch?.[1])).toBeGreaterThan(0);
    expect(Number(invoicesMatch?.[1])).toBeGreaterThan(0);
  });
});
