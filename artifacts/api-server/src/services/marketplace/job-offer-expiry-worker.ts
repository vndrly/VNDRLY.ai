import { expireJobOffers } from "./job-offers";
import { logger } from "../../lib/logger";
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startJobOfferExpiryWorker() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await expireJobOffers();
    } catch (err) {
      logger.warn({ err }, "Job offer expiration failed");
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), 60000);
  timer.unref();
  void tick();
}
export function stopJobOfferExpiryWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
