import { extendGateDefinitionSchedules } from "./gate-shift-definitions";
import { isWorkHubEnabled } from "./feature-access";
import { logger } from "../lib/logger";
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startGateShiftDefinitionWorker() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { if (await isWorkHubEnabled()) await extendGateDefinitionSchedules(); }
    catch { logger.warn({ code: "gate_shift_definition_schedule_failed" }, "Recurring gate schedule will retry"); }
    finally { running = false; }
  };
  timer = setInterval(() => void tick(), 60 * 60 * 1000); timer.unref(); void tick();
}
export function stopGateShiftDefinitionWorker() { if (timer) clearInterval(timer); timer = undefined; }
