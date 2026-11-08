import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  workerScope: vi.fn((action: () => unknown) => action()),
}));

vi.mock("@workspace/db", async (original) => ({
  ...(await original<typeof import("@workspace/db")>()),
  db: { transaction: state.transaction },
  runWithTrainingWorkerDatabase: state.workerScope,
}));
vi.mock("./library-delivery-worker", () => ({
  runLibraryDeliveryWork: vi.fn(),
}));
vi.mock("./training-course-policy", () => ({ assignPolicyTraining: vi.fn() }));
vi.mock("./required-training", () => ({ runRequiredTrainingWork: vi.fn() }));
vi.mock("./onboarding-service", () => ({
  savedBundleItems: vi.fn(),
  onboardingPeople: vi.fn(),
}));
vi.mock("./library-assignments", () => ({ allocateLibraryItems: vi.fn() }));
vi.mock("./library-audience", () => ({ companyLibraryPeople: vi.fn() }));

import {
  runOnboardingWork,
  startOnboardingWorker,
  stopOnboardingWorker,
} from "./onboarding-worker";

function emptyQuery() {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit", "innerJoin"])
    query[method] = vi.fn(() => query);
  query.for = vi.fn(async () => []);
  query.then = (
    resolve: (value: unknown[]) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve([]).then(resolve, reject);
  return query;
}

beforeEach(() => {
  stopOnboardingWorker();
  vi.useRealTimers();
  vi.clearAllMocks();
  state.select.mockImplementation(() => emptyQuery());
  state.transaction.mockImplementation(async (work) =>
    work({ execute: state.execute, select: state.select }),
  );
});

it("keeps the scheduled scan off the API startup path", async () => {
  vi.useFakeTimers();
  state.execute.mockResolvedValue({ rows: [{ acquired: false }] });

  startOnboardingWorker();
  await Promise.resolve();
  expect(state.transaction).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(60_000);
  expect(state.transaction).toHaveBeenCalledTimes(1);
  expect(state.workerScope).toHaveBeenCalledTimes(1);
  stopOnboardingWorker();
});

describe("Work Hub onboarding scan pressure", () => {
  it("skips every candidate read when another API process owns the scan", async () => {
    state.execute.mockResolvedValueOnce({ rows: [{ acquired: false }] });

    await expect(
      runOnboardingWork(new Date("2026-11-07T20:00:00.000Z")),
    ).resolves.toBe(0);

    expect(state.execute).toHaveBeenCalledTimes(1);
    expect(state.select).not.toHaveBeenCalled();
    const lock = new PgDialect().sqlToQuery(state.execute.mock.calls[0][0]);
    expect(lock.sql).toContain("pg_try_advisory_xact_lock");
    expect(lock.params).toContain("work-hub:onboarding-worker");
  });

  it("claims primary-key pages before evaluating any JSON schedule", async () => {
    state.execute
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValue({ rows: [] });

    await expect(
      runOnboardingWork(new Date("2026-11-07T20:00:00.000Z")),
    ).resolves.toBe(0);

    expect(state.select).not.toHaveBeenCalled();
    const statements = state.execute.mock.calls.map(([query]) =>
      new PgDialect().sqlToQuery(query).sql.toLowerCase(),
    );
    expect(statements).toHaveLength(4);
    const [lock, bundles, refreshers, policies] = statements;
    expect(lock).toContain("pg_try_advisory_xact_lock");
    for (const candidate of [bundles, refreshers, policies]) {
      expect(candidate).toContain("with candidate_page as materialized");
      expect(candidate).toMatch(/order by\s+candidate\.id/);
      expect(candidate).toContain("limit");
      expect(candidate).toContain("for update skip locked");
      expect(candidate).not.toMatch(/select\s+\*/);
      expect(candidate).not.toMatch(/\bdefinition\b/);
    }
    expect(bundles).toContain("bundle_definition");
    expect(refreshers).toContain("work_hub_form_instances");
    expect(policies).toContain("not exists");
    expect(policies.indexOf("limit")).toBeLessThan(
      policies.indexOf("trainingpolicy"),
    );
  });
});
