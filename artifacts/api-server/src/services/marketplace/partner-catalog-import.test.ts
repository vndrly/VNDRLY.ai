import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({ existing: [] as any[], previous: [] as any[], inserts: [] as { table: string; value: any }[], classify: vi.fn(), conflict: false }));
vi.mock("../service-matching/catalog-classification", () => ({ classifySavedWorkType: state.classify }));
vi.mock("@workspace/db", async (original) => {
  const actual = await original<Record<string, unknown>>();
  const tx = {
    execute: vi.fn(async () => {}),
    select: () => {
      let table: string;
      const query: any = { from(value: any) { table = getTableName(value); return query; }, where() { return query; }, limit() { return query; },
        then(resolve: any, reject: any) { return Promise.resolve(table === "work_types" ? state.existing : state.previous).then(resolve, reject); } };
      return query;
    },
    insert(table: any) {
      const name = getTableName(table);
      const query = { values(value: any) { state.inserts.push({ table: name, value }); return query; }, onConflictDoNothing() { return query; },
        async returning() { return name === "work_types" && state.conflict ? [] : [{ id: name === "work_types" ? 101 : 901 }]; } };
      return query;
    },
  };
  return { ...actual, db: { transaction: async (run: any) => run(tx) } };
});
import { parsePartnerCatalog, planPartnerCatalog, importPartnerCatalog } from "./partner-catalog-import";
const encode = (text: string) => Buffer.from(text).toString("base64");
const csv = '\uFEFFcode,name,category,description,unit\r\nG-1,Gatekeeping,Security,"Visitor logs, checks\nand entry",per_day\r\n';
beforeEach(() => { state.existing = []; state.previous = []; state.inserts = []; state.conflict = false; state.classify.mockReset(); });
it("parses source codes, quoted commas and multiline descriptions without inventing services", () => {
  const result = parsePartnerCatalog(encode(csv));
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ row: 2, code: "G-1", name: "Gatekeeping", description: "Visitor logs, checks\nand entry", unit: "per_day" });
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
});
it.each(['title\nGatekeeping', 'name,name\nA,B', 'name\n"Unclosed', 'name,unit\nGatekeeping', 'name\n"Gate"bad'])('rejects malformed source: %s', text => {
  expect(() => parsePartnerCatalog(encode(text))).toThrow();
});
it("distinguishes exact normalized duplicates from different or unverified service scope", () => {
  const rows = parsePartnerCatalog(encode('name,category,description,unit\n Gatekeeping ,Security,Entry logs,\ngatekeeping,Security,Entry logs,\nGatekeeping,Security,Armed patrol,\nGatekeeping,Security,Entry logs,per_day')).rows;
  expect(planPartnerCatalog(rows, []).map(row => row.outcome)).toEqual(["new", "duplicate", "conflict", "conflict"]);
  expect(planPartnerCatalog(rows, [{ id: 50, name: "gatekeeping", category: "Security", description: "Entry logs" }])[0]).toMatchObject({ outcome: "duplicate", workTypeId: 50 });
});
it("previews without inserting or classifying anything", async () => {
  const report = await importPartnerCatalog(9, 7, "partner", { fileName: "source.csv", sourceBase64: encode(csv), mode: "preview" });
  expect(report.rows[0].outcome).toBe("new");
  expect(state.inserts).toEqual([]);
  expect(state.classify).not.toHaveBeenCalled();
});
it("atomically preserves original bytes, hash and source-row linkage alongside new service", async () => {
  const sourceBase64 = encode(csv);
  const report = await importPartnerCatalog(9, 7, "partner", { fileName: "source.csv", sourceBase64, mode: "import" });
  expect(report).toMatchObject({ created: 1, importId: 901, rows: [{ code: "G-1", unit: "per_day", workTypeId: 101, outcome: "created" }] });
  expect(state.inserts[0]).toMatchObject({ table: "work_types", value: { partnerId: 9, name: "Gatekeeping" } });
  const audit = state.inserts[1].value;
  expect(audit).toMatchObject({ partnerId: 9, targetType: "partner-catalog-import", toolInput: { sourceBase64, sourceHash: report.sourceHash } });
  expect(Buffer.from(audit.toolInput.sourceBase64, "base64")).toEqual(Buffer.from(csv));
  expect(state.classify).toHaveBeenCalledWith(101);
});
it("replays the same original without duplicating services or import records", async () => {
  state.previous = [{ id: 901, output: { sourceHash: "original", fileName: "source.csv", rows: [], created: 1, duplicates: 0, conflicts: 0 } }];
  const report = await importPartnerCatalog(9, 7, "partner", { fileName: "source.csv", sourceBase64: encode(csv), mode: "import" });
  expect(report).toMatchObject({ replayed: true, importId: 901 });
  expect(state.inserts).toEqual([]);
  expect(state.classify).not.toHaveBeenCalled();
});
it("preserves a concurrently created existing row instead of updating it", async () => {
  state.conflict = true;
  const report = await importPartnerCatalog(9, 7, "partner", { fileName: "source.csv", sourceBase64: encode(csv), mode: "import" });
  expect(report).toMatchObject({ created: 0, conflicts: 1, rows: [{ outcome: "conflict" }] });
  expect(state.classify).not.toHaveBeenCalled();
});
