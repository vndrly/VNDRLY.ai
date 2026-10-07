import {
  FleetAvailabilityInputSchema,
  FleetAvailabilityReadSchema,
  FleetAvailabilityReadbackSchema,
  FleetAvailabilityReceiptSchema,
} from "./fleet-availability";
import type { z } from "zod/v4";
export type FleetAvailabilityCommand = z.infer<
  typeof FleetAvailabilityInputSchema
>;
export function fleetAvailabilityFingerprintValues(
  actorUserId: number,
  companyId: number,
  input: unknown,
) {
  return {
    actorUserId,
    companyId,
    ...FleetAvailabilityInputSchema.parse(input),
  };
}
export type FleetAvailabilityAttempt = {
  actorUserId: number;
  companyId: number;
  body: FleetAvailabilityCommand;
  commandFingerprint: string;
};
export class FleetAvailabilityAbsentConflict extends Error {}
function exactReceipt(attempt: FleetAvailabilityAttempt, raw: unknown) {
  const receipt = FleetAvailabilityReceiptSchema.parse(raw),
    body = attempt.body;
  if (
    receipt.operationId !== body.operationId ||
    receipt.actorUserId !== attempt.actorUserId ||
    receipt.companyId !== attempt.companyId ||
    receipt.driverUserId !== body.driverUserId ||
    receipt.commandFingerprint !== attempt.commandFingerprint ||
    receipt.previousFingerprint !== body.expectedFingerprint ||
    (body.recordId !== null && receipt.record.id !== body.recordId) ||
    receipt.record.startsAt !==
      new Date(body.window.plannedStartAt).toISOString() ||
    receipt.record.endsAt !==
      new Date(body.window.plannedEndAt).toISOString() ||
    receipt.record.available !== body.available ||
    receipt.record.recurring
  )
    throw new Error("fleet_availability_receipt_mismatch");
  return receipt;
}
export async function submitFleetAvailabilityAttempt(
  attempt: FleetAvailabilityAttempt,
  deps: {
    request(
      method: "GET" | "POST",
      path: string,
      body?: unknown,
    ): Promise<unknown>;
    assertCurrent(): void;
  },
) {
  deps.assertCurrent();
  const base = `/api/fleet/drivers/${attempt.body.driverUserId}/availability`;
  const saved = FleetAvailabilityReadbackSchema.parse(
    await deps.request("GET", `${base}/operations/${attempt.body.operationId}`),
  );
  deps.assertCurrent();
  if (saved.receipt) return exactReceipt(attempt, saved.receipt);
  const current = FleetAvailabilityReadSchema.parse(
    await deps.request("GET", base),
  );
  deps.assertCurrent();
  if (
    !current.canManage ||
    current.driverUserId !== attempt.body.driverUserId ||
    current.fingerprint !== attempt.body.expectedFingerprint
  )
    throw new FleetAvailabilityAbsentConflict("fleet_availability_changed");
  const response = await deps.request("POST", base, attempt.body);
  deps.assertCurrent();
  return exactReceipt(attempt, response);
}

/** Device-local date/time input refuses DST gaps and repeated times. */
export function fleetAvailabilityLocalWindow(start: string, end: string) {
  function instant(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
      throw new Error("invalid_local_time");
    const [date, time] = value.split("T"),
      [y, m, d] = date.split("-").map(Number),
      [h, min] = time.split(":").map(Number);
    const result = new Date(y, m - 1, d, h, min);
    const matches = (v: Date) =>
      v.getFullYear() === y &&
      v.getMonth() === m - 1 &&
      v.getDate() === d &&
      v.getHours() === h &&
      v.getMinutes() === min;
    if (!matches(result)) throw new Error("invalid_local_time");
    for (let offset = 1; offset <= 1440; offset++)
      if (
        matches(new Date(result.getTime() - offset * 60000)) ||
        matches(new Date(result.getTime() + offset * 60000))
      )
        throw new Error("invalid_local_time");
    return result.toISOString();
  }
  const plannedStartAt = instant(start),
    plannedEndAt = instant(end);
  if (Date.parse(plannedEndAt) <= Date.parse(plannedStartAt))
    throw new Error("invalid_local_time");
  return {
    plannedStartAt,
    plannedEndAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
