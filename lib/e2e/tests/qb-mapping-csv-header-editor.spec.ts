import { test, expect, type Page } from "@playwright/test";
import type pg from "pg";

import { createPool, makeStamp } from "../helpers/db";
import { createVendor } from "../helpers/fixtures";
import { loginAsAdmin } from "../helpers/auth";

// End-to-end browser tests for the inline header editor inside the QB
// account-mapping CSV import preview dialog
// (artifacts/vndrly/src/pages/reports.tsx — CsvImportPreviewDialog +
// CsvHeaderEditor).
//
// The dialog already has unit coverage for the Re-validate button,
// pending-edit counter, and the pure buildEditedCsv helper
// (artifacts/vndrly/src/pages/reports.csv-import.test.tsx). What those
// don't catch is the round-trip through the real API server: that the
// header rewrite the dialog ships actually re-parses on the server and
// the rebuilt preview really does classify the row. This spec walks
// the two flows end-to-end:
//
//   1. CSV with a typo'd `line type` header → rename inline →
//      Re-validate → preview shows an insert row.
//   2. CSV with no `account_name` column at all → click "Add
//      account_name" → Re-validate → server returns a per-row
//      error → fill the per-row account_name → Re-validate →
//      preview now shows an insert row.
//
// We provision a fresh stamped vendor per spec run so the (vendor,
// NULL, line_type) tuples we upload are guaranteed not to collide
// with whatever rows the shared dev DB already has in
// qb_account_mapping. The spec never clicks Apply, so we never write
// to qb_account_mapping itself — but we still scrub any rows the
// vendor might pick up via afterAll for hygiene.

let pool: pg.Pool;
let vendorId: number;
let stamp: string;

test.beforeAll(async () => {
  pool = createPool();
  stamp = makeStamp();
  const vendor = await createVendor(pool, {
    name: `QB CSV Editor Vendor ${stamp}`,
    contactName: `QB CSV Editor Contact ${stamp}`,
    contactEmail: `qb-csv-editor-${stamp}@example.com`,
  });
  vendorId = vendor.id;
});

test.afterAll(async () => {
  // Defensive cleanup. The spec never clicks Apply so qb_account_mapping
  // shouldn't have anything for this vendor, but if a future change
  // ever flips the spec to commit, the ON DELETE CASCADE from the
  // vendors row will sweep mapping rows too.
  if (pool) {
    if (vendorId) {
      await pool
        .query(`DELETE FROM qb_account_mapping WHERE vendor_id = $1`, [
          vendorId,
        ])
        .catch(() => {});
      await pool
        .query(`DELETE FROM vendors WHERE id = $1`, [vendorId])
        .catch(() => {});
    }
    await pool.end();
  }
});

async function uploadCsv(page: Page, name: string, csv: string): Promise<void> {
  // The button is just a click handler over a hidden <input type=file>.
  // Setting the input directly is more reliable than clicking the button
  // and waiting for the OS file chooser.
  await page.locator('[data-testid="input-csv-file"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await expect(
    page.locator('[data-testid="dialog-csv-import-preview"]'),
  ).toBeVisible();
}

test.describe("QB account-mapping CSV header editor", () => {
  test("admin renames a typo'd header inline and the rebuilt preview classifies the row", async ({
    page,
  }) => {
    // Header has "line type" (with a space) where it should read
    // "line_type". The server-side parser bails on the header, so the
    // first preview comes back with one rowNumber=1 error and zero
    // inserts/updates — i.e. nothing the admin can apply until the
    // header is fixed.
    const csv =
      "vendor_id,partner_id,line type,account_name,account_number\n" +
      `${vendorId},,labor_regular,QB Header Editor ${stamp},5010\n`;

    await loginAsAdmin(page);
    await page.goto("/reports");

    // The QB account mapping card is admin-only; make sure it rendered
    // before we try to drive the import button.
    const card = page.locator('[data-testid="card-qb-account-mapping"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();

    await uploadCsv(page, "qb-mapping-typo.csv", csv);

    // The header editor pops because the server flagged a header error
    // (and our local missing-required check agrees that line_type
    // isn't in the live header).
    const headerEditor = page.locator('[data-testid="csv-header-editor"]');
    await expect(headerEditor).toBeVisible();
    await expect(
      page.locator('[data-testid="text-header-error-message"]'),
    ).toBeVisible();

    // Apply is gated until the user re-validates; Re-validate is gated
    // until the user actually edits something. Both are the safety
    // rails the dialog adds on top of the API.
    const applyBtn = page.locator('[data-testid="button-preview-apply"]');
    const revalidateBtn = page.locator(
      '[data-testid="button-preview-revalidate"]',
    );
    await expect(applyBtn).toBeDisabled();
    await expect(revalidateBtn).toBeDisabled();

    // Rename column 2 ("line type") → "line_type". The cells are
    // exposed as input-header-{idx} per the editor markup.
    await page.locator('[data-testid="input-header-2"]').fill("line_type");

    // The header is now valid → Re-validate is the only path forward.
    await expect(revalidateBtn).toBeEnabled();
    await expect(
      page.locator('[data-testid="text-preview-edits-pending"]'),
    ).toBeVisible();

    // Click and wait for the dryRun POST to round-trip so we don't
    // assert against the previous preview state.
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/reports/qb-account-mapping/csv") &&
          res.request().method() === "POST" &&
          res.status() === 200,
      ),
      revalidateBtn.click(),
    ]);

    // After the round trip the header editor disappears (no header
    // error, nothing missing) and the inserts section now shows the
    // single classified row. The row testid is keyed by rowNumber=2
    // because that's the data row in the uploaded CSV.
    await expect(headerEditor).toHaveCount(0);
    const inserts = page.locator('[data-testid="section-preview-inserts"]');
    await expect(inserts).toBeVisible();
    const insertRow = page.locator('[data-testid="row-preview-insert-2"]');
    await expect(insertRow).toBeVisible();
    await expect(insertRow).toContainText("labor_regular");
    await expect(insertRow).toContainText(`QB Header Editor ${stamp}`);
    // Apply is unblocked now that there are no pending edits and at
    // least one applyable row.
    await expect(applyBtn).toBeEnabled();
  });

  test("admin adds a missing required column, fills the per-row value, and re-validates clean", async ({
    page,
  }) => {
    // CSV is missing the entire account_name column. The server will
    // return a header error on the first dryRun ("Header row must
    // include at least line_type and account_name columns").
    const csv =
      "vendor_id,partner_id,line_type,account_number\n" +
      `${vendorId},,materials,5020\n`;

    await loginAsAdmin(page);
    await page.goto("/reports");

    const card = page.locator('[data-testid="card-qb-account-mapping"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();

    await uploadCsv(page, "qb-mapping-missing-account-name.csv", csv);

    const headerEditor = page.locator('[data-testid="csv-header-editor"]');
    await expect(headerEditor).toBeVisible();
    const missingChip = page.locator(
      '[data-testid="csv-header-missing-required"]',
    );
    await expect(missingChip).toBeVisible();
    await expect(missingChip).toContainText("account_name");

    // Click the "Add account_name" button — this appends the column
    // locally; nothing has hit the server yet.
    await page
      .locator('[data-testid="button-header-add-account_name"]')
      .click();
    // The added column is now an editor entry. Its value isn't
    // user-editable from the header bar; the actual cell value is
    // filled in via the per-row editor below after re-validation.
    await expect(
      page.locator('[data-testid="input-header-added-0"]'),
    ).toHaveValue("account_name");
    // missingRequired is empty now, so the chip disappears.
    await expect(missingChip).toHaveCount(0);

    const revalidateBtn = page.locator(
      '[data-testid="button-preview-revalidate"]',
    );
    await expect(revalidateBtn).toBeEnabled();

    // First round-trip: server now accepts the header but rejects the
    // row because account_name is required and the cell is empty.
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/reports/qb-account-mapping/csv") &&
          res.request().method() === "POST" &&
          res.status() === 200,
      ),
      revalidateBtn.click(),
    ]);

    // The header editor is gone — no header issue anymore — but there
    // is now a per-row error for row 2 with an account_name input.
    await expect(headerEditor).toHaveCount(0);
    const rowError = page.locator('[data-testid="row-preview-error-2"]');
    await expect(rowError).toBeVisible();
    await expect(rowError).toContainText(/account_name is required/i);

    const accountNameInput = page.locator(
      '[data-testid="input-error-2-account_name"]',
    );
    await expect(accountNameInput).toBeVisible();
    await accountNameInput.fill(`QB Add Column ${stamp}`);

    // The Re-validate button is enabled again because the dialog has a
    // pending edit; Apply is locked behind a clean preview.
    await expect(revalidateBtn).toBeEnabled();
    await expect(
      page.locator('[data-testid="button-preview-apply"]'),
    ).toBeDisabled();

    // Second round-trip: server should now accept the row.
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/reports/qb-account-mapping/csv") &&
          res.request().method() === "POST" &&
          res.status() === 200,
      ),
      revalidateBtn.click(),
    ]);

    await expect(rowError).toHaveCount(0);
    const inserts = page.locator('[data-testid="section-preview-inserts"]');
    await expect(inserts).toBeVisible();
    const insertRow = page.locator('[data-testid="row-preview-insert-2"]');
    await expect(insertRow).toBeVisible();
    await expect(insertRow).toContainText("materials");
    await expect(insertRow).toContainText(`QB Add Column ${stamp}`);
    await expect(
      page.locator('[data-testid="button-preview-apply"]'),
    ).toBeEnabled();
  });
});
