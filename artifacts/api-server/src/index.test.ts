import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Boot-wiring regression for the dev-only demo password self-check.
//
// Task #739 added `verifyDemoPasswords()` and Task #742 added a unit test
// proving it warns when a demo hash is stale. Neither, however, asserts that
// `index.ts` actually *calls* the self-check during startup. If a future
// refactor of the boot sequence drops the call, the existing unit test still
// passes and operators silently lose the warning that tells them
// `admin/admin123`, `exxon/exxon123`, etc. are 401-ing because of drifted
// hashes.
//
// This test loads `./index` with every heavy dependency mocked out so the
// boot path runs without opening a real port, hitting the database, or
// kicking off background timers. It then triggers the listening event the
// way Node would and asserts `verifyDemoPasswords()` was invoked exactly
// once. Commenting out the `void verifyDemoPasswords();` call inside
// `onListening` makes this test fail.
// ---------------------------------------------------------------------------

const { verifyDemoPasswordsSpy, fakeServer } = vi.hoisted(() => {
  // Minimal EventEmitter-shaped stub. We can't `import` from inside a
  // hoisted block, and we only need `on`/`emit`/`removeListener`/`close`
  // — the surface `index.ts` actually exercises against the value
  // returned by `app.listen()`.
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Listener[]>();
  const stub = {
    on(event: string, fn: Listener) {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
      return stub;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
      return true;
    },
    removeListener(event: string, fn: Listener) {
      const arr = listeners.get(event) ?? [];
      listeners.set(
        event,
        arr.filter((f) => f !== fn),
      );
      return stub;
    },
    close(cb?: (err?: Error) => void) {
      cb?.();
    },
  };
  return {
    verifyDemoPasswordsSpy: vi.fn(async () => {}),
    fakeServer: stub,
  };
});

// Replace the express app so `app.listen(port)` doesn't actually bind a
// socket — return our EventEmitter stub instead.
vi.mock("./app", () => ({
  default: { listen: () => fakeServer },
}));

// The function under test: capture every call so we can assert exactly-once.
vi.mock("./lib/verify-demo-passwords", () => ({
  verifyDemoPasswords: verifyDemoPasswordsSpy,
}));

// Stub every other side-effecting startup helper so importing `./index`
// doesn't fan out to real DB writes, timers, or message buses. We do not
// need to assert on these — only the demo-password self-check matters here.
vi.mock("./lib/inactivity-notifier", () => ({
  startInactivityNotifier: vi.fn(),
}));
vi.mock("./lib/rules-engine", () => ({ startRulesEngine: vi.fn() }));
vi.mock("./lib/stale-visit-sweeper", () => ({
  startStaleVisitSweeper: vi.fn(),
  stopStaleVisitSweeper: vi.fn(),
}));
vi.mock("./lib/visit-events", () => ({
  startVisitEventBus: vi.fn(),
  stopVisitEventBus: vi.fn(async () => {}),
}));
vi.mock("./lib/location-events", () => ({
  startLocationEventBus: vi.fn(),
  stopLocationEventBus: vi.fn(async () => {}),
}));
vi.mock("./lib/ticket-events", () => ({
  startTicketEventBus: vi.fn(),
  stopTicketEventBus: vi.fn(async () => {}),
}));
vi.mock("./lib/hotlist-comment-events", () => ({
  startHotlistCommentEventBus: vi.fn(),
  stopHotlistCommentEventBus: vi.fn(async () => {}),
}));
vi.mock("./lib/notification-events", () => ({
  startNotificationEventBus: vi.fn(),
  stopNotificationEventBus: vi.fn(async () => {}),
}));
vi.mock("./lib/backfill-user-emails", () => ({
  backfillUserEmailsFromUsername: vi.fn(async () => {}),
}));
vi.mock("./lib/backfill-partner-vendor-relationships", () => ({
  backfillPartnerVendorRelationshipsFromTickets: vi.fn(async () => {}),
}));
vi.mock("./lib/demo-password-override", () => ({
  applyDemoPasswordOverride: vi.fn(async () => {}),
}));
vi.mock("./lib/provision-mach-admin", () => ({
  provisionMachAdmin: vi.fn(async () => {}),
}));
vi.mock("./routes/ticketSchedule", () => ({
  startScheduledNotificationWorker: vi.fn(),
  stopScheduledNotificationWorker: vi.fn(),
}));
vi.mock("./lib/invoice-generator", () => ({
  startInvoicePeriodWorker: vi.fn(),
  stopInvoicePeriodWorker: vi.fn(),
}));
vi.mock("./lib/invoice-aging-worker", () => ({
  startInvoiceAgingWorker: vi.fn(),
  stopInvoiceAgingWorker: vi.fn(),
}));
vi.mock("./lib/ap-payment-digest", () => ({
  startApPaymentDigestWorker: vi.fn(),
  stopApPaymentDigestWorker: vi.fn(),
}));
vi.mock("./lib/reports/qb-mapping-bulk-cleanup", () => ({
  startBulkActionCleanupWorker: vi.fn(),
  stopBulkActionCleanupWorker: vi.fn(),
  startBulkActionExpiryWarningWorker: vi.fn(),
  stopBulkActionExpiryWarningWorker: vi.fn(),
}));

describe("api-server boot self-checks", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPort = process.env.PORT;
  // `index.ts` registers SIGTERM/SIGINT handlers via `process.once`. Snapshot
  // the count up front so we can remove only the ones we added in afterAll —
  // never anything vitest itself relies on.
  const sigtermBefore = process.listeners("SIGTERM").length;
  const sigintBefore = process.listeners("SIGINT").length;

  beforeAll(async () => {
    process.env.NODE_ENV = "development";
    process.env.PORT = "12345";

    // Importing `./index` runs the module top-level code: registers the
    // `listening`/`error` handlers on our fake server and the SIGTERM /
    // SIGINT shutdown handlers on `process`. No timers fire yet because
    // we never emit `listening`.
    await import("./index");

    // Drive the boot side-effects the same way Node would once the socket
    // is bound. `onListening` is what calls `verifyDemoPasswords()`.
    fakeServer.emit("listening");

    // `void verifyDemoPasswords()` is fire-and-forget; let the microtask
    // queue drain so the spy's call count is finalised before we assert.
    await new Promise((resolve) => setImmediate(resolve));
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;

    const sigtermAfter = process.listeners("SIGTERM");
    const sigintAfter = process.listeners("SIGINT");
    for (const l of sigtermAfter.slice(sigtermBefore)) {
      process.removeListener("SIGTERM", l as (...args: unknown[]) => void);
    }
    for (const l of sigintAfter.slice(sigintBefore)) {
      process.removeListener("SIGINT", l as (...args: unknown[]) => void);
    }
  });

  it("invokes verifyDemoPasswords exactly once when booting in development mode", () => {
    expect(verifyDemoPasswordsSpy).toHaveBeenCalledTimes(1);
  });
});
