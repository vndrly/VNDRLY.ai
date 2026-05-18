/**
 * seed-demo-lifecycle.ts
 *
 * Pre-seeds a small set of "in-flight" lifecycle tickets so the tracking
 * dashboard feels alive on demo day. Creates:
 *   1. an EN ROUTE ticket (driving toward the site)
 *   2. an ON SITE ticket (checked in, currently working)
 *   3. an AWAITING REVIEW ticket (checked out, pending office review)
 *
 * Idempotent: every run first deletes any tickets it previously created
 * (identified by the "[DEMO-LIFECYCLE]" marker in `description`) plus their
 * gps_logs, then inserts a fresh set.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run seed:demo-lifecycle
 *
 *   # Keep the dashboard feeling continuously alive during a 30–60 min live
 *   # demo by re-running every N minutes (default 12) until Ctrl+C:
 *   pnpm --filter @workspace/api-server run seed:demo-lifecycle -- --loop
 *   pnpm --filter @workspace/api-server run seed:demo-lifecycle -- --loop --interval=10
 *
 *   # Or use the dedicated wrapper script which defaults to looping:
 *   pnpm --filter @workspace/api-server run seed:demo-lifecycle:loop
 *
 *   # Make the demo *visibly* progress: each tick, advance one ticket to its
 *   # next lifecycle stage (en_route → on_site → pending_review). When all
 *   # three are pending_review, the cycle resets by re-seeding from scratch.
 *   pnpm --filter @workspace/api-server run seed:demo-lifecycle -- --loop --advance
 *   pnpm --filter @workspace/api-server run seed:demo-lifecycle:advance
 *
 *   # One-command demo prep: seeds, prints accounts/site QR codes, then loops
 *   # until Ctrl+C, removing the demo tickets on shutdown.
 *   pnpm --filter @workspace/api-server run demo:start
 *
 *   # Bound the demo to a fixed window (e.g. 60 minutes). The loop auto-stops
 *   # when the duration elapses and runs the same cleanup as Ctrl+C.
 *   pnpm --filter @workspace/api-server run demo:start -- --duration=60
 *
 *   # Manual teardown (also runs automatically on Ctrl+C of demo:start):
 *   pnpm --filter @workspace/api-server run demo:stop
 */
import { and, asc, eq, inArray, isNull, like } from "drizzle-orm";
import {
  db,
  pool,
  ticketsTable,
  gpsLogsTable,
  ticketCheckInsTable,
  vendorsTable,
  vendorPeopleTable,
  siteLocationsTable,
  siteWorkAssignmentsTable,
  workTypesTable,
} from "@workspace/db";

const DEMO_MARKER = "[DEMO-LIFECYCLE]";
const VENDOR_NAME = "Precision Drilling";

type Plan = {
  label: string;
  siteCode: string;
  employeeIndex: number; // 0-based into the active vendor employees list
  lifecycleState: "en_route" | "on_site" | "off_site";
  status: "in_progress" | "pending_review";
  // Offsets in minutes from "now"; null = field not set.
  enRouteOffsetMin: number | null;
  arrivedOffsetMin: number | null;
  checkOutOffsetMin: number | null;
  // Distance (km, very rough) from the site for the departure point.
  departureKmFromSite: number;
};

const PLANS: Plan[] = [
  {
    label: "EN ROUTE",
    siteCode: "SITE-PB42EX01",
    employeeIndex: 0,
    lifecycleState: "en_route",
    status: "in_progress",
    enRouteOffsetMin: -18,
    arrivedOffsetMin: null,
    checkOutOffsetMin: null,
    departureKmFromSite: 9,
  },
  {
    label: "ON SITE",
    siteCode: "SITE-EFA1EX02",
    employeeIndex: 1,
    lifecycleState: "on_site",
    status: "in_progress",
    enRouteOffsetMin: -95,
    arrivedOffsetMin: -55,
    checkOutOffsetMin: null,
    departureKmFromSite: 14,
  },
  {
    label: "AWAITING REVIEW",
    siteCode: "SITE-DB07CH03",
    employeeIndex: 2,
    lifecycleState: "off_site",
    status: "pending_review",
    enRouteOffsetMin: -300,
    arrivedOffsetMin: -255,
    checkOutOffsetMin: -12,
    departureKmFromSite: 11,
  },
];

function offsetCoord(lat: number, lng: number, km: number) {
  // ~111 km per degree of latitude. Push slightly north & east.
  const dLat = (km * 0.7) / 111;
  const dLng = (km * 0.7) / (111 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

function minutesAgo(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}

async function cleanPrevious() {
  const prior = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(like(ticketsTable.description, `${DEMO_MARKER}%`));
  if (prior.length === 0) return 0;
  const ids = prior.map((t) => t.id);
  await db.delete(gpsLogsTable).where(inArray(gpsLogsTable.ticketId, ids));
  await db
    .delete(ticketCheckInsTable)
    .where(inArray(ticketCheckInsTable.ticketId, ids));
  await db.delete(ticketsTable).where(inArray(ticketsTable.id, ids));
  return ids.length;
}

async function main() {
  const [vendor] = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(eq(vendorsTable.name, VENDOR_NAME));
  if (!vendor) {
    throw new Error(`Vendor "${VENDOR_NAME}" not found — seed it first.`);
  }

  const employees = await db
    .select({
      id: vendorPeopleTable.id,
      firstName: vendorPeopleTable.firstName,
      lastName: vendorPeopleTable.lastName,
    })
    .from(vendorPeopleTable)
    .where(
      and(
        eq(vendorPeopleTable.vendorId, vendor.id),
        eq(vendorPeopleTable.isActive, true),
        isNull(vendorPeopleTable.deletedAt),
      ),
    )
    .orderBy(asc(vendorPeopleTable.id));
  if (employees.length < PLANS.length) {
    throw new Error(
      `Need at least ${PLANS.length} active field employees for vendor ${VENDOR_NAME}, found ${employees.length}.`,
    );
  }

  const removed = await cleanPrevious();
  if (removed > 0) console.log(`Removed ${removed} prior demo ticket(s).`);

  const created: Array<{ id: number; label: string; site: string }> = [];

  for (const plan of PLANS) {
    const [site] = await db
      .select({
        id: siteLocationsTable.id,
        name: siteLocationsTable.name,
        latitude: siteLocationsTable.latitude,
        longitude: siteLocationsTable.longitude,
      })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.siteCode, plan.siteCode));
    if (!site) {
      console.warn(`  ! site ${plan.siteCode} not found, skipping ${plan.label}`);
      continue;
    }

    // Pick a work type the vendor is approved to do at this site.
    const [assignment] = await db
      .select({
        workTypeId: siteWorkAssignmentsTable.workTypeId,
        workTypeName: workTypesTable.name,
      })
      .from(siteWorkAssignmentsTable)
      .innerJoin(
        workTypesTable,
        eq(siteWorkAssignmentsTable.workTypeId, workTypesTable.id),
      )
      .where(
        and(
          eq(siteWorkAssignmentsTable.vendorId, vendor.id),
          eq(siteWorkAssignmentsTable.siteLocationId, site.id),
        ),
      );
    if (!assignment) {
      console.warn(
        `  ! no work assignment for vendor ${vendor.id} at site ${plan.siteCode}, skipping ${plan.label}`,
      );
      continue;
    }

    const employee = employees[plan.employeeIndex];
    const departure = offsetCoord(
      site.latitude,
      site.longitude,
      plan.departureKmFromSite,
    );

    const enRouteAt =
      plan.enRouteOffsetMin != null ? minutesAgo(plan.enRouteOffsetMin) : null;
    const arrivedAt =
      plan.arrivedOffsetMin != null ? minutesAgo(plan.arrivedOffsetMin) : null;
    const checkOutTime =
      plan.checkOutOffsetMin != null
        ? minutesAgo(plan.checkOutOffsetMin)
        : null;
    const checkInTime = arrivedAt;

    const [ticket] = await db
      .insert(ticketsTable)
      .values({
        siteLocationId: site.id,
        vendorId: vendor.id,
        fieldEmployeeId: employee.id,
        workTypeId: assignment.workTypeId,
        status: plan.status,
        lifecycleState: plan.lifecycleState,
        description: `${DEMO_MARKER} ${plan.label} — ${assignment.workTypeName} at ${site.name}`,
        enRouteAt,
        arrivedAt,
        checkInTime,
        checkOutTime,
        departureLatitude:
          plan.lifecycleState === "en_route" || plan.lifecycleState === "on_site" || plan.lifecycleState === "off_site"
            ? departure.lat
            : null,
        departureLongitude:
          plan.lifecycleState === "en_route" || plan.lifecycleState === "on_site" || plan.lifecycleState === "off_site"
            ? departure.lng
            : null,
        checkInLatitude: arrivedAt ? site.latitude : null,
        checkInLongitude: arrivedAt ? site.longitude : null,
        checkOutLatitude: checkOutTime ? site.latitude : null,
        checkOutLongitude: checkOutTime ? site.longitude : null,
      })
      .returning({ id: ticketsTable.id });

    // GPS breadcrumbs so the lifecycle banner has data behind it.
    if (enRouteAt) {
      await db.insert(gpsLogsTable).values({
        ticketId: ticket.id,
        latitude: departure.lat,
        longitude: departure.lng,
        eventType: "en_route",
        recordedAt: enRouteAt,
      });
    }
    if (arrivedAt) {
      await db.insert(gpsLogsTable).values({
        ticketId: ticket.id,
        latitude: site.latitude,
        longitude: site.longitude,
        eventType: "check_in",
        recordedAt: arrivedAt,
      });
      await db.insert(ticketCheckInsTable).values({
        ticketId: ticket.id,
        employeeId: employee.id,
        checkInAt: arrivedAt,
        checkInLatitude: site.latitude,
        checkInLongitude: site.longitude,
        source: "auto",
        checkOutAt: checkOutTime,
        checkOutLatitude: checkOutTime ? site.latitude : null,
        checkOutLongitude: checkOutTime ? site.longitude : null,
      });
    }
    if (checkOutTime) {
      await db.insert(gpsLogsTable).values({
        ticketId: ticket.id,
        latitude: site.latitude,
        longitude: site.longitude,
        eventType: "check_out",
        recordedAt: checkOutTime,
      });
    }

    created.push({ id: ticket.id, label: plan.label, site: site.name });
    console.log(
      `  + #${String(ticket.id).padStart(4, "0")} ${plan.label.padEnd(16)} ${employee.firstName} ${employee.lastName} @ ${site.name}`,
    );
  }

  console.log(`\nSeeded ${created.length} demo lifecycle ticket(s).`);
}

/**
 * Advance one demo ticket to its next lifecycle stage:
 *   en_route → on_site (record arrival + check-in)
 *   on_site → pending_review (record check-out)
 * When every demo ticket has reached pending_review (or no demo tickets exist
 * yet), re-run the full seed so the cycle starts over.
 */
async function advanceOne(): Promise<void> {
  const demos = await db
    .select({
      id: ticketsTable.id,
      lifecycleState: ticketsTable.lifecycleState,
      siteLocationId: ticketsTable.siteLocationId,
      fieldEmployeeId: ticketsTable.fieldEmployeeId,
    })
    .from(ticketsTable)
    .where(like(ticketsTable.description, `${DEMO_MARKER}%`))
    .orderBy(asc(ticketsTable.id));

  if (demos.length === 0) {
    console.log("No demo tickets present — running full seed.");
    await main();
    return;
  }

  const enRoute = demos.find((t) => t.lifecycleState === "en_route");
  if (enRoute) {
    const [site] = await db
      .select({
        latitude: siteLocationsTable.latitude,
        longitude: siteLocationsTable.longitude,
        name: siteLocationsTable.name,
      })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, enRoute.siteLocationId));
    if (!site) {
      console.warn(
        `  ! site for ticket #${enRoute.id} not found, skipping advance`,
      );
      return;
    }
    const now = new Date();
    await db
      .update(ticketsTable)
      .set({
        lifecycleState: "on_site",
        status: "in_progress",
        arrivedAt: now,
        checkInTime: now,
        checkInLatitude: site.latitude,
        checkInLongitude: site.longitude,
      })
      .where(eq(ticketsTable.id, enRoute.id));
    await db.insert(gpsLogsTable).values({
      ticketId: enRoute.id,
      latitude: site.latitude,
      longitude: site.longitude,
      eventType: "check_in",
      recordedAt: now,
    });
    if (enRoute.fieldEmployeeId != null) {
      await db.insert(ticketCheckInsTable).values({
        ticketId: enRoute.id,
        employeeId: enRoute.fieldEmployeeId,
        checkInAt: now,
        checkInLatitude: site.latitude,
        checkInLongitude: site.longitude,
        source: "auto",
      });
    }
    console.log(
      `  → advanced #${enRoute.id} en_route → on_site @ ${site.name}`,
    );
    return;
  }

  const onSite = demos.find((t) => t.lifecycleState === "on_site");
  if (onSite) {
    const [site] = await db
      .select({
        latitude: siteLocationsTable.latitude,
        longitude: siteLocationsTable.longitude,
        name: siteLocationsTable.name,
      })
      .from(siteLocationsTable)
      .where(eq(siteLocationsTable.id, onSite.siteLocationId));
    if (!site) {
      console.warn(
        `  ! site for ticket #${onSite.id} not found, skipping advance`,
      );
      return;
    }
    const now = new Date();
    await db
      .update(ticketsTable)
      .set({
        lifecycleState: "off_site",
        status: "pending_review",
        checkOutTime: now,
        checkOutLatitude: site.latitude,
        checkOutLongitude: site.longitude,
      })
      .where(eq(ticketsTable.id, onSite.id));
    await db
      .update(ticketCheckInsTable)
      .set({
        checkOutAt: now,
        checkOutLatitude: site.latitude,
        checkOutLongitude: site.longitude,
      })
      .where(
        and(
          eq(ticketCheckInsTable.ticketId, onSite.id),
          isNull(ticketCheckInsTable.checkOutAt),
        ),
      );
    await db.insert(gpsLogsTable).values({
      ticketId: onSite.id,
      latitude: site.latitude,
      longitude: site.longitude,
      eventType: "check_out",
      recordedAt: now,
    });
    console.log(
      `  → advanced #${onSite.id} on_site → pending_review @ ${site.name}`,
    );
    return;
  }

  console.log(
    "All demo tickets have reached pending_review — resetting the cycle.",
  );
  await main();
}

type CliOptions = {
  loop: boolean;
  intervalMin: number;
  advance: boolean;
  start: boolean;
  cleanup: boolean;
  durationMin: number | null;
};

function parseArgs(argv: string[]): CliOptions {
  let loop = false;
  let intervalMin = 12;
  let advance = false;
  let start = false;
  let cleanup = false;
  let durationMin: number | null = null;
  for (const arg of argv) {
    if (arg === "--") {
      // pnpm forwards the literal `--` separator through to the script; ignore it.
      continue;
    } else if (arg === "--loop" || arg === "-l") {
      loop = true;
    } else if (arg === "--advance" || arg === "-a") {
      advance = true;
    } else if (arg === "--start") {
      start = true;
    } else if (arg === "--cleanup" || arg === "--stop") {
      cleanup = true;
    } else if (arg.startsWith("--interval=")) {
      const raw = arg.slice("--interval=".length);
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --interval value: ${raw}`);
      }
      intervalMin = n;
    } else if (arg.startsWith("--duration=")) {
      const raw = arg.slice("--duration=".length);
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --duration value: ${raw}`);
      }
      durationMin = n;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: seed-demo-lifecycle [--start | --loop | --cleanup] [--interval=<minutes>] [--duration=<minutes>] [--advance]\n" +
          "  --start            seed once, print demo accounts/sites, then loop until Ctrl+C (cleans up on exit)\n" +
          "  --loop             re-run on an interval until killed (Ctrl+C)\n" +
          "  --cleanup          remove [DEMO-LIFECYCLE] tickets and exit (alias: --stop)\n" +
          "  --interval=<min>   minutes between runs in loop mode (default 12)\n" +
          "  --duration=<min>   auto-stop the loop after this many minutes\n" +
          "                     (runs the same cleanup as Ctrl+C); default: run\n" +
          "                     until interrupted\n" +
          "  --advance          on each tick, advance one demo ticket to the\n" +
          "                     next lifecycle stage instead of refreshing\n" +
          "                     timestamps; cycle resets after all advance",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { loop, intervalMin, advance, start, cleanup, durationMin };
}

function printDemoBriefing() {
  const line = "─".repeat(64);
  console.log(`\n${line}\nVNDRLY demo briefing\n${line}`);
  console.log("Demo accounts (web login):");
  console.log("  • admin     / admin123       — System Admin");
  console.log("  • exxon     / exxon123       — Partner (ExxonMobil, branded)");
  console.log("  • precision / precision123   — Vendor (Precision Drilling)");
  console.log("  • Field employee: Carlos Mendez (Precision Drilling) — credentials in seed scripts");
  console.log("  • Public visitor: anonymous via POST /api/auth/guest");
  console.log("\nDemo-critical site QR codes (siteCode):");
  console.log("  • SITE-PB42EX01   — used by EN ROUTE ticket");
  console.log("  • SITE-EFA1EX02   — used by ON SITE ticket");
  console.log("  • SITE-DB07CH03   — used by AWAITING REVIEW ticket");
  console.log("  • SITE-9F5DBAD8   — extra site for visitor flow");
  console.log(`${line}\n`);
}

async function runCleanupAndExit() {
  console.log("Cleaning up [DEMO-LIFECYCLE] tickets…");
  const removed = await cleanPrevious();
  console.log(`Removed ${removed} demo ticket(s).`);
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.cleanup) {
    await runCleanupAndExit();
    return;
  }

  if (!opts.loop && !opts.start) {
    if (opts.advance) {
      await advanceOne();
    } else {
      await main();
    }
    return;
  }

  if (opts.start) {
    printDemoBriefing();
  }

  const intervalMs = opts.intervalMin * 60_000;
  const durationSuffix =
    opts.durationMin != null
      ? ` Auto-stop after ${opts.durationMin} minute(s).`
      : "";
  console.log(
    opts.advance
      ? `Loop mode: advancing one demo ticket through its lifecycle every ${opts.intervalMin} minute(s). Press Ctrl+C to stop.${durationSuffix}`
      : `Loop mode: re-seeding demo lifecycle tickets every ${opts.intervalMin} minute(s). Press Ctrl+C to stop.${durationSuffix}`,
  );

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let durationTimer: NodeJS.Timeout | null = null;
  let resolveExit: (() => void) | null = null;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });

  const stop = async (signal: string) => {
    if (stopped) return;
    stopped = true;
    console.log(`\nReceived ${signal}, stopping demo lifecycle loop.`);
    if (timer) clearTimeout(timer);
    if (durationTimer) clearTimeout(durationTimer);
    if (opts.start) {
      try {
        await runCleanupAndExit();
      } catch (err) {
        console.error("Cleanup on shutdown failed:", err);
      }
    }
    resolveExit?.();
  };
  process.once("SIGINT", () => {
    void stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    void stop("SIGTERM");
  });
  if (opts.durationMin != null) {
    durationTimer = setTimeout(
      () => {
        void stop(`duration elapsed (${opts.durationMin} min)`);
      },
      opts.durationMin * 60_000,
    );
  }

  const tick = async () => {
    if (stopped) return;
    try {
      if (opts.advance) {
        console.log(`\n[${new Date().toISOString()}] advancing…`);
        await advanceOne();
      } else {
        console.log(`\n[${new Date().toISOString()}] re-seeding…`);
        await main();
      }
    } catch (err) {
      console.error("Loop iteration failed (will retry next interval):", err);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        void tick();
      }, intervalMs);
    }
  };

  await tick();
  await exited;
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
