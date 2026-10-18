import { logger } from "../lib/logger";
import { gateDailyBillingService } from "./gate-daily-billing";
let timer: ReturnType<typeof setInterval> | undefined,
  running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await gateDailyBillingService.runDue();
  } catch (error) {
    logger.error(
      { err: error },
      "Gate scheduled billing needs review; retained periods were not discarded",
    );
  } finally {
    running = false;
  }
}
/** No schedule exists by default. Every due action rechecks its saved office
 * direction and uses the same serialized/idempotent transaction as Invoice Now. */
export function startGateDailyBillingWorker() {
  if (timer) return;
  timer = setInterval(() => void tick(), 60000);
  timer.unref();
  void tick();
}
export function stopGateDailyBillingWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
