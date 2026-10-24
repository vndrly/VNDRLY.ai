import type { PoolClient } from "pg";
export type CoverageRule = {
  original_user_id: number | null;
  replacement_user_id: number;
};
/** Apply ordered transfers to the recurring owners, not to one-off cover. */
export function applyCoverageRules(
  owners: number[],
  rules: CoverageRule[],
  capacity: number,
) {
  const result = new Set(owners);
  for (const rule of rules) {
    if (rule.original_user_id !== null) {
      if (result.delete(rule.original_user_id) || result.size < capacity)
        result.add(rule.replacement_user_id);
    } else if (result.size < capacity) result.add(rule.replacement_user_id);
  }
  return [...result].sort((a, b) => a - b);
}
export async function coverageOwners(
  client: Pick<PoolClient, "query">,
  input: {
    vendorId: number;
    stationId: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    owners: number[];
    capacity: number;
  },
) {
  const ready = await client.query(
    "SELECT to_regclass('public.workforce_coverage_resolutions') IS NOT NULL AS ready",
  );
  if (!ready.rows[0]?.ready) return input.owners;
  const rules = await client.query(
    `SELECT original_user_id,replacement_user_id FROM workforce_coverage_resolutions
 WHERE vendor_id=$1 AND gate_station_id=$2 AND kind='permanent' AND timezone=$3
 AND effective_date<=($4::timestamptz AT TIME ZONE $3)::date
 AND weekday=extract(dow FROM $4::timestamptz AT TIME ZONE $3)
 AND starts_at_local=to_char($4::timestamptz AT TIME ZONE $3,'HH24:MI')
 AND ends_at_local=to_char($5::timestamptz AT TIME ZONE $3,'HH24:MI') ORDER BY created_at,id`,
    [
      input.vendorId,
      input.stationId,
      input.timezone,
      input.startsAt,
      input.endsAt,
    ],
  );
  return applyCoverageRules(input.owners, rules.rows, input.capacity);
}
