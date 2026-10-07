export type PlanExecutionWorkerFailure = {
  code: 'plan_execution_worker_failed';
  stage: 'enabled' | 'run' | 'schedule' | 'stop';
};
export type PlanExecutionWorkerOptions = {
  enabled?: () => Promise<boolean>;
  pollIntervalMs?: number;
  maxRunsPerPoll?: number;
  schedule?: (tick: () => void, intervalMs: number) => () => void;
  onError?: (failure: PlanExecutionWorkerFailure) => void;
};
export type PlanExecutionWorkerDependencies = PlanExecutionWorkerOptions & {
  enabled: () => Promise<boolean>;
  /** Durable executor owns claims, authority, retries and canonical readback. */
  runOne: () => Promise<boolean>;
};
export type PlanExecutionWorker = {
  start(): void;
  /** Stops new claims and awaits the in-flight bounded poll; does not undo issued effects. */
  stop(): Promise<void>;
  poll(): Promise<void>;
};

const defaultSchedule = (tick: () => void, intervalMs: number) => {
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};

/** No import-time work. Local timers are wakeups; persisted claims remain the authority. */
export function createPlanExecutionWorker(deps: PlanExecutionWorkerDependencies): PlanExecutionWorker {
  const interval = deps.pollIntervalMs ?? 5000;
  const maximum = deps.maxRunsPerPoll ?? 1;
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 60000) throw Error('Invalid bounded poll interval');
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 5) throw Error('Invalid bounded poll batch');
  const schedule = deps.schedule ?? defaultSchedule;
  let stopped = true, generation = 0, running = false;
  let cancelTimer: (() => void) | undefined;
  let activePoll: Promise<void> | undefined;
  const report = (stage: PlanExecutionWorkerFailure['stage']) => {
    // Never forward raw exceptions: they may contain record text, tokens or private grants.
    try { deps.onError?.({ code: 'plan_execution_worker_failed', stage }); } catch { /* logging cannot authorize work */ }
  };
  const current = (captured: number) => !stopped && captured === generation;
  const worker: PlanExecutionWorker = {
    start() {
      if (!stopped) return;
      stopped = false;
      const captured = ++generation;
      try { cancelTimer = schedule(() => { if (current(captured)) void worker.poll(); }, interval); }
      catch { stopped = true; generation++; report('schedule'); return; }
      void worker.poll();
    },
    async stop() {
      stopped = true;
      generation++;
      const cancel = cancelTimer;
      cancelTimer = undefined;
      try { cancel?.(); } catch { report('stop'); }
      // A restart cannot overlap an old claim while this promise remains active.
      await activePoll;
    },
    async poll() {
      if (stopped || running) return;
      const captured = generation;
      running = true;
      const drain = async () => {
        try {
          for (let count = 0; count < maximum && current(captured); count++) {
            let enabled: boolean;
            try { enabled = await deps.enabled(); } catch { report('enabled'); break; }
            if (enabled !== true || !current(captured)) break;
            let processed: boolean;
            try { processed = await deps.runOne(); } catch { report('run'); break; }
            if (processed !== true) break;
          }
        } finally { running = false; }
      };
      const pending = drain();
      activePoll = pending;
      await pending;
      if (activePoll === pending) activePoll = undefined;
    },
  };
  return worker;
}

/** Explicit opt-in factory; startup, migration readiness and rollout remain the caller's responsibility. */
export async function createCanonicalPlanExecutionWorker(options: PlanExecutionWorkerOptions = {}): Promise<PlanExecutionWorker> {
  const [core, adapters, repository, authority, canonical] = await Promise.all([
    import('./plan-execution'), import('./plan-execution-adapters'), import('./plan-execution-repository'),
    import('./plan-execution-authorization'), import('./plan-execution-canonical'),
  ]);
  const executor = core.createPlanExecutor({
    repository: repository.createPrivatePlanExecutionRepository(),
    now: Date.now,
    authorize: async approved => (await authority.currentPlanExecutionAuthority(approved)).current,
    adapters: adapters.createPlanExecutionAdapters(canonical.createPlanExecutionCanonicalApi()),
    notify: canonical.createPlanExecutionSelfNotifier(),
  });
  return createPlanExecutionWorker({
    ...options,
    enabled: options.enabled ?? (async () => process.env.ASSISTANT_PLAN_EXECUTION_ENABLED === '1'),
    runOne: () => executor.runOne(),
  });
}
