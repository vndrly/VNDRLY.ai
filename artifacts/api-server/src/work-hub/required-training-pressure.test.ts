import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@workspace/db", async (original) => ({
  ...(await original<typeof import("@workspace/db")>()),
  db: { execute: state.execute, transaction: vi.fn() },
}));
vi.mock("../lib/company-required-training", () => ({
  companyRequiredTraining: vi.fn(),
}));
vi.mock("./library-assignments", () => ({ allocateLibraryItems: vi.fn() }));
vi.mock("./training-course-policy", () => ({ lockCompanyTraining: vi.fn() }));

import { requiredTrainingOwners } from "./required-training";

beforeEach(() => {
  vi.clearAllMocks();
  state.execute.mockResolvedValue({
    rows: [
      {
        cursorId: "00000000-0000-4000-8000-000000000020",
        type: "vendor",
        id: 41,
        eligible: true,
      },
    ],
  });
});

it("reads one primary-key page before evaluating training metadata", async () => {
  const afterId = "00000000-0000-4000-8000-000000000010";
  await expect(
    requiredTrainingOwners({
      afterId,
      limit: 20,
    }),
  ).resolves.toEqual([{ type: "vendor", id: 41 }]);

  expect(state.execute).toHaveBeenCalledTimes(1);
  const query = new PgDialect().sqlToQuery(state.execute.mock.calls[0][0]);
  expect(query.sql).toContain("WITH candidate_page AS MATERIALIZED");
  expect(query.sql).toContain("candidate.id >");
  expect(query.sql).toContain("ORDER BY candidate.id");
  expect(query.sql).toContain("LIMIT");
  expect(query.sql.indexOf("LIMIT")).toBeLessThan(
    query.sql.indexOf("safetyResource"),
  );
  expect(query.params).toEqual([afterId, 20]);
});
