import type { PlanExecutionWorker } from "./plan-execution-worker";

/** Startup may race shutdown. A late factory never starts a new claim. */
export function createPlanExecutionLifecycle(deps: {
  enabled: () => boolean;
  create: () => Promise<PlanExecutionWorker>;
  reportFailure: () => void;
}) {
  let stopped = false;
  let worker: PlanExecutionWorker | undefined;
  let startup: Promise<void> | undefined;
  return {
    start(): Promise<void> {
      if (stopped || !deps.enabled()) return Promise.resolve();
      if (startup) return startup;
      startup = (async () => {
        try {
          const created = await deps.create();
          worker = created;
          if (stopped || !deps.enabled()) { await created.stop(); return; }
          created.start();
        } catch { try { deps.reportFailure(); } catch { /* no private errors */ } }
      })();
      return startup;
    },
    async stop() {
      stopped = true;
      await startup;
      await worker?.stop();
    },
  };
}
