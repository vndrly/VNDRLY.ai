import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@workspace/db", async (original) => ({
  ...(await original<typeof import("@workspace/db")>()),
  db: { execute: state.execute },
}));
vi.mock("./stored-training-projections", () => ({
  buildStoredTrainingProjections: vi.fn(),
}));
vi.mock("./repository-certifications", () => ({
  repositoryCertificationProgress: vi.fn(),
}));
vi.mock("./team-training-progress", () => ({ companyTrainingProgress: vi.fn() }));
vi.mock("../lib/company-safety-maturity", () => ({
  storedCompanySafetyMaturity: vi.fn(),
  companySafetyScoreSummary: vi.fn(),
}));
vi.mock("../lib/company-safety-readiness", () => ({
  storedCompanySafetyReadiness: vi.fn(),
}));
vi.mock("../lib/safety-training-catalog-view", () => ({
  storedCompanySafetyCatalog: vi.fn(),
}));
vi.mock("../lib/safety-metrics", () => ({ computeSafetyMetrics: vi.fn() }));
vi.mock("./library-service", () => ({ storedLibraryRows: vi.fn() }));

import {
  runTrainingProjectionWorker,
  startTrainingProjectionWorker,
  stopTrainingProjectionWorker,
} from "./training-projection-worker";

beforeEach(() => {
  stopTrainingProjectionWorker();
  vi.useRealTimers();
  vi.clearAllMocks();
  state.execute.mockResolvedValue({ rows: [] });
});

it("keeps projection rebuilding off the API startup path", async () => {
  vi.useFakeTimers();
  startTrainingProjectionWorker();
  await Promise.resolve();
  expect(state.execute).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(15_000);
  expect(state.execute).toHaveBeenCalledTimes(1);
  stopTrainingProjectionWorker();
});

it("claims the durable projection queue without rediscovering template owners", async () => {
  await runTrainingProjectionWorker();

  expect(state.execute).toHaveBeenCalledTimes(1);
  const claim = new PgDialect().sqlToQuery(state.execute.mock.calls[0][0]);
  expect(claim.sql).toContain("training_projection_queue");
  expect(claim.sql).toContain("FOR UPDATE SKIP LOCKED");
  expect(claim.sql).not.toContain("work_hub_form_templates");
});
