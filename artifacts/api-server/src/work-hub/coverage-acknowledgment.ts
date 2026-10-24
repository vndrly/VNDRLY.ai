import type { pool } from "@workspace/db";

type Client = Pick<typeof pool, "query">;
// Notices are created in the assignment transaction. A canceled/replaced
// assignment can never leave an actionable acknowledgment behind.
export async function queueCoverageAcknowledgment(c: Client, input: {
  shiftId: string; userId: number; originalUserId: number | null;
  operationId: string; title: string; startsAt: Date | string; timezone: string;
}) {
  await c.query(`UPDATE notifications SET acknowledgement_required=false,next_delivery_attempt_at=NULL
    WHERE type='coverage_assignment' AND split_part(dedupe_key,':',2)=$1
    AND user_id=ANY($2::int[]) AND acknowledged_at IS NULL`,
    [input.shiftId, [input.userId, ...(input.originalUserId ? [input.originalUserId] : [])]]);
  const time = new Date(input.startsAt).toLocaleString("en-US", {timeZone:input.timezone});
  await c.query(`INSERT INTO notifications(user_id,type,category,title,body,link,dedupe_key,acknowledgement_required,next_delivery_attempt_at)
    VALUES($1,'coverage_assignment','system','Shift coverage assigned',$2,'/work-hub/calendar',$3,true,now())
    ON CONFLICT(user_id,dedupe_key) DO NOTHING`,
    [input.userId, `${input.title} · ${time} (${input.timezone}). Please acknowledge this assignment in your calendar.`,
      `coverage:${input.shiftId}:${input.operationId}`]);
}

export const pendingCoverageFrom = `FROM notifications n
  JOIN work_hub_shifts s ON s.id::text=split_part(n.dedupe_key,':',2)
  JOIN work_hub_shift_assignments a ON a.shift_id=s.id AND a.user_id=n.user_id
  WHERE n.type='coverage_assignment' AND n.acknowledgement_required=true
  AND n.acknowledged_at IS NULL AND a.status NOT IN ('cancelled','declined')
  AND s.milestone_status NOT IN ('cancelled','completed')
  AND s.owner_org_type='vendor' AND s.owner_org_id=$1`;
