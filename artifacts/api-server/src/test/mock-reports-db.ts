// Shared in-memory mock for the reports route tests. Three sibling test
// files (`reports-qb-mapping-audit.test.ts`, `reports-1099-deliver.test.ts`,
// `reports-exports-audit-retry-chain.test.ts`) used to carry near-identical
// copies of this scaffolding. Centralising it here means a new schema export
// in `reports.ts` only needs to be reflected in one place.
//
// The schema tags (`makeReportsDbTables`) and enum constants
// (`REPORT_EXPORT_FORMATS`, `TAX_1099_*`, …) are sourced from
// `./reportsDbMockExports` so that adding a new schema export to reports.ts
// only needs to be reflected in that single canonical list — this helper
// builds the in-memory db on top of those tables and exposes them again
// for tests that want a richer column set (e.g. vendors with email columns).
//
// The enum constants themselves are re-exported from the real
// `@workspace/db/schema` package, so adding a new format / status / action
// to the schema is automatically picked up by every reports test without
// any helper edits — see `reportsDbMockExports.ts` for details.
//
// Usage from a test file:
//
//   import {
//     fixtures,
//     nextId,
//     resetMockDb,
//     makeReportsDbMock,
//     makeDrizzleMock,
//   } from "../test/mock-reports-db";
//
//   vi.mock("@workspace/db", () => makeReportsDbMock());
//   vi.mock("drizzle-orm", () => makeDrizzleMock());
//
//   beforeEach(() => {
//     resetMockDb({ qbAccountMapping: 1, qbAccountMappingAuditLog: 1 });
//     // ... seed fixtures.qbAccountMapping etc. per test ...
//   });
//
// Notes on hoisting: `vi.mock(...)` is hoisted to the top of the test file,
// but the factory functions above are arrow expressions whose bodies run
// lazily — when reports.ts is dynamically imported inside `beforeEach`. By
// then this helper module has been fully evaluated, so the `makeReportsDbMock`
// / `makeDrizzleMock` references inside the closures resolve cleanly.
//
// `makeReportsDbMock` is async because it pulls the enum constants
// straight from the real `@workspace/db/schema` via `vi.importActual`
// inside `reportsDbModuleExports`. Vitest happily awaits a Promise
// returned from a `vi.mock` factory, so callers stay one-liners:
//
//   vi.mock("@workspace/db", () => makeReportsDbMock());

import {
  REPORTS_DB_TABLE_NAMES,
  makeReportsDbTables,
  reportsDbModuleExports,
  type ReportsDbTables,
  type TableTag,
} from "./reportsDbMockExports";

export type Row = Record<string, any>;
export type ColRef = { __table: string; __col: string };
// SQL marker objects emitted by the mock `sql` template tag. The retry-chain
// audit endpoint composes its child-fetch query as
// `inArray(sql\`(${scope}->>'retriedFromAuditId')::int\`, frontier)` plus a
// `sql\`...->>'retriedFromAuditId' ~ '^[0-9]+$'\`` regex guard. Recognising
// those two specific shapes lets the in-memory evaluator dispatch on
// `row.scope.retriedFromAuditId` instead of a column lookup.
export type SqlMarker =
  | { kind: "true" }
  | { kind: "hasNumericParent" }
  | { kind: "parentInt" };
export type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "isNotNull"; col: ColRef }
  | { kind: "inArray"; col: ColRef | SqlMarker; values: any[] }
  | { kind: "and"; preds: Pred[] }
  | { kind: "hasNumericParent" }
  | { kind: "true" }
  // Used by the audit-log endpoint's anchor page-resolver to count rows
  // newer than a given anchor in desc(createdAt, id) sort order. In real
  // SQL this is a tuple comparison against a sub-select; here we just
  // remember the anchor id and resolve the comparison in JS.
  | { kind: "newerThanAnchor"; tableName: string; anchorId: number }
  // Half-open date-range filter used by the audit-log endpoint
  // (`gte(createdAt, fromDate)` + `lt(createdAt, toDate)`). Only the Date
  // shape is recognised so existing tests that pass non-Date values via
  // `gte`/`lt` keep the previous "match all" behaviour and don't have to
  // start seeding date columns they never relied on before.
  | { kind: "gte"; col: ColRef; val: Date }
  | { kind: "lt"; col: ColRef; val: Date };

// Superset of the tables referenced by reports.ts at module load. Tests that
// only exercise a subset can ignore the others — the unused tags simply act
// as stand-ins so the import in reports.ts doesn't blow up.
//
// Each tag starts life as a name-only stub built synchronously here so
// `resetMockDb` (which runs in `beforeEach` before the route is imported,
// i.e. before `makeReportsDbMock` ever fires) can iterate `Object.values
// (tables)` safely. The full column surface — derived from the real
// Drizzle schema via `makeReportsDbTables` — is mixed in below by
// `populateTablesFromSchema`, which runs inside the
// `vi.mock("@workspace/db", ...)` factory. Mutating each tag in place
// preserves object identity so the route's captured `partnersTable` etc.
// reference observes the freshly-added column properties.
export const tables: ReportsDbTables = (() => {
  const stubs = {} as ReportsDbTables;
  for (const name of REPORTS_DB_TABLE_NAMES) {
    stubs[name] = { __name: name };
  }
  return stubs;
})();

// Idempotent: subsequent calls (e.g. when a test recreates the mock)
// just re-confirm the same column properties. Only runs the schema
// import once per test process via `cachedSchemaTables`.
let cachedSchemaTables: ReportsDbTables | undefined;
async function populateTablesFromSchema(): Promise<void> {
  if (!cachedSchemaTables) {
    cachedSchemaTables = await makeReportsDbTables();
  }
  for (const name of REPORTS_DB_TABLE_NAMES) {
    Object.assign(tables[name] as TableTag, cachedSchemaTables[name]);
  }
}

// Mutable shared state — both objects keep their identity across resets so
// the closures inside the mocked db/drizzle modules continue to see the
// latest values without needing to be re-installed per test.
export const fixtures: Record<string, Row[]> = {};
export const nextId: Record<string, number> = {};

/**
 * Clear every fixture array and reset auto-incrementing ids. Pass an object
 * of `{ tableName: startingId }` to override the default starting id (1) for
 * specific tables — useful when a test seeds a row with a high id and wants
 * subsequent inserts to come in above it.
 */
export function resetMockDb(initialNextIds: Record<string, number> = {}): void {
  for (const k of Object.keys(fixtures)) delete fixtures[k];
  for (const k of Object.keys(nextId)) delete nextId[k];
  Object.assign(nextId, initialNextIds);
  // Pre-seed empty arrays for every table the helper knows about so tests
  // can `fixtures.vendors.push(...)` without first checking for existence.
  for (const t of Object.values(tables)) {
    fixtures[(t as any).__name] = [];
  }
}

function evalPred(pred: Pred | undefined, row: Row): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case "true":
      return true;
    case "eq":
      return row[pred.col.__col] === pred.val;
    case "isNull":
      return row[pred.col.__col] === null || row[pred.col.__col] === undefined;
    case "isNotNull":
      return row[pred.col.__col] !== null && row[pred.col.__col] !== undefined;
    case "inArray": {
      const col = pred.col as any;
      // `inArray(sql\`(...->>'retriedFromAuditId')::int\`, frontier)` —
      // the col argument is a SqlMarker, not a real ColRef. Read the
      // value off the JSONB scope blob instead of treating it as a
      // column lookup.
      if (col && col.kind === "parentInt") {
        const v = row.scope?.retriedFromAuditId;
        const num =
          typeof v === "number" && Number.isFinite(v) ? v : undefined;
        return num !== undefined && pred.values.includes(num);
      }
      if (col && "__col" in col) {
        return pred.values.includes(row[col.__col]);
      }
      return false;
    }
    case "and":
      return pred.preds.every((p) => evalPred(p, row));
    case "hasNumericParent": {
      const v = row.scope?.retriedFromAuditId;
      return typeof v === "number" && Number.isFinite(v);
    }
    case "gte": {
      const v = row[pred.col.__col];
      if (!(v instanceof Date)) return true;
      return v.getTime() >= pred.val.getTime();
    }
    case "lt": {
      const v = row[pred.col.__col];
      if (!(v instanceof Date)) return true;
      return v.getTime() < pred.val.getTime();
    }
    case "newerThanAnchor": {
      // Resolve the anchor's (createdAt, id) from the same fixture set
      // and emulate the (createdAt, id) > (anchor.createdAt, anchor.id)
      // tuple comparison Postgres does in the real query. The anchor
      // lookup that runs immediately before this count query already
      // confirmed the row exists, so a missing row here is a no-match.
      const all = fixtures[pred.tableName] ?? [];
      const anchor = all.find((r) => r.id === pred.anchorId);
      if (!anchor) return false;
      const rTs = +new Date(row.createdAt);
      const aTs = +new Date(anchor.createdAt);
      if (rTs !== aTs) return rTs > aTs;
      return row.id > anchor.id;
    }
  }
}

function makeQuery(tableName: string, isCount: boolean) {
  let pred: Pred | undefined;
  let limitN: number | undefined;
  let offsetN = 0;
  // The retry-chain audit endpoint orders its window query by
  // desc(createdAt), desc(id). Other callers don't assert ordering, so
  // toggling this on whenever `.orderBy(...)` is called is safe — and it
  // means tests don't have to seed rows in newest-first order to match the
  // route's pagination view.
  let descByCreatedAt = false;
  const run = () => {
    const all = fixtures[tableName] ?? [];
    const filtered = all
      .filter((r) => evalPred(pred, r))
      // Return shallow copies so the route holding a `prev` reference
      // doesn't see in-place mutations from a subsequent .update().set()
      // call. Drizzle returns fresh objects from each query — the mock
      // should too.
      .map((r) => ({ ...r }));
    if (isCount) return [{ value: filtered.length }];
    let ordered = filtered;
    if (descByCreatedAt) {
      ordered = [...filtered].sort((a, b) => {
        const at = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        if (bt !== at) return bt - at;
        return (b.id ?? 0) - (a.id ?? 0);
      });
    }
    // Apply offset BEFORE limit so paging math matches Postgres: page N
    // with pageSize P translates to offset = (N-1)*P, limit = P, and the
    // server expects rows P..2P-1 (0-indexed) — not the first P sliced
    // again to remove the offset.
    const start = offsetN;
    const end = limitN != null ? start + limitN : undefined;
    return ordered.slice(start, end);
  };
  const q: any = {
    where: (p: Pred) => {
      pred = p;
      return q;
    },
    leftJoin: () => q,
    innerJoin: () => q,
    orderBy: (..._args: unknown[]) => {
      descByCreatedAt = true;
      return q;
    },
    limit: (n: number) => {
      limitN = n;
      return q;
    },
    offset: (n: number) => {
      offsetN = n;
      return q;
    },
    then: (resolve: any, reject?: any) =>
      Promise.resolve(run()).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(run()).catch(reject),
  };
  return q;
}

/**
 * Factory for the `vi.mock("@workspace/db", ...)` replacement. Returns a
 * fresh object literal on every call so the mocked module exports look like
 * a real ESM module. Inserts/updates/deletes mutate the shared `fixtures`
 * and `nextId` state above.
 */
export async function makeReportsDbMock() {
  // Forward-declared `db` shape so the `transaction` shim can name its
  // own argument type (`tx: MockDb`) without TS hitting a circular
  // reference on the implicit-any inferred type of `db` itself.
  type MockDb = {
    select: (cols?: any) => any;
    insert: (t: any) => any;
    update: (t: any) => any;
    delete: (t: any) => any;
    execute: () => Promise<{ rows: any[] }>;
    transaction: <T>(cb: (tx: MockDb) => Promise<T>) => Promise<T>;
  };
  const db: MockDb = {
    select: (cols?: any) => {
      // Recognise count(*) selects: the route's pagination uses
      // `db.select({ value: sql<number>\`count(*)::int\` })`. Anything
      // else is treated as a normal row select.
      const isCount =
        cols !== undefined &&
        typeof cols === "object" &&
        cols !== null &&
        Object.keys(cols).length === 1 &&
        Object.prototype.hasOwnProperty.call(cols, "value");
      return {
        from: (t: any) => makeQuery(t.__name, isCount),
      };
    },
    insert: (t: any) => ({
      values: (v: any) => {
        const tableName = t.__name;
        if (!fixtures[tableName]) fixtures[tableName] = [];
        const id = nextId[tableName] ?? 1;
        nextId[tableName] = id + 1;
        const row = { id, createdAt: new Date(), ...v };
        fixtures[tableName].push(row);
        return {
          returning: async () => [row],
          then: (resolve: any) => Promise.resolve(undefined).then(resolve),
        };
      },
    }),
    update: (t: any) => ({
      set: (s: Row) => ({
        where: (pred: Pred) => {
          const apply = () => {
            const all = fixtures[t.__name] ?? [];
            const updated: Row[] = [];
            for (const r of all) {
              if (evalPred(pred, r)) {
                Object.assign(r, s);
                updated.push(r);
              }
            }
            return updated;
          };
          return {
            returning: async () => apply(),
            then: (resolve: any) => {
              apply();
              return Promise.resolve(undefined).then(resolve);
            },
          };
        },
      }),
    }),
    delete: (t: any) => ({
      where: (pred: Pred) => {
        // Memoise so `await chain` followed by `chain.returning()` (or
        // any double await) doesn't apply the delete twice.
        let cached: Row[] | undefined;
        const apply = () => {
          if (cached) return cached;
          const all = fixtures[t.__name] ?? [];
          const removed: Row[] = [];
          fixtures[t.__name] = all.filter((r) => {
            if (evalPred(pred, r)) {
              removed.push(r);
              return false;
            }
            return true;
          });
          cached = removed;
          return removed;
        };
        // Both `await db.delete(t).where(...)` (no `.returning()`) and
        // `await db.delete(t).where(...).returning()` need to actually
        // run the delete. Drizzle returns a thenable from `.where(...)`;
        // without a `.then` here the await would resolve to the chain
        // object itself and never touch the fixtures.
        return {
          returning: async () => apply(),
          then: (resolve: any) => {
            apply();
            return Promise.resolve(undefined).then(resolve);
          },
        };
      },
    }),
    execute: async () => ({ rows: [] }),
    // Single-connection mock — transactions just hand back the same `db`
    // as the tx, so callers like `db.transaction(async (tx) => ...)` see
    // the full select/insert/update/delete surface without us having to
    // model isolation. The in-memory fixtures don't support rollback:
    // if the callback throws, the rejection propagates as it would in
    // real drizzle, but already-applied mutations stay in `fixtures`.
    // Tests that need rollback-style semantics should assert against
    // the throw + reset between cases instead.
    transaction: async <T>(cb: (tx: MockDb) => Promise<T>): Promise<T> =>
      cb(db),
  };
  // Ensure each tag exposes the real Drizzle column properties before
  // the route grabs its references. After this returns,
  // `tables.partners.id` etc. are real ColRef stubs and the in-memory
  // query evaluator can resolve `eq(partnersTable.id, …)` correctly.
  await populateTablesFromSchema();
  return {
    db,
    ...(await reportsDbModuleExports(tables)),
  };
}

/**
 * Factory for the `vi.mock("drizzle-orm", ...)` replacement. Captures only
 * the helpers reports.ts actually uses; everything else is a no-op
 * passthrough that the in-memory `evalPred` interprets as "match all".
 */
export function makeDrizzleMock() {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  // Recognise the retry-chain SQL templates by their literal parts so the
  // in-memory evaluator can dispatch on `row.scope.retriedFromAuditId`
  // without parsing real Postgres syntax. We also recognise the audit
  // endpoint's anchor page-resolver, which uses a `(createdAt, id) >
  // (SELECT created_at, id FROM <table> WHERE id = <anchorId>)` tuple
  // comparison to find which page contains a given anchor row. Anything
  // else (e.g. the `count(*)` template) falls back to `{ kind: "true" }`
  // so it doesn't filter — the count select shape is detected separately
  // in `select(cols)` above.
  const sqlTag: any = (
    strings: TemplateStringsArray | string[] | string,
    ...values: any[]
  ): SqlMarker | Pred => {
    const parts = Array.isArray(strings)
      ? (strings as string[]).join(" ")
      : String(strings);
    if (parts.includes("retriedFromAuditId")) {
      if (parts.includes("::int")) return { kind: "parentInt" };
      if (parts.includes("[0-9]")) return { kind: "hasNumericParent" };
    }
    // Anchor page-resolver: `(createdAt, id) > (SELECT created_at, id
    // FROM <table> WHERE id = <anchorId>)`. The table ref is one of the
    // interpolated values, the anchor id is the last (a plain number).
    if (parts.includes("SELECT created_at, id FROM") && parts.includes(">")) {
      const last = values[values.length - 1];
      const tableRef = values.find(
        (v: any) => v && typeof v === "object" && typeof v.__name === "string",
      );
      if (tableRef && typeof last === "number" && Number.isFinite(last)) {
        return {
          kind: "newerThanAnchor",
          tableName: tableRef.__name,
          anchorId: last,
        };
      }
    }
    return { kind: "true" };
  };
  sqlTag.raw = passthrough;
  return {
    and: (...preds: Pred[]) => ({
      kind: "and",
      preds: preds.filter(Boolean),
    }),
    eq: (col: ColRef, val: any) => ({ kind: "eq", col, val }),
    isNull: (col: ColRef) => ({ kind: "isNull", col }),
    isNotNull: (col: ColRef) => ({ kind: "isNotNull", col }),
    inArray: (col: ColRef | SqlMarker, values: any[]) => ({
      kind: "inArray" as const,
      col,
      values,
    }),
    sql: sqlTag,
    desc: passthrough,
    gte: (col: ColRef, val: unknown) =>
      col && (col as ColRef).__col && val instanceof Date
        ? ({ kind: "gte", col, val } as Pred)
        : ({ kind: "true" } as Pred),
    lt: (col: ColRef, val: unknown) =>
      col && (col as ColRef).__col && val instanceof Date
        ? ({ kind: "lt", col, val } as Pred)
        : ({ kind: "true" } as Pred),
    gt: passthrough,
    lte: passthrough,
    or: passthrough,
  };
}
