import { useAuth } from "@/hooks/use-auth";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWorkHubOperationId,
  workHubRequest,
} from "@/lib/work-hub-client";
import BrandPillButton from "@/components/brand-pill-button";
import { Input } from "@/components/ui/input";
import { HubError } from "./collaboration";
import { parseCsv } from "./csv";
type Row = Record<string, any>;
const FIELDS = ["External ID", "Title", "Body", "Due at"];
export function CsvImport() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const operations = useRef(new Map<string, string>());
  const [csv, setCsv] = useState<string[][] | null>(null);
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("tasks");
  const [channelId, setChannelId] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [staged, setStaged] = useState<{ batch: Row; items: Row[] } | null>(
    null,
  );
  const [result, setResult] = useState<Row | null>(null);
  const channels = useQuery<Row[]>({
    queryKey: ["work-hub", "channels", user?.userId, user?.activeMembershipId],
    queryFn: () => workHubRequest("/channels"),
  });
  const mutation = useMutation({
    mutationFn: async ({ path, data }: { path: string; data: unknown }) => {
      const key = `${path}:${JSON.stringify(data)}`;
      if (!operations.current.has(key))
        operations.current.set(key, createWorkHubOperationId());
      return workHubRequest<any>(path, {
        method: "POST",
        body: JSON.stringify({
          ...(data as object),
          operationId: operations.current.get(key),
        }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-hub"] }),
  });
  function field(row: string[], name: string) {
    const index = mapping[name];
    return index === undefined || index === ""
      ? ""
      : (row[Number(index)] ?? "");
  }
  function preview() {
    if (!csv) return;
    const rows = csv
      .slice(1)
      .map((row) => ({
        externalId: field(row, "External ID"),
        title: field(row, "Title"),
        body: field(row, "Body"),
        dueAt: category === "tasks" ? field(row, "Due at") || null : null,
      }));
    mutation
      .mutateAsync({
        path: "/transfers/preview",
        data: {
          source,
          category,
          ...(category === "notes" ? { channelId } : {}),
          rows,
        },
      })
      .then((data) => {
        setStaged(data);
        setResult(null);
      })
      .catch(() => undefined);
  }
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-xl font-semibold">One-time CSV import</h2>
      <p className="my-3 text-sm text-muted-foreground">
        Import company channels, unassigned tasks, or native notes. Map only
        work content; employee, bank, payroll and credential fields are
        unsupported. Existing records are preserved. Review the server preview
        before confirming.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Source name
          <Input
            placeholder="Example: Microsoft Operations export"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setStaged(null);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Import as
          <select
            className="rounded border bg-background px-3"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setStaged(null);
            }}
          >
            <option value="tasks">Unassigned tasks</option>
            <option value="channels">Company channels</option>
            <option value="notes">Channel notes</option>
          </select>
        </label>
        {category === "notes" && (
          <label className="grid gap-1 text-sm">
            Destination channel
            <select
              className="rounded border bg-background px-3"
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
                setStaged(null);
              }}
            >
              <option value="">Choose a channel</option>
              {channels.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="my-3 text-xs text-muted-foreground">
        Use the same source name and external IDs when retrying an export.
        Matching imported IDs are skipped across batches. Due dates must be ISO
        timestamps, for example 2026-10-01T14:00:00Z.
      </p>
      <input
        aria-label="CSV import file"
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          setCsv(null);
          setMapping({});
          setStaged(null);
          setResult(null);
          setError(null);
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 2_000_000)
              throw new Error("Choose a CSV smaller than 2 MB.");
            const rows = parseCsv(await file.text());
            if (rows.length > 501)
              throw new Error("Import up to 500 records per batch.");
            setCsv(rows);
          } catch (err) {
            setError(err);
          }
        }}
      />
      {csv && (
        <>
          <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FIELDS.filter((f) => category === "tasks" || f !== "Due at").map(
              (name) => (
                <label key={name} className="grid gap-1 text-sm">
                  {name} column
                  <select
                    aria-label={`${name} column`}
                    className="rounded border bg-background p-2"
                    value={mapping[name] ?? ""}
                    onChange={(e) => {
                      setMapping({ ...mapping, [name]: e.target.value });
                      setStaged(null);
                    }}
                  >
                    <option value="">Not mapped</option>
                    {csv[0].map((header, i) => (
                      <option key={i} value={i}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ),
            )}
          </div>
          <p className="mb-3 text-sm">
            {csv.length - 1} source rows. Only mapped fields will be uploaded
            for preview.
          </p>
          <div className="max-h-52 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {csv[0].map((head, i) => (
                    <th key={i} className="border p-2 text-left">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csv.slice(1, 11).map((row, i) => (
                  <tr key={i}>
                    {row.map((value, j) => (
                      <td key={j} className="border p-2">
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <BrandPillButton
              tone="blue"
              disabled={
                !source.trim() ||
                !mapping["External ID"] ||
                !mapping.Title ||
                (category === "notes" && !channelId) ||
                mutation.isPending
              }
              onClick={preview}
            >
              Validate and stage preview
            </BrandPillButton>
          </div>
        </>
      )}
      {staged && (
        <div className="mt-5 border-t pt-4">
          <h3 className="font-semibold">Review import into VNDRLY</h3>
          <p className="my-2 text-sm">
            {staged.items.filter((r) => r.status === "staged").length} ready ·{" "}
            {staged.items.filter((r) => r.status === "duplicate").length}{" "}
            already imported ·{" "}
            {staged.items.filter((r) => r.status === "error").length} invalid.
            Invalid and duplicate rows will be skipped.
          </p>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left">Row</th>
                  <th className="p-2 text-left">Title</th>
                  <th className="p-2 text-left">Result</th>
                </tr>
              </thead>
              <tbody>
                {staged.items.map((item) => (
                  <tr key={item.id}>
                    <td className="border p-2">{item.payload.rowNumber}</td>
                    <td className="border p-2">{item.payload.title}</td>
                    <td className="border p-2">
                      {item.error?.message ?? item.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="my-3 text-sm">
            {category === "channels"
              ? "New channels will be visible to your company."
              : category === "notes"
                ? "New notes will be visible to the selected channel's members."
                : "New tasks will remain unassigned until an administrator assigns them."}{" "}
            No source records will be changed.
          </p>
          <BrandPillButton
            tone="green"
            disabled={
              !staged.items.some((r) => r.status === "staged") ||
              mutation.isPending ||
              !!result
            }
            onClick={() =>
              mutation
                .mutateAsync({
                  path: `/transfers/${staged.batch.id}/apply`,
                  data: { confirm: true },
                })
                .then(setResult)
                .catch(() => undefined)
            }
          >
            Confirm and import ready rows
          </BrandPillButton>
        </div>
      )}
      <HubError error={error ?? mutation.error} />
      {result && (
        <p role="status" className="mt-4 text-sm">
          Import complete: {result.imported} created, {result.duplicates}{" "}
          duplicates skipped, {result.errors} invalid rows skipped. Details
          remain in import history.{" "}
          <a
            className="underline"
            href={
              category === "channels"
                ? "/work-hub/channels"
                : category === "tasks"
                  ? "/work-hub/tasks"
                  : "/work-hub/files"
            }
          >
            Open imported work
          </a>
        </p>
      )}
    </section>
  );
}
