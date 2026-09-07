import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  pgTable,
  primaryKey,
  text,
  type PgDatabase,
} from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";
import pg from "pg";
import {
  provisionFreshLocalTestDatabase,
  resolveFreshLocalTestDatabaseTarget,
} from "../../../../scripts/fresh-test-database.mjs";

describe.runIf(process.env.VNDRLY_TEST_DB_MODE === "fresh-local")(
  "drizzle-kit PostgreSQL parameter binding",
  () => {
    it("introspects a real composite primary key without losing its schema/table bind values", async () => {
      const target = resolveFreshLocalTestDatabaseTarget(process.env);
      const fixture = pgTable(
        "bind_parameter_fixture",
        {
          tenant: text("tenant").notNull(),
          externalId: text("external_id").notNull(),
        },
        (table) => [primaryKey({ columns: [table.tenant, table.externalId] })],
      );
      const schema = { fixture };
      await provisionFreshLocalTestDatabase(
        target,
        (url) => new pg.Client({ connectionString: url }),
        async (client) =>
          pushSchema(
            schema,
            drizzle(client, { schema }) as unknown as PgDatabase<never>,
          ),
      );
      const client = new pg.Client({ connectionString: target.testUrl });
      await client.connect();
      try {
        await client.query(
          "INSERT INTO bind_parameter_fixture (tenant, external_id) VALUES ($1, $2)",
          ["tenant'quoted", "external-id"],
        );
        // drizzle-kit 0.31.9 without the patch throws PostgreSQL 42P02 here:
        // its composite-PK introspection adapter discarded $1 and $2 values.
        const comparison = await pushSchema(
          schema,
          drizzle(client, { schema }) as unknown as PgDatabase<never>,
        );
        expect(comparison.statementsToExecute).toEqual([]);
        expect(comparison.hasDataLoss).toBe(false);
        expect(
          (
            await client.query(
              "SELECT tenant FROM bind_parameter_fixture WHERE external_id = $1",
              ["external-id"],
            )
          ).rows,
        ).toEqual([{ tenant: "tenant'quoted" }]);
      } finally {
        await client.end();
        // The fixture database and its row remain available for inspection.
      }
    });
  },
);
