import { afterEach, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { createBillingReconciler } from "./stripe-billing-worker";
afterEach(() => vi.useRealTimers());
it("does not overlap polls, retains failed durable events for later polls and awaits shutdown", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const pending = vi.fn(async () => [{ id: "evt_fixture", type: "customer.subscription.updated", livemode: false, object: { customerId: "cus_fixture" } }]);
  const process = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const onError = vi.fn();
  const worker = createBillingReconciler({ pending, process, defer: vi.fn(async () => undefined), enabled: () => true, onError }, 1000);
  worker.start(); worker.start(); await Promise.resolve(); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(5000); expect(process).toHaveBeenCalledTimes(1);
  const stop = worker.stop(); finish(); await stop;
  await vi.advanceTimersByTimeAsync(5000); expect(pending).toHaveBeenCalledTimes(1);
  const retry = createBillingReconciler({ pending, process: vi.fn().mockRejectedValue(Error("temporary")), defer: vi.fn(async () => undefined), enabled: () => true, onError }, 1000);
  retry.start(); await vi.advanceTimersByTimeAsync(1001); await retry.stop();
  expect(onError).toHaveBeenCalled(); expect(pending.mock.calls.length).toBeGreaterThan(1);
});
