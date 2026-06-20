import type { z } from "zod";
import { GetTicketResponse } from "@workspace/api-zod";

/**
 * Shared fixture factory for the row shape that `ticketSelect` projects
 * (see `routes/tickets.ts`). The chained-mock DB used by the
 * route-level vitest specs returns a single row object for every
 * `db.select(...)` call; that row eventually feeds into
 * `GetTicketResponse.parse(...)` inside the response helper. When a new
 * required field is added to `GetTicketResponse` (e.g. Task #498's
 * `intakeChannel`), every hand-rolled fixture in the suite silently
 * stops satisfying the parse and the route turns the throw into a
 * generic 500. The tests then fail with the unhelpful
 * "expected 500 to be 200" — and worse, several pre-existing failures
 * sit on `main` for exactly this reason, masking any *new* regression.
 *
 * The factory below is the single source of truth for those fixtures:
 *
 *   - `TicketRow` is derived from `z.infer<typeof GetTicketResponse>`
 *     and `Omit`s the route-computed fields (the ones the handler
 *     adds *after* the SQL row is read). When `GetTicketResponse`
 *     gains a new required field via codegen, `DEFAULTS` no longer
 *     satisfies `TicketRow` and `pnpm --filter @workspace/api-server
 *     run typecheck` (or any vitest run, which typechecks via tsx)
 *     fails with a precise "Property 'X' is missing" error.
 *
 *   - The runtime `expectedKeys` check at module load is defence in
 *     depth for the case where a stale build cache lets a typecheck
 *     slip past — the throw at import time still beats a 500 deep
 *     inside the route under test.
 *
 *   - `makeTicketRow(overrides)` accepts both typed `Partial<TicketRow>`
 *     overrides (so `status: "approved"` stays type-checked) and extra
 *     unknown columns (e.g. `partnerId` for the ownership query) so
 *     callers can add the few extra projections their specific test
 *     needs without losing type safety on the standard set.
 */

const ROUTE_COMPUTED_FIELDS = [
  "viewerCanDisperseFunds",
  // Task #853 — server-computed (admin OR partner-AP + status=funds_dispersed).
  // Lives on the response, never on the SQL row, so it stays out of DEFAULTS.
  "viewerCanReverseDispersal",
  "phoneIntakeCallerName",
] as const;
type RouteComputedField = (typeof ROUTE_COMPUTED_FIELDS)[number];

export type TicketRow = Omit<
  z.infer<typeof GetTicketResponse>,
  RouteComputedField
>;

const FIXED_NOW = new Date("2025-01-15T10:00:00.000Z");

const DEFAULTS: TicketRow = {
  id: 42,
  siteLocationId: 1,
  vendorId: 11,
  fieldEmployeeId: null,
  workTypeId: 2,
  status: "approved",
  description: null,
  notes: null,
  kickbackReason: null,
  checkInTime: FIXED_NOW,
  checkOutTime: null,
  checkInLatitude: null,
  checkInLongitude: null,
  checkOutLatitude: null,
  checkOutLongitude: null,
  siteName: "S",
  vendorName: "V",
  workTypeName: "W",
  workTypeCategory: null,
  workTypeTaxTreatment: null,
  effectiveTaxTreatment: null,
  fieldEmployeeName: null,
  partnerName: "P",
  partnerLogoUrl: null,
  vendorLogoUrl: null,
  createdAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
  unlockedAt: null,
  unlockedById: null,
  unlockedByName: null,
  unlockCount: 0,
  createdById: null,
  createdByName: null,
  closedById: null,
  closedByName: null,
  lifecycleState: null,
  enRouteAt: null,
  arrivedAt: null,
  departureLatitude: null,
  departureLongitude: null,
  siteLatitude: null,
  siteLongitude: null,
  siteRadiusMeters: null,
  afe: null,
  scheduledStartAt: null,
  scheduledDurationMinutes: null,
  foremanUserId: null,
  intakeChannel: null,
  paymentMethod: null,
  paymentReference: null,
  paymentNote: null,
  paymentDispersedAt: null,
  paymentDispersedById: null,
  paymentDispersedByName: null,
  approvedAt: null,
  paymentReceiptUrl: null,
  // Task #1029 follow-up — `startingMileage` / `endingMileage` were
  // added to GetTicketResponse by the mileage-tracking task; without
  // defaults here every ticket route test 500'd at the response Zod
  // parse.
  startingMileage: null,
  endingMileage: null,
  unreadCommentCount: 0,
};

const computedSet = new Set<string>(ROUTE_COMPUTED_FIELDS);
const expectedKeys = Object.keys(GetTicketResponse.shape).filter(
  (k) => !computedSet.has(k),
);
const actualKeys = new Set(Object.keys(DEFAULTS));
for (const k of expectedKeys) {
  if (!actualKeys.has(k)) {
    throw new Error(
      `makeTicketRow defaults are missing field "${k}" — GetTicketResponse ` +
        "added it after this factory was last updated. Append a default in " +
        "artifacts/api-server/src/test-utils/ticket-row.ts so route tests " +
        "stop silently 500-ing on the response Zod parse.",
    );
  }
}

export type TicketRowOverrides = Partial<TicketRow> & Record<string, unknown>;

/**
 * Build a complete `ticketSelect`-shaped row for the chained-mock DB
 * used by route tests. Pass overrides to tweak status, ids, payment
 * columns, etc.; the spread also accepts unknown extra keys (such as
 * `partnerId`) so a caller can satisfy adjacent ownership lookups
 * without giving up type safety on the standard projection.
 */
export function makeTicketRow(
  overrides: TicketRowOverrides = {},
): TicketRow & Record<string, unknown> {
  return { ...DEFAULTS, ...overrides };
}
