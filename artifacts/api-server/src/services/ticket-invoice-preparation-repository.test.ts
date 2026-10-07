import { expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { invoicePreparationQuery, ticketInvoicePreparationForSession } from "./ticket-invoice-preparation-repository";

it("binds chronology parameters on the caller transaction without transaction control or SQL interpolation", async () => {
  const execute = vi.fn(async (_statement: SQL) => ({ rows: [{ id: 1 }] }));
  const malicious = "vendor'; COMMIT; --";
  expect(await invoicePreparationQuery(execute).query("SELECT $1::text WHERE $2=$2", [malicious, 17])).toEqual({ rows: [{ id: 1 }] });
  const compiled = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
  expect(compiled.sql).toBe("SELECT $1::text WHERE $2=$3");
  expect(compiled.params).toEqual([malicious, 17, 17]);
  expect(compiled.sql).not.toContain(malicious);
});

it("refuses platform, partner and incomplete vendor contexts before entering a database transaction", () => {
  for (const session of [{ role: "admin", userId: 17 }, { role: "partner", userId: 17, partnerId: 4 }, { role: "vendor", userId: 17, vendorId: 4 }]) {
    expect(() => ticketInvoicePreparationForSession(session)).toThrow();
  }
});
