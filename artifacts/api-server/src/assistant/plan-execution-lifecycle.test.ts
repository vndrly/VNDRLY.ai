import { expect, it, vi } from "vitest";
import { createPlanExecutionLifecycle } from "./plan-execution-lifecycle";
it("does not load or start a disabled executor", async () => {
  const create = vi.fn();
  const lifecycle = createPlanExecutionLifecycle({ enabled: () => false, create, reportFailure: vi.fn() });
  await lifecycle.start(); await lifecycle.stop(); expect(create).not.toHaveBeenCalled();
});
it("starts once and awaits worker shutdown", async () => {
  const worker = { start: vi.fn(), stop: vi.fn(async () => {}), poll: vi.fn(async () => {}) };
  const create = vi.fn(async () => worker);
  const lifecycle = createPlanExecutionLifecycle({ enabled: () => true, create, reportFailure: vi.fn() });
  await Promise.all([lifecycle.start(), lifecycle.start()]);
  expect(create).toHaveBeenCalledTimes(1); expect(worker.start).toHaveBeenCalledTimes(1);
  await lifecycle.stop(); await lifecycle.start(); expect(worker.stop).toHaveBeenCalled(); expect(create).toHaveBeenCalledTimes(1);
});
it("never starts a factory that finishes after shutdown", async () => {
  const worker = { start: vi.fn(), stop: vi.fn(async () => {}), poll: vi.fn(async () => {}) };
  let finish!: (value: typeof worker) => void;
  const lifecycle = createPlanExecutionLifecycle({ enabled: () => true, create: () => new Promise(resolve => { finish = resolve; }), reportFailure: vi.fn() });
  const start = lifecycle.start(), stop = lifecycle.stop(); finish(worker);
  await Promise.all([start, stop]); expect(worker.start).not.toHaveBeenCalled(); expect(worker.stop).toHaveBeenCalled();
});
