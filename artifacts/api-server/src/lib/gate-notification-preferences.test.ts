import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { notificationPreferencesTable } from "../../../../lib/db/src/schema/notifications";

describe("gate notification preferences schema", () => {
  it("exposes additive gate preference columns with true defaults", () => {
    const columns = getTableConfig(notificationPreferencesTable).columns;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["gate_handoffs_enabled", "gate_alerts_enabled"]),
    );

    for (const name of ["gate_handoffs_enabled", "gate_alerts_enabled"]) {
      const column = columns.find((candidate) => candidate.name === name);
      expect(column?.notNull).toBe(true);
      expect(column?.default).toBe(true);
    }
  });
});
