import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { accountingConnectionsTable } from "./accountingConnections";

// Per-(connection, line_type) cache of the QuickBooks Online Product/Service
// (Item) Id we should reference when posting invoice lines. Populated lazily
// the first time a vendor pushes invoices through `pushBundleToQbo` (or via
// an explicit "prepare items" admin action). Without this cache we'd be
// hard-coding `ItemRef.value = "1"`, which faults with "Invalid Reference Id"
// on any real QBO company whose Product/Service list doesn't have an Item
// with Id 1 matching our line types.
//
// `qboAccountId` is recorded too (the IncomeAccount the Item points at) so
// we can detect — and re-create the Item — if an admin later re-maps the
// line type to a different income account through `qb_account_mapping`.
export const accountingConnectionItemsTable = pgTable(
  "accounting_connection_items",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connection_id")
      .notNull()
      .references(() => accountingConnectionsTable.id, { onDelete: "cascade" }),
    // VNDRLY internal line_type key (labor_regular, equipment, mileage, …).
    lineType: text("line_type").notNull(),
    // QBO Item.Id (string, opaque) returned from the Product/Service list.
    qboItemId: text("qbo_item_id").notNull(),
    // QBO Account.Id of the IncomeAccountRef the Item is wired to. Used to
    // invalidate the cache row if the desired account changes.
    qboAccountId: text("qbo_account_id"),
    // QbAccount.name we used the last time we resolved this row. Stored so
    // the admin-facing item-map view can flag a row as stale when the
    // current `qb_account_mapping` resolver returns a different name
    // (without having to round-trip to QBO to compare account ids).
    qboAccountName: text("qbo_account_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqConnectionLineType: uniqueIndex(
      "acct_conn_items_conn_line_uniq",
    ).on(t.connectionId, t.lineType),
  }),
);

export type AccountingConnectionItem =
  typeof accountingConnectionItemsTable.$inferSelect;
