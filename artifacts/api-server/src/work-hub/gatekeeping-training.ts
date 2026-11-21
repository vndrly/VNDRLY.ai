import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { WorkHubOwner } from '@workspace/api-zod';
import type { LibraryTx } from './library-core';

export const GATEKEEPING_PROGRAM = 'VUC116-GATEKEEPING';
export const GATEKEEPING_COURSE = 'VUC116-C01';

/** Role-based allocation keeps the same course row used by Site Security. */
export async function ensureGatekeepingTraining(tx: LibraryTx, owner: WorkHubOwner, userId?: number) {
  if (owner.type !== 'vendor') return 0;
  const people = await tx.execute(sql`SELECT DISTINCT m.user_id FROM user_org_memberships m
    JOIN vendor_people p ON (p.id=m.vendor_people_id OR p.user_id=m.user_id) AND p.vendor_id=m.vendor_id
    JOIN users u ON u.id=m.user_id
    WHERE m.org_type='vendor' AND m.vendor_id=${owner.id} AND p.is_active=true AND p.deleted_at IS NULL
      AND u.suspended_at IS NULL AND (lower(p.vendor_role)='gatekeeper' OR EXISTS(SELECT 1 FROM unnest(p.roles) role WHERE lower(trim(role))='gatekeeper'))
      AND lower(p.vendor_role)<>'gate_supervisor'
      ${userId ? sql`AND m.user_id=${userId}` : sql``}`);
  let changed = 0;
  for (const person of people.rows) {
    const id = Number(person.user_id);
    const added = await tx.execute(sql`INSERT INTO vndrly_u_assignments(id,owner_type,owner_id,user_id,course_id,sources,assigned_by)
      VALUES(${randomUUID()},'vendor',${owner.id},${id},${GATEKEEPING_COURSE},${JSON.stringify([GATEKEEPING_PROGRAM])}::jsonb,${id})
      ON CONFLICT(owner_type,owner_id,user_id,course_id) DO UPDATE SET
        sources=vndrly_u_assignments.sources || EXCLUDED.sources,updated_at=now()
      WHERE NOT vndrly_u_assignments.sources @> EXCLUDED.sources RETURNING id`);
    changed += added.rows.length;
    // Retire only untouched legacy safety assignments without an explicit assignment,
    // bundle, augmentation or company training policy. Preserve all evidence/history.
    const retired = await tx.execute(sql`UPDATE work_hub_form_instances i SET assignment_metadata=
      i.assignment_metadata || jsonb_build_object('status','cancelled','cancelledAt',${new Date().toISOString()}::text,
        'reason','Replaced inferred gatekeeper training with catalog Gatekeeping component',
        'version',COALESCE((i.assignment_metadata->>'version')::int,0)+1)
      FROM work_hub_form_templates t
      WHERE i.template_id=t.id AND t.owner_org_type='vendor' AND t.owner_org_id=${owner.id}
        AND i.assignee_user_id=${id} AND t.library_metadata->'safetyResource' IS NOT NULL
        AND t.library_metadata->>'kind'='training' AND i.assignment_metadata->>'status'='assigned'
        AND i.assignment_metadata->>'bundleId' IS NULL
        AND NOT EXISTS(SELECT 1 FROM work_hub_form_submissions s WHERE s.instance_id=i.id)
        AND COALESCE(i.assignment_metadata->'progress','{}'::jsonb) IN ('{}'::jsonb,'null'::jsonb,'{"lessonIds":[],"answers":{}}'::jsonb)
        AND NOT EXISTS(SELECT 1 FROM work_hub_client_operations o WHERE o.owner_org_type='vendor' AND o.owner_org_id=${owner.id}
          AND (o.result_json->>'assignmentId'=i.assignment_metadata->>'assignmentId'
            OR o.result_json->'assigned' ? i.id::text OR o.result_json->'reused' ? i.id::text))
        AND NOT EXISTS(SELECT 1 FROM work_hub_form_templates policy WHERE policy.owner_org_type='vendor' AND policy.owner_org_id=${owner.id}
          AND policy.library_metadata->'safetyResource'->>'familyId'=t.library_metadata->'safetyResource'->>'familyId'
          AND (COALESCE(policy.library_metadata->'trainingPolicy'->'requiredUserIds','[]'::jsonb)<>'[]'::jsonb
            OR COALESCE(policy.library_metadata->'trainingPolicy'->'requiredStaffRoleIds','[]'::jsonb)<>'[]'::jsonb
            OR COALESCE(policy.library_metadata->'trainingPolicy'->'requiredGroupIds','[]'::jsonb)<>'[]'::jsonb))
        AND NOT EXISTS(SELECT 1 FROM work_hub_file_library a WHERE a.org_type='vendor' AND a.org_id=${owner.id}
          AND a.kind='vendor_augmentation' AND (a.data->>'baseItemId'=t.id::text OR a.data->'courseIds' ? t.id::text))
      RETURNING i.id`);
    changed += retired.rows.length;
  }
  return changed;
}
