// Shared scaffolding for tests that mock `@workspace/db` while exercising
// the reports router. Centralises the list of every db export that
// `routes/reports.ts` imports at module load — so adding a new schema
// export to reports.ts is a one-line update here that fixes every test
// suite, instead of silently breaking one suite at a time.
//
// Each test file still defines its own fixture/`db` shape, but spreads the
// result of `reportsDbModuleExports(tables)` into the mocked module so the
// schema-tag and constant exports are always complete.
//
// Enum constants (`REPORT_EXPORT_FORMATS`, `TAX_1099_*`,
// `QB_ACCOUNT_MAPPING_AUDIT_ACTIONS`) AND per-table column lists are
// loaded lazily from the real `@workspace/db/schema` subpath via
// `vi.importActual` (see `loadReportsDbEnums` and
// `loadReportsDbSchemaTables`) rather than duplicated here. Adding a new
// format/status/action OR adding/renaming a column in a Drizzle table is
// automatically reflected in every reports test without touching this
// helper.
//
// The load has to be lazy because every test file installs a
// `vi.mock("drizzle-orm", () => makeDrizzleMock())`, and `makeDrizzleMock`
// is defined alongside `makeReportsDbMock` in `mock-reports-db.ts`. A
// top-level `import "@workspace/db/schema"` here would force the schema
// modules — and therefore `drizzle-orm` — to load before
// `mock-reports-db.ts` finishes evaluating, leaving the drizzle-orm mock
// factory pointing at an uninitialised binding. Deferring the import
// until `makeReportsDbMock()` actually runs (i.e. the
// `vi.mock("@workspace/db", ...)` factory body) lets every helper export
// initialise first, then resolves the real enum arrays / table column
// metadata through `vi.importActual` so the values come straight from
// `@workspace/db` without going through the mocked module path.
import { vi } from "vitest";
import type {
  REPORT_EXPORT_FORMATS as REPORT_EXPORT_FORMATS_T,
  QB_ACCOUNT_MAPPING_AUDIT_ACTIONS as QB_ACCOUNT_MAPPING_AUDIT_ACTIONS_T,
  TAX_1099_FORM_TYPES as TAX_1099_FORM_TYPES_T,
  TAX_1099_FILING_STATUSES as TAX_1099_FILING_STATUSES_T,
  TAX_1099_FILING_METHODS as TAX_1099_FILING_METHODS_T,
  TAX_1099_CORRECTION_STATUSES as TAX_1099_CORRECTION_STATUSES_T,
} from "@workspace/db/schema";

export interface ReportsDbEnums {
  REPORT_EXPORT_FORMATS: typeof REPORT_EXPORT_FORMATS_T;
  QB_ACCOUNT_MAPPING_AUDIT_ACTIONS: typeof QB_ACCOUNT_MAPPING_AUDIT_ACTIONS_T;
  TAX_1099_FORM_TYPES: typeof TAX_1099_FORM_TYPES_T;
  TAX_1099_FILING_STATUSES: typeof TAX_1099_FILING_STATUSES_T;
  TAX_1099_FILING_METHODS: typeof TAX_1099_FILING_METHODS_T;
  TAX_1099_CORRECTION_STATUSES: typeof TAX_1099_CORRECTION_STATUSES_T;
}

/**
 * Resolve the enum constants from the real `@workspace/db/schema` module
 * via `vi.importActual`. Using `importActual` (instead of a normal
 * `import("@workspace/db/schema")`) bypasses any active `vi.mock` for
 * `@workspace/db`, so we always get the live schema values even when the
 * caller has installed a full mock of the package.
 */
export async function loadReportsDbEnums(): Promise<ReportsDbEnums> {
  const schema =
    await vi.importActual<typeof import("@workspace/db/schema")>(
      "@workspace/db/schema",
    );
  return {
    REPORT_EXPORT_FORMATS: schema.REPORT_EXPORT_FORMATS,
    QB_ACCOUNT_MAPPING_AUDIT_ACTIONS: schema.QB_ACCOUNT_MAPPING_AUDIT_ACTIONS,
    TAX_1099_FORM_TYPES: schema.TAX_1099_FORM_TYPES,
    TAX_1099_FILING_STATUSES: schema.TAX_1099_FILING_STATUSES,
    TAX_1099_FILING_METHODS: schema.TAX_1099_FILING_METHODS,
    TAX_1099_CORRECTION_STATUSES: schema.TAX_1099_CORRECTION_STATUSES,
  };
}

export type TableTag = {
  __name: string;
  [col: string]: unknown;
};

/**
 * Build a TableTag from an explicit list of column names. Useful for
 * test-only stand-ins (e.g. a virtual table that doesn't exist in the
 * real schema) or when a test wants to deliberately constrain the column
 * surface. Real schema-backed tables should prefer `tableTagFromSchema`,
 * which derives the column list automatically.
 */
export function makeTableTag(name: string, cols: readonly string[]): TableTag {
  const t: TableTag = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t;
}

// Drizzle stores each table's column-name → Column map under this
// well-known global symbol (see `Table.Symbol.Columns` in drizzle-orm).
// Using `Symbol.for` resolves to the same key regardless of which copy
// of drizzle-orm allocated the table, which matters when the test
// loads the schema via `vi.importActual` while the route reaches it
// through the normal mocked module graph.
const DRIZZLE_COLUMNS_SYMBOL = Symbol.for("drizzle:Columns");

function columnNamesOf(schemaTable: unknown): string[] {
  const cols = (schemaTable as Record<symbol, unknown> | null | undefined)?.[
    DRIZZLE_COLUMNS_SYMBOL
  ];
  if (cols && typeof cols === "object") {
    return Object.keys(cols as Record<string, unknown>);
  }
  return [];
}

/**
 * Build a TableTag whose column properties mirror the real Drizzle
 * table's columns. Renaming or adding a column to the schema therefore
 * flows into every reports test automatically — no hand-typed column
 * lists to keep in sync.
 */
export function tableTagFromSchema(
  name: string,
  schemaTable: unknown,
): TableTag {
  return makeTableTag(name, columnNamesOf(schemaTable));
}

export interface ReportsDbTables {
  invoices: TableTag;
  invoiceLines: TableTag;
  partners: TableTag;
  vendors: TableTag;
  reportExportAuditLog: TableTag;
  qbAccountMapping: TableTag;
  qbAccountMappingAuditLog: TableTag;
  qbAccountMappingBulkActions: TableTag;
  qbAccountMappingCleanupAudit: TableTag;
  userOrgMemberships: TableTag;
  tax1099Filings: TableTag;
  dashboard1099DeliveryJobs: TableTag;
  users: TableTag;
  // Singleton table consulted by `getBulkActionRetentionDays()` (which is
  // imported transitively when reports.ts loads). Modelled here so the
  // bulk-actions list endpoint can be tested with the admin override
  // path active — without it, the DB lookup throws on `undefined.__name`
  // and the resolver silently falls back to the env var.
  platformSettings: TableTag;
}

// Single source of truth for the test-side table-tag name (the JS
// variable name our in-memory db uses, e.g. `partners`) → real Drizzle
// schema export name (e.g. `partnersTable`). This is the only piece of
// metadata that has to stay in sync; the column lists underneath are
// derived from the real Drizzle tables at runtime via
// `loadReportsDbSchemaTables`.
export const REPORTS_DB_TABLE_KEYS = {
  invoices: "invoicesTable",
  invoiceLines: "invoiceLinesTable",
  partners: "partnersTable",
  vendors: "vendorsTable",
  reportExportAuditLog: "reportExportAuditLogTable",
  qbAccountMapping: "qbAccountMappingTable",
  qbAccountMappingAuditLog: "qbAccountMappingAuditLogTable",
  qbAccountMappingBulkActions: "qbAccountMappingBulkActionsTable",
  qbAccountMappingCleanupAudit: "qbAccountMappingCleanupAuditTable",
  userOrgMemberships: "userOrgMembershipsTable",
  tax1099Filings: "tax1099FilingsTable",
  dashboard1099DeliveryJobs: "dashboard1099DeliveryJobsTable",
  users: "usersTable",
  platformSettings: "platformSettingsTable",
} as const satisfies Record<keyof ReportsDbTables, string>;

export const REPORTS_DB_TABLE_NAMES = Object.keys(
  REPORTS_DB_TABLE_KEYS,
) as readonly (keyof ReportsDbTables)[];

/**
 * Resolve every table referenced by the reports router from the real
 * `@workspace/db/schema` module via `vi.importActual`. Returns a record
 * keyed by the test-side short name (`partners`, `vendors`, …), with
 * the value being the live Drizzle pgTable object — column metadata
 * intact.
 */
export async function loadReportsDbSchemaTables(): Promise<
  Record<keyof ReportsDbTables, unknown>
> {
  const schema =
    await vi.importActual<typeof import("@workspace/db/schema")>(
      "@workspace/db/schema",
    );
  const out = {} as Record<keyof ReportsDbTables, unknown>;
  for (const name of REPORTS_DB_TABLE_NAMES) {
    const schemaKey = REPORTS_DB_TABLE_KEYS[name];
    out[name] = (schema as Record<string, unknown>)[schemaKey];
  }
  return out;
}

/**
 * Build the canonical `ReportsDbTables` map with column lists sourced
 * from the real Drizzle schema. Callers may pass `overrides` for any
 * table they want to fully replace (e.g. with a hand-tailored stub) —
 * but the common case has no overrides and just inherits whatever the
 * schema currently defines.
 *
 * Async because the real schema is loaded lazily via `vi.importActual`;
 * see the file header for why eager top-level imports are unsafe here.
 */
export async function makeReportsDbTables(
  overrides: Partial<ReportsDbTables> = {},
): Promise<ReportsDbTables> {
  const schemaTables = await loadReportsDbSchemaTables();
  const tables = {} as ReportsDbTables;
  for (const name of REPORTS_DB_TABLE_NAMES) {
    tables[name] = tableTagFromSchema(name, schemaTables[name]);
  }
  return { ...tables, ...overrides };
}

// One canonical place that lists every non-`db` export `routes/reports.ts`
// pulls from `@workspace/db`. Spreading this into a `vi.mock("@workspace/db")`
// factory ensures the mocked module always exposes the full set of schema
// tags and enum constants that reports.ts touches at module load — even
// the ones a particular test never exercises. Async because the enum
// constants are loaded lazily from the real schema (see
// `loadReportsDbEnums`).
export async function reportsDbModuleExports(tables: ReportsDbTables) {
  const enums = await loadReportsDbEnums();
  return {
    invoicesTable: tables.invoices,
    invoiceLinesTable: tables.invoiceLines,
    partnersTable: tables.partners,
    vendorsTable: tables.vendors,
    reportExportAuditLogTable: tables.reportExportAuditLog,
    qbAccountMappingTable: tables.qbAccountMapping,
    qbAccountMappingAuditLogTable: tables.qbAccountMappingAuditLog,
    qbAccountMappingBulkActionsTable: tables.qbAccountMappingBulkActions,
    qbAccountMappingCleanupAuditTable: tables.qbAccountMappingCleanupAudit,
    userOrgMembershipsTable: tables.userOrgMemberships,
    tax1099FilingsTable: tables.tax1099Filings,
    dashboard1099DeliveryJobsTable: tables.dashboard1099DeliveryJobs,
    usersTable: tables.users,
    platformSettingsTable: tables.platformSettings,
    ...enums,
  };
}
