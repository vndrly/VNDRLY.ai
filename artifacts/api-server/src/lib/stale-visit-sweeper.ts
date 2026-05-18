import { logger } from "./logger";

const INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000;

let intervalHandle: NodeJS.Timeout | null = null;
let initialTimeoutHandle: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    const { sweepStaleVisits } = await import("../routes/visits");
    const swept = await sweepStaleVisits();
    logger.info({ swept }, "Stale visit sweep complete");
  } catch (err) {
    logger.error({ err }, "Stale visit sweep failed");
  }
}

export function startStaleVisitSweeper(): void {
  if (intervalHandle || initialTimeoutHandle) return;
  initialTimeoutHandle = setTimeout(() => {
    initialTimeoutHandle = null;
    void tick();
    intervalHandle = setInterval(() => {
      void tick();
    }, INTERVAL_MS);
  }, INITIAL_DELAY_MS);
}

export function stopStaleVisitSweeper(): void {
  if (initialTimeoutHandle) {
    clearTimeout(initialTimeoutHandle);
    initialTimeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
