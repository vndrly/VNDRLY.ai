import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import type { LibraryTx } from "./library-core";
import {
  AssignmentMetadataSchema,
  type WorkHubOwner,
} from "@workspace/api-zod";
import { pendingRequiredWork } from "./required-work-policy";
export class RequiredWorkError extends Error {
  readonly status = 409;
  readonly code = "work_hub.required_completion";
  constructor(readonly assignments: { id: string; title: string }[]) {
    super("Complete required Work Hub assignments before starting work");
  }
}
// Called inside the start mutation transaction, after its existing company authority check.
export async function assertRequiredWorkClear(
  tx: LibraryTx | Pick<PoolClient, "query">,
  userId: number,
  owner: WorkHubOwner,
) {
  const parameters = [userId, owner.type, owner.id];
  const memberSql = `SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.user_id=$1 AND m.org_type=$2 AND CASE WHEN $2='vendor' THEN m.vendor_id ELSE m.partner_id END=$3
 AND u.suspended_at IS NULL FOR SHARE OF m,u`;
  const rowsSql = `SELECT i.id,t.name AS title,i.template_version,i.assignment_metadata
 FROM work_hub_form_instances i JOIN work_hub_form_templates t ON t.id=i.template_id
 WHERE i.assignee_user_id=$1 AND t.owner_org_type=$2 AND t.owner_org_id=$3
 AND i.assignment_metadata IS NOT NULL FOR SHARE OF i`;
  async function read(text: string) {
    if (typeof tx.query === "function")
      return (await (tx as Pick<PoolClient, "query">).query(text, parameters))
        .rows;
    const query =
      text === memberSql
        ? sql`SELECT m.id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=${userId} AND m.org_type=${owner.type} AND CASE WHEN ${owner.type}='vendor' THEN m.vendor_id ELSE m.partner_id END=${owner.id} AND u.suspended_at IS NULL FOR SHARE OF m,u`
        : sql`SELECT i.id,t.name AS title,i.template_version,i.assignment_metadata FROM work_hub_form_instances i JOIN work_hub_form_templates t ON t.id=i.template_id WHERE i.assignee_user_id=${userId} AND t.owner_org_type=${owner.type} AND t.owner_org_id=${owner.id} AND i.assignment_metadata IS NOT NULL FOR SHARE OF i`;
    return (await (tx as LibraryTx).execute(query)).rows;
  }
  const onboardingSql = `SELECT DISTINCT b.id,b.name AS title FROM work_hub_form_templates b
 JOIN user_org_memberships m ON m.user_id=$1 AND m.org_type=$2 AND CASE WHEN $2='vendor' THEN m.vendor_id ELSE m.partner_id END=$3
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(b.bundle_definition->'entries','[]'::jsonb)) e
 WHERE b.owner_org_type=$2 AND b.owner_org_id=$3 AND b.library_metadata->>'kind'='bundle' AND b.library_metadata->>'state'='published'
 AND b.bundle_definition->'onboarding'->>'enabled'='true'
 AND m.created_at >= (b.bundle_definition->'onboarding'->>'activatedAt')::timestamptz
 AND (jsonb_array_length(coalesce(b.bundle_definition->'onboarding'->'roles','[]'))=0 OR (b.bundle_definition->'onboarding'->'roles') ? m.role)
 AND (jsonb_array_length(coalesce(b.bundle_definition->'onboarding'->'groupIds','[]'))=0 OR EXISTS (
 SELECT 1 FROM jsonb_array_elements_text(b.bundle_definition->'onboarding'->'groupIds') g(id)
 WHERE EXISTS (SELECT 1 FROM work_hub_channel_members cm JOIN work_hub_channels c ON c.id=cm.channel_id WHERE c.id::text=g.id AND cm.user_id=$1 AND c.owner_org_type=$2 AND c.owner_org_id=$3 AND c.status='active')
 OR EXISTS (SELECT 1 FROM vendor_crew_presets c WHERE $2='vendor' AND c.vendor_id=$3 AND 'crew:'||c.id::text=g.id AND c.member_employee_ids @> jsonb_build_array(m.vendor_people_id))))
 AND coalesce((e->>'requiredBeforeWork')::boolean,false)
 AND NOT EXISTS (SELECT 1 FROM work_hub_form_instances i WHERE i.assignee_user_id=$1 AND i.assignment_metadata->>'membershipId'=m.id::text AND i.template_id::text=e->>'templateId' AND i.template_version=(e->>'contentVersion')::integer AND (coalesce((i.assignment_metadata->>'requiredBeforeWork')::boolean,false) OR i.assignment_metadata->>'status' IN ('completed','exempted','cancelled')))`;
  const members = await read(memberSql);
  if (!members.length) throw new RequiredWorkError([]);
  const chunks = onboardingSql.split(/(\$[123])/).filter(Boolean).map(piece=>/^\$[123]$/.test(piece)?sql`${parameters[Number(piece.slice(1))-1]}`:sql.raw(piece));
  const missing = typeof tx.query === "function" ? (await (tx as Pick<PoolClient,"query">).query(onboardingSql,parameters)).rows : (await (tx as LibraryTx).execute(sql.join(chunks,sql.raw("")))).rows;
  if(missing.length) throw new RequiredWorkError(missing.map(row=>({id:String(row.id),title:String(row.title)})));
  const rows = await read(rowsSql);
  const pending = pendingRequiredWork(
    rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      templateVersion: Number(row.template_version),
      assignment: AssignmentMetadataSchema.parse(row.assignment_metadata),
    })),
    Number(members[0].id),
  );
  if (pending.length)
    throw new RequiredWorkError(
      pending.map(({ id, title }) => ({ id, title })),
    );
}
