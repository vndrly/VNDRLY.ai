import app from "./app";
import { logger } from "./lib/logger";
import { startInactivityNotifier } from "./lib/inactivity-notifier";
import { startRulesEngine } from "./lib/rules-engine";
import {
  startStaleVisitSweeper,
  stopStaleVisitSweeper,
} from "./lib/stale-visit-sweeper";
import { startVisitEventBus, stopVisitEventBus } from "./lib/visit-events";
import {
  startLocationEventBus,
  stopLocationEventBus,
} from "./lib/location-events";
import {
  startTicketEventBus,
  stopTicketEventBus,
} from "./lib/ticket-events";
import {
  startHotlistCommentEventBus,
  stopHotlistCommentEventBus,
} from "./lib/hotlist-comment-events";
import {
  startNotificationEventBus,
  stopNotificationEventBus,
} from "./lib/notification-events";
import {
  startMajikEventBus,
  stopMajikEventBus,
} from "./lib/majik-events";
import { backfillUserEmailsFromUsername } from "./lib/backfill-user-emails";
import { backfillPartnerVendorRelationshipsFromTickets } from "./lib/backfill-partner-vendor-relationships";
import { applyDemoPasswordOverride } from "./lib/demo-password-override";
import { provisionMachAdmin } from "./lib/provision-mach-admin";
import { verifyDemoPasswords } from "./lib/verify-demo-passwords";
import { startScheduledNotificationWorker, stopScheduledNotificationWorker } from "./routes/ticketSchedule";
import { startInvoicePeriodWorker, stopInvoicePeriodWorker } from "./lib/invoice-generator";
import {
  startInvoiceAgingWorker,
  stopInvoiceAgingWorker,
} from "./lib/invoice-aging-worker";
import {
  startApPaymentDigestWorker,
  stopApPaymentDigestWorker,
} from "./lib/ap-payment-digest";
import {
  startDashboard1099MonthlyEmailWorker,
  stopDashboard1099MonthlyEmailWorker,
} from "./lib/dashboard-1099-monthly-email";
import {
  startReconciliationWeeklyRecapWorker,
  stopReconciliationWeeklyRecapWorker,
} from "./lib/reconciliation-weekly-recap";
import {
  startBulkActionCleanupWorker,
  startBulkActionExpiryWarningWorker,
  stopBulkActionCleanupWorker,
  stopBulkActionExpiryWarningWorker,
} from "./lib/reports/qb-mapping-bulk-cleanup";
import {
  startSignupAssistantDigest,
  stopSignupAssistantDigest,
} from "./lib/signup-assistant-digest";
import { startNotificationEmailDigest } from "./lib/notification-email-digest";
import {
  startCertificationReminderWorker,
  stopCertificationReminderWorker,
} from "./lib/certification-reminder-worker";
import {
  startOaConnectionReminderWorker,
  stopOaConnectionReminderWorker,
} from "./lib/oa-connection-reminder-worker";
import {
  startApprovalRecomputeWorker,
  stopApprovalRecomputeWorker,
} from "./lib/approval-recompute-worker";
import { startCommentReplyDigest } from "./lib/comment-reply-digest";
import { markStuckDeliveryJobsAsFailed } from "./routes/reports";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const MAX_LISTEN_ATTEMPTS = 5;
const LISTEN_RETRY_DELAY_MS = 500;

let listenAttempts = 0;
let server = createServer();

function createServer() {
  const s = app.listen(port);
  s.on("listening", onListening);
  s.on("error", onError);
  return s;
}

function onListening(): void {
  listenAttempts = 0;
  logger.info({ port }, "Server listening");
  // Best-effort: backfill `users.email` from `users.username` for any
  // pre-existing logins created before the column was added. The
  // visitor-check-in notifier helper joins on this column, so without
  // the backfill notifications would silently miss existing users.
  void backfillUserEmailsFromUsername();
  // One-shot recovery for the partner portal's Vendors page after a
  // partner_vendor_relationships wipe. Runs only when that table is
  // empty, so re-boots after the recovery are no-ops.
  void backfillPartnerVendorRelationshipsFromTickets();
  // One-shot demo password override (gated by env var). Set
  // DEMO_PASSWORD_OVERRIDE=username:password (comma-separated for
  // multiple users) to reset specific user passwords on boot. Intended
  // for short-lived demo access; remove the env var after use.
  void applyDemoPasswordOverride();
  // Idempotent demo provisioning for the Mach Natural Resources admin
  // login. No-ops if the user already exists.
  void provisionMachAdmin();
  // Dev-only: warn when seeded demo logins (admin / exxon / precision /
  // etc.) have drifted password hashes so they silently 401. Read-only;
  // recovery is `POST /api/auth/seed`. See Task #739.
  if (process.env.NODE_ENV === "development") {
    void verifyDemoPasswords();
  }
  startInactivityNotifier();
  startRulesEngine();
  startStaleVisitSweeper();
  startVisitEventBus();
  startLocationEventBus();
  startTicketEventBus();
  startHotlistCommentEventBus();
  startNotificationEventBus();
  startMajikEventBus();
  startScheduledNotificationWorker();
  startInvoicePeriodWorker();
  startInvoiceAgingWorker();
  startApPaymentDigestWorker();
  startDashboard1099MonthlyEmailWorker();
  // Task #368 — every-6h scan that aggregates the past 7 days of
  // reconciliation drift into one summary email per opted-in vendor
  // (cadence = "weekly_recap"). Per-push emails for the legacy
  // "per_push" cadence still go out from the route handler.
  startReconciliationWeeklyRecapWorker();
  startBulkActionCleanupWorker();
  startBulkActionExpiryWarningWorker();
  startSignupAssistantDigest();
  startNotificationEmailDigest();
  startCertificationReminderWorker();
  // Task #248 — every-6h sweep that emails + in-app notifies the
  // creator of any OA connection whose credentials have been revoked
  // or whose OAuth refresh appears stale.
  startOaConnectionReminderWorker();
  // Task #1156 — every-6h sweep that re-derives every
  // partner_vendor_relationships row to catch silent compliance
  // expirations (COI/WC/GL) and qualified-employee lapses that no
  // mutation hook would have triggered.
  startApprovalRecomputeWorker();
  // Task #50 — every-5-minute reply-digest worker for ticket/hotlist
  // comment threads. Mentions still go out instantly via the alert
  // path; this worker just batches the chatty reply notifications.
  startCommentReplyDigest();
  // Task #272 — async 1099-deliver jobs run inside this Node process,
  // so a restart strands any in-flight jobs in `running`. Flip those
  // back to `failed` on boot so polling clients stop spinning.
  // Snapshot boot time *before* the async sweep so any enqueue racing
  // with this recovery (createdAt >= bootTimestamp) survives.
  const bootTimestamp = new Date();
  void markStuckDeliveryJobsAsFailed(bootTimestamp).catch((err) => {
    logger.warn({ err }, "Failed to recover stuck 1099 delivery jobs");
  });
}

function onError(err: NodeJS.ErrnoException): void {
  if (err.code === "EADDRINUSE" && listenAttempts < MAX_LISTEN_ATTEMPTS) {
    listenAttempts += 1;
    const delay = LISTEN_RETRY_DELAY_MS * listenAttempts;
    logger.warn(
      { port, attempt: listenAttempts, delay },
      "Port in use, retrying listen with backoff",
    );
    server.removeListener("listening", onListening);
    server.removeListener("error", onError);
    setTimeout(() => {
      server = createServer();
    }, delay);
    return;
  }
  logger.error({ err }, "Error listening on port");
  process.exit(1);
}

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "Shutting down server");
  stopStaleVisitSweeper();
  stopScheduledNotificationWorker();
  stopInvoicePeriodWorker();
  stopInvoiceAgingWorker();
  stopApPaymentDigestWorker();
  stopDashboard1099MonthlyEmailWorker();
  stopReconciliationWeeklyRecapWorker();
  stopBulkActionCleanupWorker();
  stopBulkActionExpiryWarningWorker();
  stopSignupAssistantDigest();
  stopCertificationReminderWorker();
  stopOaConnectionReminderWorker();
  stopApprovalRecomputeWorker();
  void stopVisitEventBus();
  void stopLocationEventBus();
  void stopTicketEventBus();
  void stopHotlistCommentEventBus();
  void stopNotificationEventBus();
  void stopMajikEventBus();
  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error during server shutdown");
      process.exit(1);
    }
    process.exit(0);
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
