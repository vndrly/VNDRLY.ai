import { z } from "zod/v4";

const Account = z
  .object({
    userId: z.number().int().positive(),
    companyId: z.number().int().positive(),
    membershipId: z.number().int().positive(),
    sessionVersion: z.number().int().nonnegative(),
  })
  .strict();
const FleetSession = z
  .object({
    id: z.uuid(),
    companyId: z.number().int().positive(),
    driverUserId: z.number().int().positive(),
    status: z.string(),
    phase: z.string(),
    version: z.number().int().positive(),
    allowedActions: z.array(z.string()),
  })
  .passthrough();

/** Call only with freshly authenticated canonical responses, never push/model data. */
export function fleetLiveActivityBinding(input: {
  account: unknown;
  expectedAccount: unknown;
  run: unknown;
  fetchedAt: number;
  now?: number;
}) {
  const account = Account.parse(input.account),
    expected = Account.parse(input.expectedAccount),
    run = FleetSession.parse(input.run);
  const now = input.now ?? Date.now();
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(input.fetchedAt) ||
    input.fetchedAt > now + 5000 ||
    now - input.fetchedAt > 5 * 60_000
  )
    throw new Error("live_work_read_stale");
  if (
    Object.keys(expected).some(
      (key) =>
        account[key as keyof typeof account] !==
        expected[key as keyof typeof expected],
    ) ||
    run.driverUserId !== account.userId ||
    run.companyId !== account.companyId ||
    run.status !== "in_progress" ||
    !run.allowedActions.includes("pause") ||
    ![
      "traveling_to_pickup",
      "traveling_to_next_stop",
      "at_pickup",
      "at_delivery",
      "loading",
      "unloading",
      "returning",
    ].includes(run.phase)
  )
    throw new Error("live_work_current_duty_required");
  return {
    contextBinding: JSON.stringify([
      "vndrly-live-work",
      account.userId,
      account.companyId,
      account.membershipId,
      account.sessionVersion,
    ]),
    sessionId: run.id,
    recordVersion: run.version,
    // Lock-screen content deliberately excludes names, sites, payloads and GPS.
    status: "active" as const,
    updatedAt: input.fetchedAt,
    staleAt: input.fetchedAt + 5 * 60_000,
    source: "canonical_fleet_run" as const,
  };
}
