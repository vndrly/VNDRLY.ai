import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildTestCookie } from "../test-utils/session";

const state = vi.hoisted(() => ({
  rows: [] as Array<Array<{ count: number }>>,
  filters: [] as unknown[],
}));

vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  function chain(rows: Array<{ count: number }>) {
    const result: any = {};
    result.from = () => result;
    result.leftJoin = () => result;
    result.where = (condition: unknown) => {
      state.filters.push(condition);
      return result;
    };
    result.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return result;
  }
  return {
    ...schema,
    db: {
      select: () => chain(state.rows.shift() ?? [{ count: 0 }]),
      execute: vi.fn(),
    },
  };
});

vi.mock("../lib/dashboard-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/dashboard-rate-limit")>()),
  enforceDashboardRateLimit: vi.fn(async () => true),
}));

import dashboardRouter from "./dashboard";

const app = express()
  .use(cookieParser())
  .use(express.json())
  .use("/api", dashboardRouter);

function vendorCookie(vendorId: number) {
  return buildTestCookie({ userId: 1, role: "vendor", partnerId: null, vendorId });
}

function query(filter: unknown) {
  return new PgDialect().sqlToQuery(filter as any);
}

beforeEach(() => {
  state.rows = Array.from({ length: 7 }, () => [{ count: 0 }]);
  state.filters = [];
});

describe("GET /dashboard/summary tenant isolation", () => {
  it("scopes every vendor ticket aggregate to the active vendor", async () => {
    const response = await request(app)
      .get("/api/dashboard/summary")
      .set("Cookie", vendorCookie(607));

    expect(response.status).toBe(200);

    const ticketFilters = state.filters.map(query).filter((entry) =>
      entry.sql.includes('"tickets"'),
    );
    expect(ticketFilters).toHaveLength(5);
    for (const filter of ticketFilters) {
      expect(filter.sql).toContain('"tickets"."vendor_id" =');
      expect(filter.sql).toContain('"tickets"."id" >=');
      expect(filter.params).toContain(607);
      expect(filter.params).toContain(100001);
    }
  });
});
