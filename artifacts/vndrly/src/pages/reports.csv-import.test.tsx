import { describe, expect, it, vi } from "vitest";

// The shared Dialog primitive renders a `PortalLogoOverlay` that talks to
// useAuth + the generated API client (useGetPartner / useGetVendor). None
// of that is relevant to the CSV editor under test, and wiring real
// providers would require a query client + an /api/auth/me fetch we
// don't need. Stubbing both keeps the test focused on the dialog logic.
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

import { render, screen, fireEvent } from "@testing-library/react";
import {
  CsvImportPreviewDialog,
  buildEditedCsv,
  computeBulkRenameCandidates,
  type CsvPreviewState,
} from "./reports";
import { readCsv } from "../lib/csv";

// These tests guard the inline edit / re-validate flow inside the QB
// account-mapping import preview dialog. They cover the bits that are
// easy to break without an e2e: the disabled-state gating on the
// Apply / Re-validate buttons, the "edits pending" counter, and most
// importantly the CSV that gets shipped to onRevalidate when the
// admin fixes a row in-place.

const HEADER =
  "vendor_id,partner_id,line_type,account_name,account_number\n";

function basePreview(csv: string): CsvPreviewState {
  return {
    csv,
    inserts: [
      {
        rowNumber: 2,
        vendorId: 1,
        partnerId: null,
        lineType: "labor",
        accountName: "Subcontracted Labor",
        accountNumber: "5010",
      },
    ],
    updates: [],
    unchanged: [],
    errors: [
      {
        rowNumber: 3,
        message: "vendor_id must be a positive integer",
      },
    ],
    vendorNames: { 1: "Acme" },
    partnerNames: {},
  };
}

function renderDialog(overrides: {
  preview: CsvPreviewState;
  onApply?: () => Promise<void>;
  onRevalidate?: (csv: string) => Promise<void>;
  applying?: boolean;
  revalidating?: boolean;
  previewError?: string | null;
}) {
  const onApply = overrides.onApply ?? vi.fn().mockResolvedValue(undefined);
  const onRevalidate =
    overrides.onRevalidate ?? vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  const utils = render(
    <CsvImportPreviewDialog
      open={true}
      onOpenChange={onOpenChange}
      preview={overrides.preview}
      applying={overrides.applying ?? false}
      revalidating={overrides.revalidating ?? false}
      previewError={overrides.previewError ?? null}
      onApply={onApply}
      onRevalidate={onRevalidate}
    />,
  );
  return { ...utils, onApply, onRevalidate, onOpenChange };
}

describe("CsvImportPreviewDialog inline edit + re-validate flow", () => {
  it("disables Re-validate until a row is edited and Apply once edits are pending", () => {
    const csv =
      HEADER +
      "1,,labor,Subcontracted Labor,5010\n" +
      "bad,,labor,Job Materials,5020\n";

    renderDialog({ preview: basePreview(csv) });

    const revalidate = screen.getByTestId(
      "button-preview-revalidate",
    ) as HTMLButtonElement;
    const apply = screen.getByTestId(
      "button-preview-apply",
    ) as HTMLButtonElement;

    // No edits yet → Re-validate disabled, Apply enabled (1 insert ready).
    expect(revalidate.disabled).toBe(true);
    expect(apply.disabled).toBe(false);
    expect(screen.queryByTestId("text-preview-edits-pending")).toBeNull();

    // Editing the offending vendor_id flips both states: Re-validate
    // becomes the only path forward, Apply is locked behind it so the
    // server never sees an un-validated CSV.
    fireEvent.change(screen.getByTestId("input-error-3-vendor_id"), {
      target: { value: "42" },
    });

    expect(revalidate.disabled).toBe(false);
    expect(apply.disabled).toBe(true);
    expect(apply.textContent).toContain("Re-validate first");
  });

  it("shows an accurate edits-pending count keyed by row number", () => {
    const csv =
      HEADER +
      "1,,labor,Subcontracted Labor,5010\n" +
      "bad,,labor,Materials,5020\n";

    renderDialog({
      preview: {
        ...basePreview(csv),
        // Two skipped rows so we can confirm the counter is per-row,
        // not per-cell — multiple cell edits on the same row should
        // still count as one pending row.
        errors: [
          { rowNumber: 3, message: "vendor_id must be a positive integer" },
          { rowNumber: 4, message: "line_type is required" },
        ],
      },
    });
    // Row 4 doesn't actually exist in the CSV matrix above, so the
    // editor should still render the message but skip the inputs.
    // For the per-row counter test we only need row 3's inputs.

    // Two edits to row 3 → still "1 row edited".
    fireEvent.change(screen.getByTestId("input-error-3-vendor_id"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByTestId("input-error-3-account_name"), {
      target: { value: "Fixed Name" },
    });

    const counter = screen.getByTestId("text-preview-edits-pending");
    expect(counter.textContent).toContain("1");
  });

  it("rebuilds the CSV with the user's edits and passes it to onRevalidate", async () => {
    const csv =
      HEADER +
      "1,,labor,Subcontracted Labor,5010\n" +
      "bad,,labor,Materials,5020\n";

    const onRevalidate = vi.fn().mockResolvedValue(undefined);
    renderDialog({ preview: basePreview(csv), onRevalidate });

    fireEvent.change(screen.getByTestId("input-error-3-vendor_id"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByTestId("input-error-3-account_name"), {
      target: { value: "Job Materials, Misc" },
    });

    fireEvent.click(screen.getByTestId("button-preview-revalidate"));

    expect(onRevalidate).toHaveBeenCalledTimes(1);
    const sentCsv = onRevalidate.mock.calls[0][0] as string;

    // Re-parse the rebuilt CSV with the same parser the server uses,
    // so quoting differences (the new account_name has a comma) don't
    // make this test brittle on whitespace.
    const matrix = readCsv(sentCsv);
    expect(matrix[0]).toEqual([
      "vendor_id",
      "partner_id",
      "line_type",
      "account_name",
      "account_number",
    ]);
    // Untouched row carries through verbatim.
    expect(matrix[1]).toEqual([
      "1",
      "",
      "labor",
      "Subcontracted Labor",
      "5010",
    ]);
    // Edited cells were written into the right columns; cells the
    // user didn't touch (partner_id, line_type, account_number) are
    // preserved from the original row.
    expect(matrix[2]).toEqual([
      "42",
      "",
      "labor",
      "Job Materials, Misc",
      "5020",
    ]);
  });

  it("renders the line_type cell as a dropdown of allowed values, even when the source CSV has a typo", () => {
    // Row 2 has a typo'd line_type ("labor_regulr"). Rather than asking
    // the admin to retype the value (and risk a new typo), the row
    // editor should render the line_type cell as a closed dropdown of
    // the documented MAPPABLE_LINE_TYPES so corrections are one click.
    const csv = HEADER + "1,,labor_regulr,Subcontracted Labor,5010\n";
    renderDialog({
      preview: {
        ...basePreview(csv),
        inserts: [],
        errors: [
          {
            rowNumber: 2,
            message: "vendor_id must be a positive integer",
          },
        ],
      },
    });

    // The free-text input + "Did you mean…?" pill are gone; the
    // dropdown trigger replaces them.
    expect(screen.queryByTestId("input-error-2-line_type")).toBeNull();
    expect(screen.queryByTestId("button-suggest-2-line_type")).toBeNull();
    const trigger = screen.getByTestId("select-error-2-line_type");
    expect(trigger).not.toBeNull();
    // The invalid current value is surfaced in the placeholder so the
    // admin can see what was wrong before picking a replacement.
    expect(trigger.textContent).toContain("labor_regulr");
  });

  it("does not show a 'Did you mean' pill for free-form columns", () => {
    // account_name is free-form text — there's no canonical list to
    // match against, so the row editor should never surface a pill
    // for it even when the row is flagged as an error.
    const csv = HEADER + "1,,labor_regular,Subcntracted Labor,5010\n";
    renderDialog({
      preview: {
        ...basePreview(csv),
        inserts: [],
        errors: [
          {
            rowNumber: 2,
            message: "account_name is required",
          },
        ],
      },
    });

    expect(screen.queryByTestId("button-suggest-2-account_name")).toBeNull();
    expect(screen.queryByTestId("button-suggest-2-account_number")).toBeNull();
    expect(screen.queryByTestId("button-suggest-2-vendor_id")).toBeNull();
    expect(screen.queryByTestId("button-suggest-2-partner_id")).toBeNull();
    // And since the line_type cell is already a valid canonical key,
    // it shouldn't get a pill either — no redundant suggestions.
    expect(screen.queryByTestId("button-suggest-2-line_type")).toBeNull();
  });

  it("does not call onRevalidate while a re-validate is already in flight", () => {
    const csv = HEADER + "bad,,labor,Materials,5020\n";

    const onRevalidate = vi.fn().mockResolvedValue(undefined);
    renderDialog({
      preview: {
        ...basePreview(csv),
        inserts: [],
        errors: [
          { rowNumber: 2, message: "vendor_id must be a positive integer" },
        ],
      },
      onRevalidate,
      revalidating: true,
    });

    // Even with a pending edit, the spinner state should keep the
    // button disabled so we can't queue duplicate dry-runs.
    fireEvent.change(screen.getByTestId("input-error-2-vendor_id"), {
      target: { value: "42" },
    });

    const revalidate = screen.getByTestId(
      "button-preview-revalidate",
    ) as HTMLButtonElement;
    expect(revalidate.disabled).toBe(true);
    fireEvent.click(revalidate);
    expect(onRevalidate).not.toHaveBeenCalled();
  });
});

// Direct unit tests for the pure buildEditedCsv helper. The dialog tests
// above already exercise it end-to-end via the Re-validate button, but
// driving it as a function lets us cover the header-rewrite branches
// (renames, additions, padding, post-rename cell routing) with much less
// fixture setup than would be needed to surface every branch through
// the rendered dialog.
describe("buildEditedCsv", () => {
  it("rewrites a header cell when the user renames a typo'd column", () => {
    // Header has "line type" (with a space) at column index 2 — the
    // server's parser would reject the file because line_type is one
    // of the two required columns. Renaming the cell inline must
    // replace the header value at the same index without disturbing
    // any of the other header cells or the data row.
    const csv =
      "vendor_id,partner_id,line type,account_name,account_number\n" +
      ",,labor_regular,Subcontracted Labor,5010\n";
    const matrix = readCsv(csv);

    const sentCsv = buildEditedCsv({
      matrix,
      headerEdits: { 2: "line_type" },
      addedColumns: [],
      edits: {},
    });

    const out = readCsv(sentCsv);
    expect(out[0]).toEqual([
      "vendor_id",
      "partner_id",
      "line_type",
      "account_name",
      "account_number",
    ]);
    // Data row is forwarded verbatim — buildEditedCsv must not mutate
    // cells that the user didn't touch.
    expect(out[1]).toEqual([
      "",
      "",
      "labor_regular",
      "Subcontracted Labor",
      "5010",
    ]);
  });

  it("appends a brand-new required column and pads every data row", () => {
    // CSV is missing account_name entirely — the user clicks
    // "Add account_name" and the helper has to (a) append the new
    // column to the header and (b) pad every short data row so the
    // matrix stays rectangular before it is re-serialized.
    const csv =
      "vendor_id,partner_id,line_type,account_number\n" +
      ",,labor_regular,5010\n" +
      ",,materials,5020\n";
    const matrix = readCsv(csv);

    const sentCsv = buildEditedCsv({
      matrix,
      headerEdits: {},
      addedColumns: ["account_name"],
      edits: {},
    });

    const out = readCsv(sentCsv);
    expect(out[0]).toEqual([
      "vendor_id",
      "partner_id",
      "line_type",
      "account_number",
      "account_name",
    ]);
    // Both data rows grew from 4 cells to 5, with an empty trailing
    // cell for the freshly-added column.
    expect(out[1]).toEqual(["", "", "labor_regular", "5010", ""]);
    expect(out[2]).toEqual(["", "", "materials", "5020", ""]);
    // Every data row is the same width as the header — no jagged
    // matrix that would confuse the server-side CSV parser.
    expect(out.every((r) => r.length === out[0].length)).toBe(true);
  });

  it("synthesizes a header row when the input CSV is empty", () => {
    // Defensive branch: if the user uploads an empty file and then
    // adds a column from the missing-required toolbar, the helper
    // should still produce a valid one-line CSV with just the added
    // header — no padding work to do because there are no data rows.
    const sentCsv = buildEditedCsv({
      matrix: [],
      headerEdits: {},
      addedColumns: ["account_name"],
      edits: {},
    });

    expect(readCsv(sentCsv)).toEqual([["account_name"]]);
  });

  it("routes a post-rename row edit to the renamed column, not the original index", () => {
    // The header originally has "line type" (typo) at index 2. The
    // user (1) renames it to "line_type" and (2) edits row 2's
    // line_type cell to a valid key. The edit must land at column
    // index 2 — i.e. it has to be re-derived from the rewritten
    // header, not from the pre-rename indexOf("line_type") which
    // would be -1 and silently drop the edit.
    const csv =
      "vendor_id,partner_id,line type,account_name,account_number\n" +
      ",,bogus,Subcontracted Labor,5010\n";
    const matrix = readCsv(csv);

    const sentCsv = buildEditedCsv({
      matrix,
      headerEdits: { 2: "line_type" },
      addedColumns: [],
      edits: { 2: { lineType: "labor_regular" } },
    });

    const out = readCsv(sentCsv);
    expect(out[0][2]).toBe("line_type");
    // The replacement value lands in the renamed column, not column
    // 0 (vendor_id) or anywhere else. The other cells of the row
    // remain untouched.
    expect(out[1]).toEqual([
      "",
      "",
      "labor_regular",
      "Subcontracted Labor",
      "5010",
    ]);
  });

  it("routes a row edit into a freshly-added column once it exists in the live header", () => {
    // After the user adds "account_name" to a CSV that didn't have
    // it, the live header gains a new column at the end. A row edit
    // for accountName should be written into that new column — not
    // dropped because the original headerInfo.colIndex.account_name
    // was -1.
    const csv =
      "vendor_id,partner_id,line_type,account_number\n" +
      ",,labor_regular,5010\n";
    const matrix = readCsv(csv);

    const sentCsv = buildEditedCsv({
      matrix,
      headerEdits: {},
      addedColumns: ["account_name"],
      edits: { 2: { accountName: "Subcontracted Labor" } },
    });

    const out = readCsv(sentCsv);
    expect(out[0]).toEqual([
      "vendor_id",
      "partner_id",
      "line_type",
      "account_number",
      "account_name",
    ]);
    expect(out[1]).toEqual([
      "",
      "",
      "labor_regular",
      "5010",
      "Subcontracted Labor",
    ]);
  });

  it("ignores edits that target a row outside the matrix", () => {
    // Defensive: if the parent component passes an edit keyed by a
    // rowNumber that no longer maps to a real row (e.g. the user
    // added more rows then re-validated, shrinking the matrix), the
    // helper must not crash and must not invent a new row for them.
    const csv = "vendor_id,partner_id,line_type,account_name,account_number\n";
    const matrix = readCsv(csv);

    const sentCsv = buildEditedCsv({
      matrix,
      headerEdits: {},
      addedColumns: [],
      edits: { 99: { vendorId: "42" } },
    });

    expect(readCsv(sentCsv)).toEqual([
      ["vendor_id", "partner_id", "line_type", "account_name", "account_number"],
    ]);
  });
});

// Direct unit tests for computeBulkRenameCandidates — the pure helper
// that powers the "Apply to other columns" affordance. Driving it as a
// function lets us cover the threshold + canonical-pool branches with
// minimal fixture setup.
describe("computeBulkRenameCandidates", () => {
  it("infers renames for every other typo'd column when one is accepted", () => {
    // The exporter mangled every header the same way (spaces instead
    // of underscores). After the user accepts the suggestion on one
    // column, the helper should match the same normalization on every
    // remaining unknown column whose suggestion clears the threshold.
    const baseHeader = [
      "vendor id",
      "partner id",
      "line type",
      "account name",
      "account number",
    ];
    const candidates = computeBulkRenameCandidates({
      baseHeader,
      // The user already accepted "vendor id" -> "vendor_id" via the
      // suggestion pill, so headerEdits[0] is set and column 0 is
      // also the one we're excluding from the bulk apply.
      headerEdits: { 0: "vendor_id" },
      addedColumns: [],
      excludeColIdx: 0,
    });
    expect(candidates).toEqual({
      1: "partner_id",
      2: "line_type",
      3: "account_name",
      4: "account_number",
    });
  });

  it("skips columns the admin already touched and the just-renamed column", () => {
    const baseHeader = ["vendor id", "partner id", "line type", "x"];
    const candidates = computeBulkRenameCandidates({
      baseHeader,
      // Column 0 was the accepted suggestion; column 1 was hand-edited
      // to a custom value the user wants kept. The bulk apply must
      // leave both alone and only operate on the remaining unknowns.
      headerEdits: { 0: "vendor_id", 1: "PARTNER ID (custom)" },
      addedColumns: [],
      excludeColIdx: 0,
    });
    // "line type" still gets a confident match; "x" is too short and
    // unlike any canonical to clear the threshold so it's omitted.
    expect(candidates).toEqual({ 2: "line_type" });
  });

  it("skips columns whose live name is already a canonical match", () => {
    const baseHeader = [
      "vendor_id", // already canonical
      "partner id", // typo
      "line_type", // already canonical
    ];
    const candidates = computeBulkRenameCandidates({
      baseHeader,
      headerEdits: { 1: "partner_id" }, // accepted the suggestion
      addedColumns: [],
      excludeColIdx: 1,
    });
    // Both other columns are already canonical so nothing remains to
    // bulk-rename.
    expect(candidates).toEqual({});
  });

  it("does not assign the same canonical to two different columns", () => {
    // Two unknown columns both fuzzy-match "vendor_id" — the helper
    // walks left-to-right and removes each canonical from the pool
    // once consumed, so the second column shouldn't reuse vendor_id.
    const baseHeader = ["vendor id", "vendor-id", "line type"];
    const candidates = computeBulkRenameCandidates({
      baseHeader,
      // Pretend the user accepted on a different (excluded) column.
      // We pass an out-of-range excludeColIdx so column 0 is still
      // considered, mirroring the real flow where excludeColIdx
      // points at the just-accepted column (and headerEdits has it).
      headerEdits: {},
      addedColumns: [],
      excludeColIdx: -1,
    });
    expect(candidates[0]).toBe("vendor_id");
    expect(candidates[1]).not.toBe("vendor_id");
    expect(candidates[2]).toBe("line_type");
  });

  it("returns an empty object when no other column has a confident match", () => {
    // Random placeholder headers — none should fuzzy-match a canonical
    // strongly enough to clear the threshold.
    const baseHeader = ["vendor id", "foo", "bar baz"];
    const candidates = computeBulkRenameCandidates({
      baseHeader,
      headerEdits: { 0: "vendor_id" },
      addedColumns: [],
      excludeColIdx: 0,
    });
    expect(candidates).toEqual({});
  });
});

// End-to-end coverage of the bulk-apply affordance through the rendered
// dialog. Verifies (1) the affordance is gated on accepting a suggestion
// (not just on any free-text edit), and (2) clicking it bakes every
// inferred rename into the CSV that ships back to onRevalidate.
describe("CsvImportPreviewDialog bulk-apply suggestion affordance", () => {
  function previewWithMangledHeader(): CsvPreviewState {
    // Header has every column typo'd the same way (spaces instead of
    // underscores) so the server rejected the file with a single
    // header-row error. The dialog should surface CsvHeaderEditor.
    const csv =
      "vendor id,partner id,line type,account name,account number\n" +
      "1,,labor_regular,Subcontracted Labor,5010\n";
    return {
      csv,
      inserts: [],
      updates: [],
      unchanged: [],
      errors: [{ rowNumber: 1, message: "unknown column: vendor id" }],
      vendorNames: {},
      partnerNames: {},
    };
  }

  it("hides the affordance until the admin accepts a suggestion", () => {
    renderDialog({ preview: previewWithMangledHeader() });
    // The header editor renders, but the bulk affordance starts hidden.
    expect(screen.getByTestId("csv-header-editor")).toBeTruthy();
    expect(screen.queryByTestId("csv-header-bulk-apply")).toBeNull();
    expect(screen.queryByTestId("button-header-bulk-apply")).toBeNull();
  });

  it("does not show the affordance for plain text edits (only suggestion pills)", () => {
    renderDialog({ preview: previewWithMangledHeader() });
    // Typing into the input is treated as a manual rename, not an
    // accepted suggestion — the bulk affordance must stay hidden so
    // we don't push admins into bulk-rewrites they didn't ask for.
    fireEvent.change(screen.getByTestId("input-header-0"), {
      target: { value: "vendor_id" },
    });
    expect(screen.queryByTestId("csv-header-bulk-apply")).toBeNull();
  });

  it("surfaces the affordance after the admin accepts a suggestion pill", () => {
    renderDialog({ preview: previewWithMangledHeader() });
    // Click the suggested pill on column 0 — this records the accept
    // and lights up the bulk affordance pointing at the four other
    // typo'd columns.
    fireEvent.click(
      screen.getByTestId("button-header-0-rename-vendor_id"),
    );
    const bulkButton = screen.getByTestId(
      "button-header-bulk-apply",
    ) as HTMLButtonElement;
    expect(bulkButton).toBeTruthy();
    // The action label is pluralized — should mention 4 other columns.
    expect(bulkButton.textContent).toContain("4");
  });

  it("bakes every inferred rename into the re-validate CSV in one click", async () => {
    const onRevalidate = vi.fn().mockResolvedValue(undefined);
    renderDialog({ preview: previewWithMangledHeader(), onRevalidate });

    fireEvent.click(
      screen.getByTestId("button-header-0-rename-vendor_id"),
    );
    fireEvent.click(screen.getByTestId("button-header-bulk-apply"));

    // After bulk-apply, the affordance disappears (no more candidates)
    // and the dialog has 5 pending header edits ready to send.
    expect(screen.queryByTestId("csv-header-bulk-apply")).toBeNull();

    fireEvent.click(screen.getByTestId("button-preview-revalidate"));
    expect(onRevalidate).toHaveBeenCalledTimes(1);
    const sentCsv = onRevalidate.mock.calls[0][0] as string;
    const matrix = readCsv(sentCsv);
    // Every column was renamed in one click — header now uses the
    // canonical underscore-separated names.
    expect(matrix[0]).toEqual([
      "vendor_id",
      "partner_id",
      "line_type",
      "account_name",
      "account_number",
    ]);
    // Data row passes through verbatim.
    expect(matrix[1]).toEqual([
      "1",
      "",
      "labor_regular",
      "Subcontracted Labor",
      "5010",
    ]);
  });
});
