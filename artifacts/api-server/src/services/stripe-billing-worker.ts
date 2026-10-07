import { createBillingService, type BillingEvent } from "./stripe-billing";
import { createBillingRepository } from "./stripe-billing-repository";
import { createStripeBillingGateway, loadBillingConfig } from "./stripe-billing-gateway";

export function createBillingReconciler(deps: { pending: () => Promise<BillingEvent[]>; process: (event: BillingEvent) => Promise<unknown>; defer: (event: BillingEvent) => Promise<void>; enabled: () => boolean; onError: () => void }, intervalMs = 30_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false; let stopped = true; let active: Promise<void> | undefined;
  const poll = async () => {
    if (stopped || running || !deps.enabled()) return;
    running = true;
    try { for (const event of await deps.pending()) { if (stopped) break; try { await deps.process(event); } catch { deps.onError(); try { await deps.defer(event); } catch { deps.onError(); } } } }
    catch { deps.onError(); }
    finally { running = false; if (!stopped) timer = setTimeout(() => { active = poll(); }, Math.max(1000, intervalMs)); }
  };
  return { start() { if (!stopped) return; stopped = false; active = poll(); }, async stop() { stopped = true; if (timer) clearTimeout(timer); await active; } };
}

/** Root startup must wire this explicitly after the guarded migration. */
export function createCanonicalBillingReconciler(onError: () => void) {
  const config = loadBillingConfig();
  if (!config.enabled) return { start() {}, async stop() {} };
  const store = createBillingRepository(config.mode);
  const { gateway } = createStripeBillingGateway(config, process.env.VNDRLY_STRIPE_SECRET_KEY || "");
  const service = createBillingService(config, store, gateway);
  return createBillingReconciler({ pending: () => store.pendingEvents(20), process: event => service.processEvent(event), defer: event => service.deferEvent(event), enabled: () => true, onError });
}
