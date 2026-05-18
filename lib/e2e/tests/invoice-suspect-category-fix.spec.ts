import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAsAdmin } from "../helpers/auth";

// End-to-end browser test for the inline invoice 1099 category warning
// (Task #385). The previous coverage was a smoke test that only checked
// that SuspectCategoryBanner / SuspectCategoryIndicator render — the
// "Fix" link's interaction (click → scroll to row → enter inline edit
// mode → change category → banner row + per-row chip disappear) was not
// covered, so a regression here would silently disable the AP warning.
//
// Setup re-uses the existing dev-only POST /api/auth/seed-1099-fixture
// endpoint, which idempotently provisions a draft invoice with three
// lines:
//
//   draftLineIds[0]: labor_regular / nec   → NOT suspect
//   draftLineIds[1]: equipment    / nec    → SUSPECT (allowed: misc_rents, none)
//   draftLineIds[2]: mileage      / nec    → SUSPECT (allowed: none)
//
// The test logs in as the seeded admin and exercises the Fix-from-banner
// flow on both suspect lines, then asserts the banner disappears
// entirely once every warned line has a sensible 1099 category — the
// regression that AP relies on (Task #385 "Done looks like": "changing
// the category … removes the banner and the indicator").
//
// Why admin (not "partner" as the task brief loosely phrases it):
// invoice line edits go through PATCH /api/invoices/:id/lines/:lineId,
// which is gated by `canEditInvoice` in artifacts/api-server/src/routes/
// invoices.ts. That helper only returns true for admins or for the
// owning vendor on a draft invoice — partners are explicitly denied
// (403) and never see the Fix affordance render against a live PATCH
// path. Admin is the smallest authorised actor that exercises the full
// browser → PATCH → cache-invalidation → re-render loop end-to-end,
// which is what this regression test needs to cover.

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

test.describe("invoice suspect-category Fix flow", () => {
  test("clicking Fix opens inline edit, fixing the category clears the warning", async ({
    page,
    request,
  }) => {
    const fixture = await seedFixture(request);
    const [laborLineId, equipmentLineId, mileageLineId] = fixture.draftLineIds;

    await loginAsAdmin(page);
    await page.goto(`/invoices/${fixture.draftInvoiceId}`);

    const banner = page.locator(
      '[data-testid="card-suspect-category-banner"]',
    );
    const equipmentBannerRow = page.locator(
      `[data-testid="row-suspect-line-${equipmentLineId}"]`,
    );
    const mileageBannerRow = page.locator(
      `[data-testid="row-suspect-line-${mileageLineId}"]`,
    );
    const equipmentFixButton = page.locator(
      `[data-testid="button-fix-suspect-line-${equipmentLineId}"]`,
    );
    const mileageFixButton = page.locator(
      `[data-testid="button-fix-suspect-line-${mileageLineId}"]`,
    );
    const equipmentChip = page.locator(
      `[data-testid="badge-suspect-line-${equipmentLineId}"]`,
    );
    const mileageChip = page.locator(
      `[data-testid="badge-suspect-line-${mileageLineId}"]`,
    );
    const laborChip = page.locator(
      `[data-testid="badge-suspect-line-${laborLineId}"]`,
    );

    // Initial render: banner visible with both suspect lines, plus the
    // per-row indicator chips. The compliant labor_regular line has no
    // chip. Both Fix affordances render only when the invoice is a draft
    // (proves the seed reset its status correctly).
    await expect(banner).toBeVisible();
    await expect(equipmentBannerRow).toBeVisible();
    await expect(mileageBannerRow).toBeVisible();
    await expect(equipmentFixButton).toBeVisible();
    await expect(mileageFixButton).toBeVisible();
    await expect(equipmentChip).toBeVisible();
    await expect(mileageChip).toBeVisible();
    await expect(laborChip).toHaveCount(0);

    // Helper: click Fix on a banner row, change the category via the
    // inline Radix Select, save, and wait for the PATCH to settle so the
    // React Query cache invalidation completes before the next assertion.
    const fixLine = async (
      lineId: number,
      optionLabel: string | RegExp,
    ): Promise<void> => {
      await page
        .locator(`[data-testid="button-fix-suspect-line-${lineId}"]`)
        .click();
      const select = page.locator(
        `[data-testid="select-income-category-${lineId}"]`,
      );
      const saveButton = page.locator(
        `[data-testid="button-save-line-${lineId}"]`,
      );
      await expect(select).toBeVisible();
      await expect(saveButton).toBeVisible();
      await select.click();
      await page.getByRole("option", { name: optionLabel }).click();
      const patchPromise = page.waitForResponse(
        (res) =>
          res.url().includes(
            `/api/invoices/${fixture.draftInvoiceId}/lines/${lineId}`,
          ) &&
          res.request().method() === "PATCH" &&
          res.ok(),
      );
      await saveButton.click();
      await patchPromise;
    };

    // Step 1: Fix the equipment line by switching to its AP-suggested
    // category, "Rent – 1099-MISC Box 1" (misc_rents). After the PATCH
    // settles the equipment row + per-row chip should disappear, but the
    // banner itself stays visible because the mileage line is still
    // suspect — proving the banner is per-line reactive, not all-or-nothing.
    await fixLine(equipmentLineId, "Rent – 1099-MISC Box 1");
    await expect(equipmentBannerRow).toHaveCount(0);
    await expect(equipmentChip).toHaveCount(0);
    await expect(banner).toBeVisible();
    await expect(mileageBannerRow).toBeVisible();
    await expect(mileageChip).toBeVisible();

    // Step 2: Fix the mileage line by switching to its only allowed
    // category, "Not 1099 reportable" (none). With no remaining suspect
    // lines the entire banner — and every per-row indicator chip — must
    // disappear. This is the core acceptance criterion from the task
    // brief: "changing the category to a suggested one removes the
    // banner and the indicator."
    await fixLine(mileageLineId, "Not reportable");
    await expect(mileageBannerRow).toHaveCount(0);
    await expect(mileageChip).toHaveCount(0);
    await expect(banner).toHaveCount(0);
  });
});
