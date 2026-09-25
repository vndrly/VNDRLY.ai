import { and, eq } from "drizzle-orm";
import { gateStationsTable } from "@workspace/db/schema";
export function gateStationSchedulingFilter(id: string, cancellation = false) {
  const identity = eq(gateStationsTable.id, id);
  return cancellation
    ? identity
    : and(identity, eq(gateStationsTable.active, true))!;
}
