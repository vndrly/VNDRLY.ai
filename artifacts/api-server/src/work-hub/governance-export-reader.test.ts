import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import { describe, expect, it, vi } from "vitest";
import {
  ExportSafetyLimitError,
  ExportFieldLimitError,
  buildWorkHubExportArtifact,
  buildWorkHubExportPageQuery,
  readCompleteWorkHubExport,
  type WorkHubExportRow,
} from "./governance-export-reader";

const owner = { type: "vendor" as const, id: 41 };
const adminAccess = { owner, context: { kind: "organization" as const, id: 41 }, capabilities: new Set(["policy.manage" as const]), visibilityRevision: "22:vendor:41" };
const snapshotAt = new Date("2026-09-10T17:00:00.000Z");
const scope = { selectors: {} };

function row(index: number, at = "2026-09-10T16:00:00.000Z"): WorkHubExportRow {
  return {
    cursorAt: at,
    cursorId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    fields: { title: index === 0 ? "=SUM(A1:A2)" : `Task ${index}`, status: "open" },
  };
}

describe("complete Work Hub export readers", () => {
  it("reads every row across equal-timestamp keyset pages without duplicates", async () => {
    const all = Array.from({ length: 101 }, (_, index) => row(index));
    const execute = vi.fn(async (_query, request: { after: null | { at: string; id: string }; limit: number }) => {
      const start = request.after ? all.findIndex((item) => item.cursorId === request.after!.id) + 1 : 0;
      return all.slice(start, start + request.limit);
    });

    const result = await readCompleteWorkHubExport({
      execute,
      request: { dataset: "tasks", format: "csv", scope },
      owner,
      access: adminAccess,
      snapshotAt,
      pageSize: 17,
      maximumRows: 500,
    });

    expect(result).toHaveLength(101);
    expect(new Set(result.map((item) => item.cursorId))).toHaveLength(101);
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it.each([
    ["channels", "channel", "message"],
    ["meeting_recap", "occurrence", "chat"],
    ["meeting_transcript", "segment", "chat"],
  ] as const)("uses source-discriminated SQL cursor ids for %s union rows", (dataset, firstKind, secondKind) => {
    const query = new PgDialect().sqlToQuery(buildWorkHubExportPageQuery({
      request: { dataset, format: "csv", scope },
      owner,
      snapshotAt,
      after: null,
      limit: 2,
    }));
    expect(query.sql).toContain(`'${firstKind}:' ||`);
    expect(query.sql).toContain(`'${secondKind}:' ||`);
    expect(query.sql).toContain("ORDER BY created_at, id");
  });

  it.each([
    ["channels", "channel", "message"],
    ["meeting_recap", "chat", "occurrence"],
    ["meeting_transcript", "chat", "segment"],
  ] as const)("does not lose same-time same-raw-id %s rows at one-row page boundaries", async (dataset, firstKind, secondKind) => {
    const rawId = "00000000-0000-4000-8000-000000000055";
    const all = [
      { ...row(1), cursorId: `${firstKind}:${rawId}`, fields: { recordType: firstKind, body: "first" } },
      { ...row(2), cursorId: `${secondKind}:${rawId}`, fields: { recordType: secondKind, body: "second" } },
    ];
    const execute = vi.fn(async (_query, request: { after: null | { at: string; id: string }; limit: number }) => {
      const start = request.after ? all.findIndex((item) => item.cursorId === request.after!.id) + 1 : 0;
      return all.slice(start, start + request.limit);
    });
    const result = await readCompleteWorkHubExport({
      execute,
      request: { dataset, format: "csv", scope },
      owner,
      access: adminAccess,
      snapshotAt,
      pageSize: 1,
      maximumRows: 10,
    });
    expect(result.map((item) => item.cursorId)).toEqual(all.map((item) => item.cursorId));
    expect(new Set(result.map((item) => item.cursorId)).size).toBe(2);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("fails instead of returning a partial artifact when the safety maximum is exceeded", async () => {
    const execute = vi.fn(async () => [row(0), row(1), row(2)]);
    await expect(readCompleteWorkHubExport({
      execute,
      request: { dataset: "tasks", format: "csv", scope },
      owner,
      access: adminAccess,
      snapshotAt,
      pageSize: 3,
      maximumRows: 2,
    })).rejects.toBeInstanceOf(ExportSafetyLimitError);
  });

  it("rejects a reader without owner-admin export authority before querying", async () => {
    const execute = vi.fn(async () => [row(0)]);
    await expect(readCompleteWorkHubExport({
      execute,
      request: { dataset: "tasks", format: "csv", scope },
      owner,
      access: { ...adminAccess, capabilities: new Set(["channel.read" as const]) },
      snapshotAt,
    })).rejects.toMatchObject({ code: "work_hub.forbidden" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an unrelated selector before querying instead of widening to the whole owner", async () => {
    const execute = vi.fn(async () => [row(0)]);
    await expect(readCompleteWorkHubExport({
      execute,
      request: { dataset: "tasks", format: "csv", scope: { selectors: { channelIds: ["00000000-0000-4000-8000-000000000001"] } } } as never,
      owner,
      access: adminAccess,
      snapshotAt,
    })).rejects.toThrow(/selector/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it("puts tenant, snapshot, range, and stable cursor constraints in the direct SQL query", () => {
    const query = new PgDialect().sqlToQuery(buildWorkHubExportPageQuery({
      request: { dataset: "calendar", format: "ics", scope: { selectors: {}, from: "2026-09-01T00:00:00.000Z", to: "2026-09-08T00:00:00.000Z" } },
      owner,
      snapshotAt,
      after: { at: "2026-09-02T00:00:00.000Z", id: "00000000-0000-4000-8000-000000000001" },
      limit: 101,
    }));
    expect(query.sql).toContain("owner_org_type");
    expect(query.sql).toContain("owner_org_id");
    expect(query.sql).toContain("created_at <=");
    expect(query.sql).toContain("s.starts_at AS event_at");
    expect(query.sql).toContain("event_at >=");
    expect(query.sql).toContain("event_at <=");
    expect(query.sql).toContain("created_at, id");
    expect(query.params).toEqual(expect.arrayContaining(["vendor", 41, snapshotAt, 101]));
  });

  it("applies requested selectors against the normalized source selector", () => {
    const query = new PgDialect().sqlToQuery(buildWorkHubExportPageQuery({
      request: { dataset: "tasks", format: "csv", scope: { selectors: { taskIds: ["00000000-0000-4000-8000-000000000007"] } } },
      owner,
      snapshotAt,
      after: null,
      limit: 101,
    }));
    expect(query.sql).toContain("selector_id::text = ANY");
    expect(query.sql).not.toContain("task_id = ANY");
  });

  it("binds noteIds to n.id exposed as the normalized selector", () => {
    const noteId = "00000000-0000-4000-8000-000000000017";
    const query = new PgDialect().sqlToQuery(buildWorkHubExportPageQuery({
      request: { dataset: "notes", format: "csv", scope: { selectors: { noteIds: [noteId] } } },
      owner,
      snapshotAt,
      after: null,
      limit: 101,
    }));
    expect(query.sql).toContain("n.id AS selector_id");
    expect(query.sql).toContain("selector_id::text = ANY");
    expect(query.params).toContainEqual([noteId]);
  });

  it("excludes every private meeting message in SQL before hydration", () => {
    for (const dataset of ["meeting_recap", "meeting_transcript"] as const) {
      const query = new PgDialect().sqlToQuery(buildWorkHubExportPageQuery({
        request: { dataset, format: "csv", scope: { selectors: { meetingOccurrenceIds: ["00000000-0000-4000-8000-000000000012"] } } },
        owner,
        snapshotAt,
        after: null,
        limit: 101,
      }));
      expect(query.sql.toLowerCase()).toContain("recipient_user_id is null");
      expect(query.sql.toLowerCase()).not.toContain("recipient_user_id is not null");
    }
  });
});

describe("deterministic governed export artifacts", () => {
  const base = {
    jobId: "00000000-0000-4000-8000-000000000099",
    request: { dataset: "tasks" as const, format: "csv" as const, scope },
    requester: { id: "22", display: "Susie Example" },
    generatedAt: "2026-09-10T17:01:00.000Z",
    snapshotAt: snapshotAt.toISOString(),
    rows: [row(0), row(1)],
  };

  it("creates repeatable CSV bytes with a requester watermark and formula protection", async () => {
    const first = await buildWorkHubExportArtifact(base);
    const second = await buildWorkHubExportArtifact(base);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.bytes.toString("utf8")).toContain("Susie Example");
    expect(first.bytes.toString("utf8")).toContain("'=SUM(A1:A2)");
    expect(first.sha256).toBe(createHash("sha256").update(first.bytes).digest("hex"));
    expect(first.manifest.rowCount).toBe(2);
  });

  it("creates an ICS artifact with requester and generated-time watermark fields", async () => {
    const artifact = await buildWorkHubExportArtifact({
      ...base,
      request: { dataset: "shifts", format: "ics", scope },
      rows: [{ ...row(3), fields: { title: "Morning shift", startsAt: "2026-09-11T13:00:00.000Z", endsAt: "2026-09-11T21:00:00.000Z", description: "Rig 7" } }],
    });
    const content = artifact.bytes.toString("utf8");
    expect(content).toContain("X-VNDRLY-REQUESTER:Susie Example");
    expect(content).toContain("X-VNDRLY-GENERATED-AT:20260910T170100Z");
    expect(content).toContain("SUMMARY:Morning shift");
  });

  it("keeps an untrusted requester display from injecting ICS properties", async () => {
    const artifact = await buildWorkHubExportArtifact({
      ...base,
      requester: { id: "22", display: "Susie\r\nX-EVIL:yes" },
      request: { dataset: "calendar", format: "ics", scope },
      rows: [{ ...row(3), fields: { title: "Morning shift", startsAt: "2026-09-11T13:00:00.000Z", endsAt: "2026-09-11T21:00:00.000Z" } }],
    });
    expect(artifact.bytes.toString("utf8")).not.toContain("\r\nX-EVIL:");
  });

  it.each(["pdf", "zip"] as const)("creates repeatable %s bytes", async (format) => {
    const request = { dataset: "tasks" as const, format, scope };
    const first = await buildWorkHubExportArtifact({ ...base, request });
    const second = await buildWorkHubExportArtifact({ ...base, request });
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.manifest.byteCount).toBe(first.bytes.length);
  });

  it("rejects deeply nested arrays and mixed containers with a bounded typed error", async () => {
    let deep: unknown = "leaf";
    for (let index = 0; index < 20_000; index += 1) deep = index % 2 ? { nested: deep } : [deep];
    await expect(buildWorkHubExportArtifact({
      ...base,
      rows: [{ ...row(4), fields: { title: deep as never } }],
    })).rejects.toBeInstanceOf(ExportFieldLimitError);
  });

  it("normalizes control characters in every PDF watermark and column header", async () => {
    const artifact = await buildWorkHubExportArtifact({
      ...base,
      requester: { id: "22", display: "Susie\r\nInjected\u0007" },
      request: { dataset: "tasks", format: "pdf", scope },
      rows: [{ ...row(4), fields: { "head\r\nInjected\u0000": "value" } }],
    });
    const parser = new PDFParse({ data: new Uint8Array(artifact.bytes) });
    try {
      const text = (await parser.getText()).text;
      expect(text).toContain("Susie Injected");
      expect(text).toContain("head Injected");
      expect(text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    } finally {
      await parser.destroy();
    }
  });

  it("embeds an unambiguous ZIP payload manifest and returns a consistent outer manifest", async () => {
    const artifact = await buildWorkHubExportArtifact({ ...base, request: { dataset: "tasks", format: "zip", scope } });
    const zip = await JSZip.loadAsync(artifact.bytes);
    const embedded = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
      payload: { format: string; byteCount: number; sha256: string };
      entries: Array<{ fileName: string; byteCount: number; sha256: string; contentType: string }>;
    };
    expect(embedded.entries).toHaveLength(1);
    const entry = embedded.entries[0]!;
    const payload = await zip.file(entry.fileName)!.async("nodebuffer");
    expect(entry).toMatchObject({ byteCount: payload.length, sha256: createHash("sha256").update(payload).digest("hex"), contentType: "text/csv; charset=utf-8" });
    expect(embedded.payload).toMatchObject({ format: "csv", byteCount: entry.byteCount, sha256: entry.sha256 });
    expect(artifact.manifest).toMatchObject({ format: "zip", byteCount: artifact.bytes.length, sha256: createHash("sha256").update(artifact.bytes).digest("hex") });
  });

  it("rejects recording artifacts from the general builder", async () => {
    await expect(buildWorkHubExportArtifact({
      ...base,
      request: { dataset: "meeting_recording", format: "zip", scope },
    })).rejects.toThrow(/not supported/i);
  });
});
