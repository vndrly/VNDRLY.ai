import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Download, CheckCircle2, AlertCircle, RotateCw } from "lucide-react";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListFieldEmployeesQueryKey } from "@workspace/api-client-react";
import { readCsv, writeCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const TEMPLATE_HEADERS = ["employeeId", "email", "password", "displayName", "language"] as const;
const TEMPLATE_SAMPLE: ReadonlyArray<ReadonlyArray<string>> = [
  TEMPLATE_HEADERS as unknown as string[],
  ["123", "alice@example.com", "TempPass!2026", "Alice Rivera", "en"],
  ["456", "bob@example.com", "TempPass!2026", "", "es"],
];

type ParsedRow = {
  rowNumber: number;
  employeeId: string;
  email: string;
  password: string;
  displayName: string;
  language: string;
  parseError?: string;
};

type ServerResultRow = {
  index: number;
  employeeId?: number;
  userId?: number;
  email?: string;
  status: "created" | "updated" | "error";
  message?: string;
  preferredLanguage?: "en" | "es" | null;
};

type ServerResponse = {
  created: number;
  updated: number;
  errors: number;
  results: ServerResultRow[];
};

// Map a parsed CSV header row onto the canonical field names. Accepts
// case- and whitespace-insensitive variants and the alias "preferredLanguage"
// for the language column (the server also accepts that key on the wire).
function buildHeaderIndex(headerRow: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  for (let i = 0; i < headerRow.length; i++) {
    const norm = headerRow[i].trim().toLowerCase().replace(/[\s_-]/g, "");
    if (norm === "employeeid") idx.employeeId = i;
    else if (norm === "email") idx.email = i;
    else if (norm === "password") idx.password = i;
    else if (norm === "displayname" || norm === "name") idx.displayName = i;
    else if (norm === "language" || norm === "preferredlanguage" || norm === "lang") idx.language = i;
  }
  return idx;
}

export function parseBulkLoginCsv(text: string): {
  rows: ParsedRow[];
  fileError: string | null;
} {
  // Strip UTF-8 BOM if present so the very first header doesn't end up
  // matching as `\uFEFFemployeeId`.
  const cleaned = text.replace(/^\uFEFF/, "");
  const matrix = readCsv(cleaned);
  if (matrix.length === 0) {
    return { rows: [], fileError: "CSV is empty" };
  }
  const header = matrix[0];
  const idx = buildHeaderIndex(header);
  const required = ["employeeId", "email", "password"] as const;
  const missing = required.filter((k) => idx[k] === undefined);
  if (missing.length > 0) {
    return { rows: [], fileError: `Missing required column(s): ${missing.join(", ")}` };
  }
  const out: ParsedRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    // Skip wholly-blank rows (CSV exports often add a trailing empty line).
    if (cells.every((c) => c.trim() === "")) continue;
    const get = (key: string) => {
      const i = idx[key];
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };
    const employeeIdRaw = get("employeeId");
    const email = get("email");
    const password = get("password");
    const displayName = get("displayName");
    const language = get("language");
    let parseError: string | undefined;
    if (!employeeIdRaw || !email || !password) {
      parseError = "employeeId, email, and password are required";
    } else if (!/^\d+$/.test(employeeIdRaw)) {
      parseError = "employeeId must be a whole number";
    } else if (password.length < 8) {
      parseError = "Password must be at least 8 characters";
    } else if (language && !["en", "es"].includes(language.toLowerCase())) {
      parseError = "language must be 'en' or 'es'";
    }
    out.push({
      rowNumber: r,
      employeeId: employeeIdRaw,
      email,
      password,
      displayName,
      language,
      parseError,
    });
  }
  return { rows: out, fileError: null };
}

type Props = {
  visible: boolean;
};

export default function BulkLoginUploadDialog({ visible }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<ServerResponse | null>(null);

  const validRows = useMemo(() => parsedRows.filter((r) => !r.parseError), [parsedRows]);
  const invalidCount = parsedRows.length - validRows.length;

  const reset = () => {
    setFileName(null);
    setFileError(null);
    setParsedRows([]);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    setOpen(next);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResults(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const { rows, fileError: err } = parseBulkLoginCsv(text);
      setParsedRows(rows);
      setFileError(err);
    } catch {
      setFileError(t("bulkLoginUpload.readFailed", { defaultValue: "Could not read that file" }));
      setParsedRows([]);
    }
  };

  const handleDownloadTemplate = () => {
    const csv = writeCsv(TEMPLATE_SAMPLE.map((r) => [...r]));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "field-employee-logins-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async () => {
    if (validRows.length === 0) return;
    setUploading(true);
    try {
      const payload = {
        rows: validRows.map((r) => ({
          employeeId: Number(r.employeeId),
          email: r.email,
          password: r.password,
          ...(r.displayName ? { displayName: r.displayName } : {}),
          ...(r.language ? { language: r.language.toLowerCase() } : {}),
        })),
      };
      const res = await fetch(`${BASE}/api/field-employees/bulk-login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ServerResponse> & { message?: string };
      if (!res.ok && !Array.isArray(body.results)) {
        toast({
          title: t("bulkLoginUpload.uploadFailedToast", { defaultValue: "Upload failed" }),
          description: body.message || `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      const normalized: ServerResponse = {
        created: body.created ?? 0,
        updated: body.updated ?? 0,
        errors: body.errors ?? 0,
        results: Array.isArray(body.results) ? body.results : [],
      };
      setResults(normalized);
      // Refresh the field-employees list so newly-linked logins show up.
      queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey({}) });
      queryClient.invalidateQueries({ queryKey: getListFieldEmployeesQueryKey({ includeInactive: true }) });
      const totalProcessed = normalized.created + normalized.updated;
      toast({
        title: t("bulkLoginUpload.uploadCompleteToast", {
          defaultValue: "Upload complete",
        }),
        description: t("bulkLoginUpload.uploadCompleteDesc", {
          defaultValue: "{{ok}} succeeded, {{err}} failed",
          ok: totalProcessed,
          err: normalized.errors,
        }),
        variant: normalized.errors > 0 && totalProcessed === 0 ? "destructive" : undefined,
      });
    } catch (err) {
      toast({
        title: t("bulkLoginUpload.uploadFailedToast", { defaultValue: "Upload failed" }),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  if (!visible) return null;

  // Map server result rows back to the original parsed row by index so we
  // can display employee row numbers + emails alongside the per-row outcome.
  const validRowByPayloadIndex = validRows;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <PngPillButton color="blue" data-testid="button-open-bulk-login-upload">
          <Upload className="w-4 h-4" />
          {t("bulkLoginUpload.openButton", { defaultValue: "Bulk Upload Logins" })}
        </PngPillButton>
      </DialogTrigger>
      <DialogContent className="w-[760px] max-w-[calc(100vw-2rem)]" data-testid="dialog-bulk-login-upload">
        <DialogHeader>
          <DialogTitle>
            {t("bulkLoginUpload.title", { defaultValue: "Bulk Upload Field Employee Logins" })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            {t("bulkLoginUpload.description", {
              defaultValue:
                "Upload a CSV with columns employeeId, email, password, and optional displayName and language. Each row creates or updates the field portal login for that employee.",
            })}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <PillButton
              type="button"
              color="image"
              onClick={handleDownloadTemplate}
              data-testid="button-download-bulk-login-template"
            >
              <Download className="w-4 h-4 mr-1" />
              {t("bulkLoginUpload.downloadTemplate", { defaultValue: "Download CSV template" })}
            </PillButton>
            <div className="flex items-center gap-2">
              <Label htmlFor="bulk-login-file" className="sr-only">
                {t("bulkLoginUpload.chooseFile", { defaultValue: "Choose CSV file" })}
              </Label>
              <Input
                id="bulk-login-file"
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="max-w-[320px]"
                data-testid="input-bulk-login-csv"
              />
              {fileName && (
                <PillButton
                  type="button"
                  color="image"
                  onClick={reset}
                  data-testid="button-reset-bulk-login"
                >
                  <RotateCw className="w-3 h-3 mr-1" />
                  {t("bulkLoginUpload.reset", { defaultValue: "Reset" })}
                </PillButton>
              )}
            </div>
          </div>

          {fileError && (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="text-bulk-login-file-error"
            >
              {fileError}
            </div>
          )}

          {parsedRows.length > 0 && !results && (
            <div className="space-y-3" data-testid="section-bulk-login-preview">
              <div className="flex items-center justify-between">
                <p className="text-sm">
                  {t("bulkLoginUpload.previewSummary", {
                    defaultValue: "{{valid}} ready, {{invalid}} need fixes",
                    valid: validRows.length,
                    invalid: invalidCount,
                  })}
                </p>
                <PngPillButton
                  color="blue"
                  type="button"
                  onClick={handleSubmit}
                  disabled={uploading || validRows.length === 0}
                  data-testid="button-submit-bulk-login"
                >
                  <Upload className="w-4 h-4" />
                  {uploading
                    ? t("bulkLoginUpload.uploading", { defaultValue: "Uploading..." })
                    : t("bulkLoginUpload.submit", {
                        defaultValue: "Upload {{count}} rows",
                        count: validRows.length,
                      })}
                </PngPillButton>
              </div>
              <div className="max-h-[320px] overflow-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">#</TableHead>
                      <TableHead className="w-[120px]">
                        {t("bulkLoginUpload.col.employeeId", { defaultValue: "Employee ID" })}
                      </TableHead>
                      <TableHead>{t("bulkLoginUpload.col.email", { defaultValue: "Email" })}</TableHead>
                      <TableHead className="w-[160px]">
                        {t("bulkLoginUpload.col.displayName", { defaultValue: "Display Name" })}
                      </TableHead>
                      <TableHead className="w-[80px]">
                        {t("bulkLoginUpload.col.language", { defaultValue: "Language" })}
                      </TableHead>
                      <TableHead className="w-[200px]">
                        {t("bulkLoginUpload.col.status", { defaultValue: "Status" })}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.map((row) => (
                      <TableRow
                        key={row.rowNumber}
                        className={cn(row.parseError ? "bg-destructive/5" : undefined)}
                        data-testid={`row-bulk-login-preview-${row.rowNumber}`}
                      >
                        <TableCell className="text-xs text-muted-foreground">{row.rowNumber}</TableCell>
                        <TableCell className="font-mono text-xs">{row.employeeId || "-"}</TableCell>
                        <TableCell className="text-sm">{row.email || "-"}</TableCell>
                        <TableCell className="text-sm">{row.displayName || "-"}</TableCell>
                        <TableCell className="text-sm uppercase">{row.language || "-"}</TableCell>
                        <TableCell>
                          {row.parseError ? (
                            <span className="inline-flex items-center gap-1 text-destructive text-xs">
                              <AlertCircle className="w-3 h-3" />
                              {row.parseError}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
                              <CheckCircle2 className="w-3 h-3" />
                              {t("bulkLoginUpload.previewReady", { defaultValue: "Ready" })}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {results && (
            <div className="space-y-3" data-testid="section-bulk-login-results">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border bg-emerald-50 px-3 py-2 text-center">
                  <div className="text-2xl font-bold text-emerald-700" data-testid="text-bulk-login-created">
                    {results.created}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("bulkLoginUpload.created", { defaultValue: "Created" })}
                  </div>
                </div>
                <div className="rounded-md border bg-blue-50 px-3 py-2 text-center">
                  <div className="text-2xl font-bold text-blue-700" data-testid="text-bulk-login-updated">
                    {results.updated}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("bulkLoginUpload.updated", { defaultValue: "Updated" })}
                  </div>
                </div>
                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-center",
                    results.errors > 0 ? "bg-red-50" : "bg-muted/30",
                  )}
                >
                  <div
                    className={cn("text-2xl font-bold", results.errors > 0 ? "text-red-700" : "text-muted-foreground")}
                    data-testid="text-bulk-login-errors"
                  >
                    {results.errors}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("bulkLoginUpload.errorsLabel", { defaultValue: "Errors" })}
                  </div>
                </div>
              </div>

              <div className="max-h-[320px] overflow-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">#</TableHead>
                      <TableHead className="w-[120px]">
                        {t("bulkLoginUpload.col.employeeId", { defaultValue: "Employee ID" })}
                      </TableHead>
                      <TableHead>{t("bulkLoginUpload.col.email", { defaultValue: "Email" })}</TableHead>
                      <TableHead className="w-[120px]">
                        {t("bulkLoginUpload.col.status", { defaultValue: "Status" })}
                      </TableHead>
                      <TableHead>{t("bulkLoginUpload.col.detail", { defaultValue: "Detail" })}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.results.map((result, i) => {
                      const sourceRow = validRowByPayloadIndex[result.index];
                      const rowNumber = sourceRow?.rowNumber ?? result.index + 1;
                      const email = result.email ?? sourceRow?.email ?? "-";
                      const employeeId = result.employeeId ?? sourceRow?.employeeId ?? "-";
                      const isError = result.status === "error";
                      const isCreated = result.status === "created";
                      return (
                        <TableRow
                          key={`${result.index}-${i}`}
                          className={cn(isError ? "bg-destructive/5" : undefined)}
                          data-testid={`row-bulk-login-result-${result.index}`}
                        >
                          <TableCell className="text-xs text-muted-foreground">{rowNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{String(employeeId)}</TableCell>
                          <TableCell className="text-sm">{email}</TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 text-xs font-medium",
                                isError && "text-destructive",
                                isCreated && "text-emerald-600",
                                !isError && !isCreated && "text-blue-600",
                              )}
                            >
                              {isError ? (
                                <AlertCircle className="w-3 h-3" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3" />
                              )}
                              {isError
                                ? t("bulkLoginUpload.statusError", { defaultValue: "Error" })
                                : isCreated
                                  ? t("bulkLoginUpload.statusCreated", { defaultValue: "Created" })
                                  : t("bulkLoginUpload.statusUpdated", { defaultValue: "Updated" })}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{result.message ?? ""}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end">
                <PillButton type="button" color="image" onClick={reset} data-testid="button-bulk-login-upload-another">
                  <RotateCw className="w-4 h-4 mr-1" />
                  {t("bulkLoginUpload.uploadAnother", { defaultValue: "Upload another file" })}
                </PillButton>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
