import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PillButton } from "@/components/pill";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { readCsv, suggestCanonicalName, writeCsv } from "@/lib/csv";

export interface CsvPreviewRow {
  rowNumber: number;
  vendorId: number | null;
  partnerId: number | null;
  lineType: string;
  accountName: string;
  accountNumber: string | null;
}

export interface CsvPreviewUpdateRow extends CsvPreviewRow {
  oldAccountName: string;
  oldAccountNumber: string | null;
}

export interface CsvPreviewError {
  rowNumber: number;
  message: string;
}

export interface CsvPreviewState {
  csv: string;
  inserts: CsvPreviewRow[];
  updates: CsvPreviewUpdateRow[];
  unchanged: CsvPreviewRow[];
  errors: CsvPreviewError[];
  vendorNames: Record<number, string>;
  partnerNames: Record<number, string>;
}

export interface CsvImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  preview: CsvPreviewState | null;
  applying: boolean;
  revalidating: boolean;
  previewError: string | null;
  onApply: () => Promise<void>;
  onRevalidate: (csv: string) => Promise<void>;
}

function formatCsvScope(
  vendorId: number | null,
  partnerId: number | null,
  vendorNames: Record<number, string>,
  partnerNames: Record<number, string>,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  if (vendorId != null) {
    parts.push(
      vendorNames[vendorId] ??
        t("reports.qbMapping.importPreview.scopeVendor", { id: vendorId }),
    );
  }
  if (partnerId != null) {
    parts.push(
      partnerNames[partnerId] ??
        t("reports.qbMapping.importPreview.scopePartner", { id: partnerId }),
    );
  }
  return parts.length === 0
    ? t("reports.qbMapping.importPreview.scopeGlobal")
    : parts.join(" · ");
}

function formatCsvAccount(name: string, number: string | null): string {
  return number ? `${name} (${number})` : name;
}

/**
 * Editable cells used by the inline error-row editor. Strings everywhere so
 * we can write them straight back into the CSV matrix; the server re-parses
 * on dry-run / apply and returns fresh validation errors.
 */
export interface EditableCells {
  vendorId: string;
  partnerId: string;
  lineType: string;
  accountName: string;
  accountNumber: string;
}

const EDITABLE_COLUMN_NAMES = [
  "vendor_id",
  "partner_id",
  "line_type",
  "account_name",
  "account_number",
] as const;

type EditableColumnName = (typeof EDITABLE_COLUMN_NAMES)[number];

/**
 * Pure helper that bakes pending header renames, header additions, and
 * per-row edits into a fresh CSV string. Lives outside the dialog so it
 * can be unit-tested in isolation (see reports.csv-import.test.tsx).
 *
 * The serialization order mirrors what the dialog does at re-validate
 * time:
 *   1. Apply header renames + additions before touching data rows so the
 *      re-derived column index lines up with the rewritten header.
 *   2. Re-derive the column index from the rewritten header so per-row
 *      edits land in the right cell after a rename — even if a column
 *      moved or was just added.
 *   3. Pad data rows that are shorter than the rewritten header so the
 *      matrix stays rectangular before serialization.
 */
export function buildEditedCsv(args: {
  matrix: ReadonlyArray<ReadonlyArray<string>>;
  headerEdits: Record<number, string>;
  addedColumns: ReadonlyArray<string>;
  edits: Record<number, Partial<EditableCells>>;
}): string {
  // Deep-copy the matrix so we don't mutate the caller's structure.
  const matrix: string[][] = args.matrix.map((row) => row.slice());
  if (matrix.length === 0) {
    // Edge case: empty CSV. Synthesize a header row from the additions
    // alone — no data rows to pad.
    if (args.addedColumns.length > 0) {
      matrix.push([...args.addedColumns]);
    }
  } else {
    const header = matrix[0];
    for (const [colStr, val] of Object.entries(args.headerEdits)) {
      const colIdx = Number(colStr);
      while (header.length <= colIdx) header.push("");
      header[colIdx] = val;
    }
    if (args.addedColumns.length > 0) {
      header.push(...args.addedColumns);
      // Pad every data row so the matrix stays rectangular.
      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r];
        while (row.length < header.length) row.push("");
      }
    }
  }
  const liveHeader = (matrix[0] ?? []).map((c) => c.trim().toLowerCase());
  const liveColIndex: Record<EditableColumnName, number> = {
    vendor_id: liveHeader.indexOf("vendor_id"),
    partner_id: liveHeader.indexOf("partner_id"),
    line_type: liveHeader.indexOf("line_type"),
    account_name: liveHeader.indexOf("account_name"),
    account_number: liveHeader.indexOf("account_number"),
  };
  for (const [rowNumStr, cells] of Object.entries(args.edits)) {
    const rowNumber = Number(rowNumStr);
    const row = matrix[rowNumber - 1];
    if (!row) continue;
    for (const colName of EDITABLE_COLUMN_NAMES) {
      const colIdx = liveColIndex[colName];
      if (colIdx < 0) continue;
      const camel = colName.replace(/_(.)/g, (_m, c: string) =>
        c.toUpperCase(),
      ) as keyof EditableCells;
      const newVal = cells[camel];
      if (newVal === undefined) continue;
      // Pad short rows so we can write into the column.
      while (row.length <= colIdx) row.push("");
      row[colIdx] = newVal;
    }
  }
  return writeCsv(matrix);
}

interface CsvHeaderInfo {
  /** matrix[0] (raw header row) for round-tripping. */
  matrix: string[][];
  /** colIndex[name] = column index in the matrix, or -1 if not present. */
  colIndex: Record<EditableColumnName, number>;
}

function parseHeader(csv: string): CsvHeaderInfo {
  const matrix = readCsv(csv);
  const header = (matrix[0] ?? []).map((c) => c.trim().toLowerCase());
  const colIndex: Record<EditableColumnName, number> = {
    vendor_id: header.indexOf("vendor_id"),
    partner_id: header.indexOf("partner_id"),
    line_type: header.indexOf("line_type"),
    account_name: header.indexOf("account_name"),
    account_number: header.indexOf("account_number"),
  };
  return { matrix, colIndex };
}

function getCell(matrix: string[][], rowNumber: number, colIdx: number): string {
  if (colIdx < 0) return "";
  const row = matrix[rowNumber - 1];
  if (!row) return "";
  return row[colIdx] ?? "";
}

const REQUIRED_HEADER_COLUMNS: ReadonlyArray<EditableColumnName> = [
  "line_type",
  "account_name",
];

/**
 * Pure helper that scans the *other* (non-edited) header cells for ones
 * whose fuzzy suggestion clears the same threshold the per-cell editor
 * uses, so a single accept-suggestion click can be replayed across the
 * whole header in one go. Used by the "Apply to other columns"
 * affordance that surfaces after the admin accepts any suggested rename.
 *
 * Skips:
 *  - The column the user just renamed (`excludeColIdx`).
 *  - Any column with a pending `headerEdits` entry — those have been
 *    explicitly touched (renamed, cleared, or accepted) so we don't
 *    second-guess the admin.
 *  - Cells that already match a canonical column name verbatim.
 *
 * Iterates left-to-right so canonicals are claimed in document order
 * (each canonical can only be assigned to one column, mirroring the
 * per-cell editor's `presentKnown` filter).
 */
export function computeBulkRenameCandidates(args: {
  baseHeader: ReadonlyArray<string>;
  headerEdits: Record<number, string>;
  addedColumns: ReadonlyArray<string>;
  excludeColIdx: number;
}): Record<number, string> {
  const liveCells = args.baseHeader
    .map((c, i) => args.headerEdits[i] ?? c)
    .concat(args.addedColumns);
  const presentKnown = new Set<string>();
  for (const cell of liveCells) {
    const lower = cell.trim().toLowerCase();
    if ((EDITABLE_COLUMN_NAMES as ReadonlyArray<string>).includes(lower)) {
      presentKnown.add(lower);
    }
  }
  const remaining: EditableColumnName[] = (
    EDITABLE_COLUMN_NAMES as ReadonlyArray<EditableColumnName>
  ).filter((n) => !presentKnown.has(n));
  const out: Record<number, string> = {};
  for (let idx = 0; idx < args.baseHeader.length; idx++) {
    if (idx === args.excludeColIdx) continue;
    if (Object.prototype.hasOwnProperty.call(args.headerEdits, idx)) continue;
    const cell = args.baseHeader[idx];
    const lower = cell.trim().toLowerCase();
    if ((EDITABLE_COLUMN_NAMES as ReadonlyArray<string>).includes(lower)) {
      continue;
    }
    if (remaining.length === 0) break;
    const guess = suggestCanonicalName(cell, remaining);
    if (!guess) continue;
    out[idx] = guess.name;
    const used = remaining.indexOf(guess.name);
    if (used >= 0) remaining.splice(used, 1);
  }
  return out;
}

export function CsvImportPreviewDialog({
  open,
  onOpenChange,
  preview,
  applying,
  revalidating,
  previewError,
  onApply,
  onRevalidate,
}: CsvImportPreviewDialogProps): ReactElement {
  const { t } = useTranslation();
  // Cap rendered rows per section so a 5,000-row CSV doesn't lock up the
  // dialog. The full counts are still shown in the summary above.
  const MAX_ROWS = 25;
  const insertCount = preview?.inserts.length ?? 0;
  const updateCount = preview?.updates.length ?? 0;
  const unchangedCount = preview?.unchanged.length ?? 0;
  const errorCount = preview?.errors.length ?? 0;
  const applyCount = insertCount + updateCount;

  // Parse the current CSV once per preview so the inline error editor can
  // show the offending cells with their existing values. The matrix is
  // also what we mutate + re-serialize when the user clicks "Re-validate".
  const headerInfo = useMemo<CsvHeaderInfo>(
    () => parseHeader(preview?.csv ?? ""),
    [preview?.csv],
  );

  // Local edits keyed by rowNumber. Reset whenever a new preview lands so
  // the inputs reflect the latest server-validated state.
  const [edits, setEdits] = useState<Record<number, Partial<EditableCells>>>(
    {},
  );
  // Header rename edits keyed by column index in the original matrix[0].
  const [headerEdits, setHeaderEdits] = useState<Record<number, string>>({});
  // Brand-new header columns appended to the right of the existing header.
  // Used when a required column (line_type / account_name) is completely
  // missing from the file. Each added column also pads every data row
  // with an empty cell so the matrix stays rectangular.
  const [addedHeaderColumns, setAddedHeaderColumns] = useState<string[]>([]);
  // Most-recent column index where the admin clicked an "Use as ..."
  // suggestion pill. Used to surface the "Apply to other columns"
  // affordance — when the same CSV exporter mangled every header the
  // same way, accepting one suggestion is enough to infer the rest.
  // Cleared when a new preview lands or the bulk apply is taken.
  const [lastAcceptedColIdx, setLastAcceptedColIdx] = useState<number | null>(
    null,
  );
  useEffect(() => {
    setEdits({});
    setHeaderEdits({});
    setAddedHeaderColumns([]);
    setLastAcceptedColIdx(null);
  }, [preview?.csv]);

  // Compute the live (post-edit) header used for "missing required" checks
  // and for deciding whether the editor needs to surface itself.
  const baseHeader = headerInfo.matrix[0] ?? [];
  const liveHeaderCells = baseHeader
    .map((c, i) => headerEdits[i] ?? c)
    .concat(addedHeaderColumns);
  const liveHeaderNames = new Set(
    liveHeaderCells.map((c) => c.trim().toLowerCase()),
  );
  const missingRequired = REQUIRED_HEADER_COLUMNS.filter(
    (n) => !liveHeaderNames.has(n),
  );
  // Show the header editor whenever the server flagged a header-row
  // problem (rowNumber === 1) OR our own re-check finds a required column
  // missing. The latter also covers the optimistic case where the user
  // un-renamed a column without re-validating yet.
  const headerErrors = (preview?.errors ?? []).filter((e) => e.rowNumber <= 1);
  const dataErrors = (preview?.errors ?? []).filter((e) => e.rowNumber > 1);
  const hasHeaderIssue = headerErrors.length > 0 || missingRequired.length > 0;

  const headerEditCount =
    Object.keys(headerEdits).length + addedHeaderColumns.length;
  const hasHeaderEdits = headerEditCount > 0;
  const hasRowEdits = Object.keys(edits).length > 0;
  const hasEdits = hasRowEdits || hasHeaderEdits;
  const canRevalidate =
    hasEdits && missingRequired.length === 0 && !revalidating && !applying;
  const canApply = !applying && !revalidating && !hasEdits && applyCount > 0;

  function updateEdit(
    rowNumber: number,
    column: EditableColumnName,
    value: string,
  ): void {
    setEdits((prev) => {
      const colKey = column.replace(/_(.)/g, (_m, c: string) =>
        c.toUpperCase(),
      ) as keyof EditableCells;
      const next = { ...(prev[rowNumber] ?? {}) };
      next[colKey] = value;
      return { ...prev, [rowNumber]: next };
    });
  }

  function updateHeaderCell(colIdx: number, value: string): void {
    setHeaderEdits((prev) => ({ ...prev, [colIdx]: value }));
  }

  // Variant of updateHeaderCell triggered by the "Use as ..." suggestion
  // pills. Records the column index so the bulk-apply affordance can
  // light up afterwards. Plain typing keeps using updateHeaderCell so
  // the affordance stays gated on an actual accepted suggestion.
  function acceptHeaderSuggestion(colIdx: number, value: string): void {
    setHeaderEdits((prev) => ({ ...prev, [colIdx]: value }));
    setLastAcceptedColIdx(colIdx);
  }

  // Bulk-apply: merge each candidate {colIdx -> canonicalName} into
  // headerEdits in one shot. Each rename is still tracked in the same
  // headerEdits map, so the existing per-column reset / re-validate
  // path keeps working — including individual undo via clearing a cell.
  function applyBulkRenames(renames: Record<number, string>): void {
    setHeaderEdits((prev) => ({ ...prev, ...renames }));
    setLastAcceptedColIdx(null);
  }

  function addHeaderColumn(name: EditableColumnName): void {
    setAddedHeaderColumns((prev) =>
      prev.some((c) => c.trim().toLowerCase() === name) ? prev : [...prev, name],
    );
  }

  function removeAddedHeaderColumn(idx: number): void {
    setAddedHeaderColumns((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleRevalidate(): Promise<void> {
    if (!canRevalidate) return;
    await onRevalidate(
      buildEditedCsv({
        matrix: headerInfo.matrix,
        headerEdits,
        addedColumns: addedHeaderColumns,
        edits,
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        data-testid="dialog-csv-import-preview"
      >
        <DialogHeader>
          <DialogTitle>
            {t("reports.qbMapping.importPreview.title")}
          </DialogTitle>
          <DialogDescription>
            {t("reports.qbMapping.importPreview.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <p
            className="text-sm font-medium"
            data-testid="text-preview-summary"
          >
            {t("reports.qbMapping.importPreview.summary", {
              inserts: insertCount,
              updates: updateCount,
              unchanged: unchangedCount,
              errors: errorCount,
            })}
          </p>
          {previewError && (
            <p
              className="text-sm text-destructive"
              data-testid="text-preview-error"
            >
              {previewError}
            </p>
          )}
          {applyCount === 0 && errorCount === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("reports.qbMapping.importPreview.noChanges")}
            </p>
          )}
          {(errorCount > 0 || hasHeaderIssue) && (
            <div data-testid="section-preview-errors">
              <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                <h4 className="text-sm font-semibold text-destructive">
                  {errorCount > 0
                    ? `${t(
                        "reports.qbMapping.importPreview.errorsHeading",
                      )} (${errorCount})`
                    : t(
                        "reports.qbMapping.importPreview.headerEditor.title",
                      )}
                </h4>
                <div className="flex items-center gap-2">
                  {hasEdits && (
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid="text-preview-edits-pending"
                    >
                      {t("reports.qbMapping.importPreview.editsPending", {
                        count: headerEditCount + Object.keys(edits).length,
                      })}
                    </span>
                  )}
                  <PillButton
                    type="button"
                    color="image"
                    disabled={!canRevalidate}
                    onClick={() => {
                      void handleRevalidate();
                    }}
                    data-testid="button-preview-revalidate"
                  >
                    {revalidating
                      ? t("reports.qbMapping.importPreview.revalidating")
                      : t("reports.qbMapping.importPreview.revalidate")}
                  </PillButton>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {t("reports.qbMapping.importPreview.editHint")}
              </p>
              <div className="space-y-2">
                {hasHeaderIssue && (
                  <CsvHeaderEditor
                    baseHeader={baseHeader}
                    headerEdits={headerEdits}
                    addedColumns={addedHeaderColumns}
                    headerErrorMessage={headerErrors[0]?.message ?? null}
                    missingRequired={missingRequired}
                    onCellRename={updateHeaderCell}
                    onAcceptSuggestion={acceptHeaderSuggestion}
                    onAddColumn={addHeaderColumn}
                    onRemoveAddedColumn={removeAddedHeaderColumn}
                    bulkRenameCandidates={
                      lastAcceptedColIdx !== null
                        ? computeBulkRenameCandidates({
                            baseHeader,
                            headerEdits,
                            addedColumns: addedHeaderColumns,
                            excludeColIdx: lastAcceptedColIdx,
                          })
                        : null
                    }
                    onApplyBulkRenames={applyBulkRenames}
                  />
                )}
                {dataErrors.slice(0, MAX_ROWS).map((e) => (
                  <CsvErrorRowEditor
                    key={e.rowNumber}
                    error={e}
                    headerInfo={headerInfo}
                    edit={edits[e.rowNumber]}
                    onChange={(col, val) => updateEdit(e.rowNumber, col, val)}
                  />
                ))}
                {dataErrors.length > MAX_ROWS && (
                  <p className="text-sm text-muted-foreground">
                    {t("reports.qbMapping.importPreview.moreRows", {
                      count: dataErrors.length - MAX_ROWS,
                    })}
                  </p>
                )}
              </div>
            </div>
          )}
          {insertCount > 0 && (
            <div data-testid="section-preview-inserts">
              <h4 className="text-sm font-semibold mb-1 text-emerald-600">
                {t("reports.qbMapping.importPreview.insertsHeading", {
                  count: insertCount,
                })}
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("reports.qbMapping.col.lineType")}
                    </TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>
                      {t("reports.qbMapping.col.accountName")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(preview?.inserts ?? [])
                    .slice(0, MAX_ROWS)
                    .map((row) => (
                      <TableRow
                        key={`ins-${row.rowNumber}`}
                        data-testid={`row-preview-insert-${row.rowNumber}`}
                      >
                        <TableCell className="text-xs">
                          <div
                            className="font-medium"
                            title={row.lineType}
                          >
                            {friendlyLineType(row.lineType)}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {row.lineType}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatCsvScope(
                            row.vendorId,
                            row.partnerId,
                            preview?.vendorNames ?? {},
                            preview?.partnerNames ?? {},
                            t,
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatCsvAccount(
                            row.accountName,
                            row.accountNumber,
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {insertCount > MAX_ROWS && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("reports.qbMapping.importPreview.moreRows", {
                    count: insertCount - MAX_ROWS,
                  })}
                </p>
              )}
            </div>
          )}
          {updateCount > 0 && (
            <div data-testid="section-preview-updates">
              <h4 className="text-sm font-semibold mb-1 text-amber-600">
                {t("reports.qbMapping.importPreview.updatesHeading", {
                  count: updateCount,
                })}
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("reports.qbMapping.col.lineType")}
                    </TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(preview?.updates ?? [])
                    .slice(0, MAX_ROWS)
                    .map((row) => (
                      <TableRow
                        key={`upd-${row.rowNumber}`}
                        data-testid={`row-preview-update-${row.rowNumber}`}
                      >
                        <TableCell className="text-xs">
                          <div
                            className="font-medium"
                            title={row.lineType}
                          >
                            {friendlyLineType(row.lineType)}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {row.lineType}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatCsvScope(
                            row.vendorId,
                            row.partnerId,
                            preview?.vendorNames ?? {},
                            preview?.partnerNames ?? {},
                            t,
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {t("reports.qbMapping.importPreview.rowOldNew", {
                            oldName: formatCsvAccount(
                              row.oldAccountName,
                              row.oldAccountNumber,
                            ),
                            newName: formatCsvAccount(
                              row.accountName,
                              row.accountNumber,
                            ),
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {updateCount > MAX_ROWS && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("reports.qbMapping.importPreview.moreRows", {
                    count: updateCount - MAX_ROWS,
                  })}
                </p>
              )}
            </div>
          )}
          {unchangedCount > 0 && (
            <details data-testid="section-preview-unchanged">
              <summary className="cursor-pointer text-sm text-muted-foreground">
                {t("reports.qbMapping.importPreview.unchangedHeading", {
                  count: unchangedCount,
                })}
              </summary>
              <ul className="list-disc pl-5 text-xs text-muted-foreground mt-1 space-y-0.5">
                {(preview?.unchanged ?? [])
                  .slice(0, MAX_ROWS)
                  .map((row) => (
                    <li key={`unc-${row.rowNumber}`}>
                      <span title={row.lineType}>
                        {friendlyLineType(row.lineType)}
                      </span>{" "}
                      <span className="font-mono">({row.lineType})</span> ·{" "}
                      {formatCsvScope(
                        row.vendorId,
                        row.partnerId,
                        preview?.vendorNames ?? {},
                        preview?.partnerNames ?? {},
                        t,
                      )}{" "}
                      ·{" "}
                      {formatCsvAccount(row.accountName, row.accountNumber)}
                    </li>
                  ))}
                {unchangedCount > MAX_ROWS && (
                  <li>
                    {t("reports.qbMapping.importPreview.moreRows", {
                      count: unchangedCount - MAX_ROWS,
                    })}
                  </li>
                )}
              </ul>
            </details>
          )}
        </div>
        <DialogFooter>
          <PillButton
            color="red"
            onClick={() => onOpenChange(false)}
            disabled={applying}
            data-testid="button-preview-cancel"
          >
            {t("reports.qbMapping.importPreview.cancel")}
          </PillButton>
          <PillButton
            color="blue"
            onClick={() => {
              void onApply();
            }}
            disabled={!canApply}
            data-testid="button-preview-apply"
          >
            {applying
              ? t("reports.qbMapping.importPreview.applying")
              : hasEdits
                ? t("reports.qbMapping.importPreview.applyDisabledRevalidate")
                : applyCount > 0
                  ? t("reports.qbMapping.importPreview.applyButton", {
                      count: applyCount,
                    })
                  : t("reports.qbMapping.importPreview.applyDisabled")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Documented set of allowed `line_type` values, mirroring
// MAPPABLE_LINE_TYPES in artifacts/api-server/src/lib/reports/qb-mapping.ts.
// Kept here so the typo suggestion is purely client-side (no extra
// round-trip just to render a hint). The server is still the source of
// truth on re-validate; this list drives the "Did you mean…?" UI, the
// row-editor dropdown, and the friendly-label rendering used throughout
// the import preview so admins see "Labor — regular" instead of
// "labor_regular".
const LINE_TYPE_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "labor_regular", label: "Labor — regular" },
  { key: "labor_overtime", label: "Labor — overtime" },
  { key: "equipment", label: "Equipment" },
  { key: "materials", label: "Materials" },
  { key: "mileage", label: "Mileage" },
  { key: "per_diem", label: "Per diem" },
  { key: "markup", label: "Markup" },
  { key: "discount", label: "Discount" },
  { key: "other", label: "Other" },
  { key: "ar", label: "Accounts Receivable (control)" },
  { key: "tax_payable", label: "Sales Tax Payable" },
];

export const ALLOWED_LINE_TYPES: readonly string[] = LINE_TYPE_OPTIONS.map(
  (o) => o.key,
);

const LINE_TYPE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  LINE_TYPE_OPTIONS.map((o) => [o.key, o.label]),
);

/**
 * Friendly label for a line_type key, falling back to the raw key when
 * we don't recognize it (e.g. a future server-side line type the client
 * hasn't been updated for). Used everywhere the import preview renders
 * a line_type so admins see "Labor — regular" instead of
 * "labor_regular".
 */
function friendlyLineType(key: string): string {
  return LINE_TYPE_LABELS[key] ?? key;
}

// Per-column enum values that drive the row editor's "Did you mean…?"
// pill. Free-form columns (account_name, account_number, vendor_id,
// partner_id) are deliberately absent so they never show a suggestion —
// there's no canonical list to match against.
const ROW_ENUM_VALUES_BY_COLUMN: Partial<
  Record<EditableColumnName, ReadonlyArray<string>>
> = {
  line_type: ALLOWED_LINE_TYPES,
};

/**
 * Suggest the closest valid enum value for a row cell, or null when the
 * column is free-form, the input is empty, the input is already a valid
 * key, or no candidate clears the fuzzy-match threshold. Reuses the same
 * `suggestCanonicalName` helper the header editor uses so the row and
 * header editors stay visually and behaviorally consistent (e.g. both
 * tolerate case differences like "Labor_Regular" → "labor_regular").
 */
function suggestRowEnumValue(
  column: EditableColumnName,
  input: string,
): string | null {
  const candidates = ROW_ENUM_VALUES_BY_COLUMN[column];
  if (!candidates) return null;
  const raw = input.trim();
  if (!raw) return null;
  // Server validation is case-sensitive on these enum keys, so only
  // suppress the suggestion when the raw input is already a valid key.
  // A case-only mismatch like "Labor_Regular" still earns a hint.
  if (candidates.includes(raw)) return null;
  const match = suggestCanonicalName(raw, candidates);
  return match?.name ?? null;
}

interface CsvErrorRowEditorProps {
  error: CsvPreviewError;
  headerInfo: CsvHeaderInfo;
  edit: Partial<EditableCells> | undefined;
  onChange: (column: EditableColumnName, value: string) => void;
}

/**
 * Inline editor for one skipped CSV row. Shows the original error message
 * plus an input for each column the header actually has, pre-filled with
 * the cell value from the source CSV. The parent dialog tracks edits and
 * bakes them into the CSV when the user clicks "Re-validate".
 */
function CsvErrorRowEditor({
  error,
  headerInfo,
  edit,
  onChange,
}: CsvErrorRowEditorProps): ReactElement {
  const { t } = useTranslation();
  // The header itself failed to parse (e.g. missing required columns).
  // Editing the header inline is out of scope — show the message only.
  const isHeaderError =
    error.rowNumber <= 1 || (headerInfo.matrix[error.rowNumber - 1] ?? null) === null;

  function fieldValue(
    column: EditableColumnName,
    cellsKey: keyof EditableCells,
  ): string {
    const edited = edit?.[cellsKey];
    if (edited !== undefined) return edited;
    return getCell(
      headerInfo.matrix,
      error.rowNumber,
      headerInfo.colIndex[column],
    );
  }

  const fields: Array<{
    column: EditableColumnName;
    cellsKey: keyof EditableCells;
    labelKey: string;
    inputMode?: "numeric";
  }> = [
    {
      column: "vendor_id",
      cellsKey: "vendorId",
      labelKey: "reports.qbMapping.importPreview.field.vendorId",
      inputMode: "numeric",
    },
    {
      column: "partner_id",
      cellsKey: "partnerId",
      labelKey: "reports.qbMapping.importPreview.field.partnerId",
      inputMode: "numeric",
    },
    {
      column: "line_type",
      cellsKey: "lineType",
      labelKey: "reports.qbMapping.importPreview.field.lineType",
    },
    {
      column: "account_name",
      cellsKey: "accountName",
      labelKey: "reports.qbMapping.importPreview.field.accountName",
    },
    {
      column: "account_number",
      cellsKey: "accountNumber",
      labelKey: "reports.qbMapping.importPreview.field.accountNumber",
    },
  ];

  const visibleFields = fields.filter(
    (f) => headerInfo.colIndex[f.column] >= 0,
  );

  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/5 p-3"
      data-testid={`row-preview-error-${error.rowNumber}`}
    >
      <p className="text-sm text-destructive font-medium">
        {t("reports.qbMapping.importRowError", {
          row: error.rowNumber,
          msg: error.message,
        })}
      </p>
      {!isHeaderError && visibleFields.length > 0 && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {visibleFields.map((f) => {
            const value = fieldValue(f.column, f.cellsKey);
            // The line_type column is a closed enum, so render it as a
            // dropdown of the documented allowed values (with friendly
            // labels). This makes a one-click correction possible and
            // prevents the admin from introducing a new typo. The
            // "Did you mean…?" pill is unnecessary here since the
            // value can no longer drift away from the canonical set.
            if (f.column === "line_type") {
              const isKnown = ALLOWED_LINE_TYPES.includes(value);
              return (
                <label
                  key={f.column}
                  className="flex flex-col text-xs gap-1"
                >
                  <span className="text-muted-foreground">
                    {t(f.labelKey)}
                  </span>
                  <Select
                    value={isKnown ? value : ""}
                    onValueChange={(v) => onChange(f.column, v)}
                  >
                    <SelectTrigger
                      className="h-8 text-sm"
                      data-testid={`select-error-${error.rowNumber}-${f.column}`}
                    >
                      <SelectValue
                        placeholder={
                          value
                            ? t(
                                "reports.qbMapping.importPreview.lineTypeInvalidPlaceholder",
                                { value },
                              )
                            : t(
                                "reports.qbMapping.importPreview.lineTypePlaceholder",
                              )
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {LINE_TYPE_OPTIONS.map((opt) => (
                        <SelectItem
                          key={opt.key}
                          value={opt.key}
                          data-testid={`select-error-${error.rowNumber}-${f.column}-option-${opt.key}`}
                        >
                          {opt.label}
                          <span className="ml-2 text-muted-foreground">
                            {opt.key}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              );
            }
            // "Did you mean…?" hint for any enum-typed cell whose
            // current input is close to (but not exactly) one of the
            // canonical values. Driven off the live value so the
            // suggestion updates as the user types and disappears
            // once they hit a valid key. Free-form columns
            // (account_name, vendor_id, etc.) have no enum config
            // and silently skip — no pill is shown.
            const enumSuggestion = suggestRowEnumValue(f.column, value);
            return (
              <label
                key={f.column}
                className="flex flex-col text-xs gap-1"
              >
                <span className="text-muted-foreground">
                  {t(f.labelKey)}
                </span>
                <Input
                  value={value}
                  inputMode={f.inputMode}
                  onChange={(ev) => onChange(f.column, ev.target.value)}
                  data-testid={`input-error-${error.rowNumber}-${f.column}`}
                  className="h-8 text-sm"
                />
                {enumSuggestion && (
                  <button
                    type="button"
                    onClick={() => onChange(f.column, enumSuggestion)}
                    className="self-start text-xs text-primary underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    data-testid={`button-suggest-${error.rowNumber}-${f.column}`}
                    title={enumSuggestion}
                  >
                    {t("reports.qbMapping.importPreview.didYouMean", {
                      // line_type is handled by the dropdown branch
                      // above, so this fallback only fires for
                      // future free-text enum columns. Show the raw
                      // value since there's no friendly-label map.
                      value: enumSuggestion,
                    })}
                  </button>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CsvHeaderEditorProps {
  /** matrix[0] from the most-recently-validated CSV (raw, untrimmed). */
  baseHeader: ReadonlyArray<string>;
  /** Pending rename per column index (in `baseHeader`). */
  headerEdits: Record<number, string>;
  /** Brand-new columns appended after `baseHeader`. */
  addedColumns: ReadonlyArray<string>;
  /** Server-supplied header error message (rowNumber === 1), if any. */
  headerErrorMessage: string | null;
  /** Required column names that aren't present in the live header. */
  missingRequired: ReadonlyArray<EditableColumnName>;
  onCellRename: (colIdx: number, value: string) => void;
  /** Called when the admin clicks an "Use as ..." suggestion pill.
   *  Distinct from onCellRename so the parent can record that *a
   *  suggestion was accepted* (not just any free-text edit) and light
   *  up the bulk-apply affordance. */
  onAcceptSuggestion: (colIdx: number, value: string) => void;
  onAddColumn: (name: EditableColumnName) => void;
  onRemoveAddedColumn: (idx: number) => void;
  /** Pre-computed map of {colIdx -> canonicalName} that the bulk-apply
   *  affordance should write in one click. `null` when the affordance
   *  shouldn't show — i.e. the admin hasn't accepted any suggestion
   *  yet on this preview. An empty object means an accept happened but
   *  no other column has a confident enough guess. */
  bulkRenameCandidates: Record<number, string> | null;
  onApplyBulkRenames: (renames: Record<number, string>) => void;
}

/**
 * Inline editor for the CSV header bar. Lets admins fix typos in column
 * names ("line type" → "line_type") or append a missing required column
 * without leaving the import preview dialog. Re-validation re-runs the
 * server-side parser against the rewritten header.
 */
function CsvHeaderEditor({
  baseHeader,
  headerEdits,
  addedColumns,
  headerErrorMessage,
  missingRequired,
  onCellRename,
  onAcceptSuggestion,
  onAddColumn,
  onRemoveAddedColumn,
  bulkRenameCandidates,
  onApplyBulkRenames,
}: CsvHeaderEditorProps): ReactElement {
  const { t } = useTranslation();
  const liveCells = baseHeader.map((c, i) => headerEdits[i] ?? c);
  const presentKnown = new Set<string>();
  for (const cell of [...liveCells, ...addedColumns]) {
    const lower = cell.trim().toLowerCase();
    if ((EDITABLE_COLUMN_NAMES as ReadonlyArray<string>).includes(lower)) {
      presentKnown.add(lower);
    }
  }
  return (
    <div
      className="rounded-md border border-amber-300 bg-amber-50 p-3"
      data-testid="csv-header-editor"
    >
      <p className="text-sm font-semibold text-amber-900">
        {t("reports.qbMapping.importPreview.headerEditor.title")}
      </p>
      {headerErrorMessage && (
        <p
          className="text-sm text-destructive font-medium mt-1"
          data-testid="text-header-error-message"
        >
          {t("reports.qbMapping.importRowError", {
            row: 1,
            msg: headerErrorMessage,
          })}
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        {t("reports.qbMapping.importPreview.headerEditor.hint")}
      </p>
      {bulkRenameCandidates !== null &&
        Object.keys(bulkRenameCandidates).length > 0 && (
          <div
            className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-400 bg-amber-100 px-2 py-1.5"
            data-testid="csv-header-bulk-apply"
          >
            <span className="text-xs text-amber-900">
              {t(
                "reports.qbMapping.importPreview.headerEditor.bulkApplyHint",
                { count: Object.keys(bulkRenameCandidates).length },
              )}
            </span>
            <PillButton
              type="button"
              color="blue"
              className="h-7 px-2 text-xs"
              onClick={() => onApplyBulkRenames(bulkRenameCandidates)}
              data-testid="button-header-bulk-apply"
            >
              {t(
                "reports.qbMapping.importPreview.headerEditor.bulkApplyAction",
                { count: Object.keys(bulkRenameCandidates).length },
              )}
            </PillButton>
          </div>
        )}
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {liveCells.map((cell, idx) => {
          const lower = cell.trim().toLowerCase();
          const isKnown = (
            EDITABLE_COLUMN_NAMES as ReadonlyArray<string>
          ).includes(lower);
          const suggestions = (EDITABLE_COLUMN_NAMES as ReadonlyArray<EditableColumnName>).filter(
            (n) => !presentKnown.has(n),
          );
          // Pre-pick the most likely canonical name so admins don't
          // have to scan every "Use as ..." pill. Fall back to no
          // best guess (suggestion === null) when the typed cell looks
          // nothing like any remaining canonical, in which case the
          // pills render in their original neutral state.
          const bestGuess = !isKnown
            ? suggestCanonicalName(cell, suggestions)
            : null;
          return (
            <label
              key={`hdr-${idx}`}
              className="flex flex-col text-xs gap-1"
            >
              <span className="text-muted-foreground">
                {t("reports.qbMapping.importPreview.headerEditor.column", {
                  index: idx + 1,
                })}
              </span>
              <Input
                value={cell}
                onChange={(ev) => onCellRename(idx, ev.target.value)}
                data-testid={`input-header-${idx}`}
                className="h-8 text-sm"
              />
              {!isKnown && bestGuess && (
                <p
                  className="text-xs text-amber-900"
                  data-testid={`text-header-${idx}-suggestion`}
                >
                  {t(
                    "reports.qbMapping.importPreview.headerEditor.looksLike",
                    { name: bestGuess.name },
                  )}
                </p>
              )}
              {!isKnown && suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {suggestions.map((n) => {
                    const isBest = bestGuess?.name === n;
                    // Only de-emphasize the non-best pills *when* a
                    // best guess exists, so completely unrelated
                    // headers fall back to the neutral pre-task UI
                    // instead of looking uniformly dimmed.
                    const dim = bestGuess !== null && !isBest;
                    return (
                      <PillButton
                        key={n}
                        type="button"
                        color={isBest ? "blue" : "image"}
                        className={
                          dim
                            ? "h-6 px-2 text-xs opacity-60"
                            : "h-6 px-2 text-xs"
                        }
                        onClick={() => onAcceptSuggestion(idx, n)}
                        data-testid={`button-header-${idx}-rename-${n}`}
                      >
                        {t("reports.qbMapping.importPreview.headerEditor.useAs", {
                          name: n,
                        })}
                      </PillButton>
                    );
                  })}
                </div>
              )}
            </label>
          );
        })}
        {addedColumns.map((cell, i) => (
          <label
            key={`hdr-added-${i}`}
            className="flex flex-col text-xs gap-1"
          >
            <span className="text-muted-foreground">
              {t("reports.qbMapping.importPreview.headerEditor.added", {
                name: cell,
              })}
            </span>
            <div className="flex items-center gap-1">
              <Input
                value={cell}
                disabled
                data-testid={`input-header-added-${i}`}
                className="h-8 text-sm"
              />
              <PillButton
                type="button"
                color="red"
                className="h-8 px-2 text-xs"
                onClick={() => onRemoveAddedColumn(i)}
                data-testid={`button-header-added-${i}-remove`}
                title={t(
                  "reports.qbMapping.importPreview.headerEditor.removeAdded",
                  { name: cell },
                )}
              >
                {t("reports.qbMapping.importPreview.headerEditor.remove")}
              </PillButton>
            </div>
          </label>
        ))}
      </div>
      {missingRequired.length > 0 && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2"
          data-testid="csv-header-missing-required"
        >
          <span className="text-xs text-destructive">
            {t(
              "reports.qbMapping.importPreview.headerEditor.missingRequired",
              { cols: missingRequired.join(", ") },
            )}
          </span>
          {missingRequired.map((n) => (
            <PillButton
              key={n}
              type="button"
              color="image"
              className="h-7 px-2 text-xs"
              onClick={() => onAddColumn(n)}
              data-testid={`button-header-add-${n}`}
            >
              {t("reports.qbMapping.importPreview.headerEditor.addColumn", {
                name: n,
              })}
            </PillButton>
          ))}
        </div>
      )}
    </div>
  );
}
