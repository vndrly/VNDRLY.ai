import type { PoolClient } from "pg";
import { PROFILE_LICENSE_TYPES } from "@workspace/api-zod/profile-licenses";
import { certificationProgramById } from "@workspace/api-zod/certification-program-links";

type Credential = { name: string; expirationDate: string | null; verified: boolean };
const key = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
export function mapCredentialCompliance(required: string[], credentials: Credential[], at = new Date()) {
  const today = at.toISOString().slice(0, 10);
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86400000).toISOString().slice(0, 10);
  const requirements = [...new Set(required.filter(Boolean))];
  if (!requirements.length) return { color: "red" as const, reasons: ["Qualification requirements not recorded"] };
  const failures: string[] = [], warnings: string[] = [];
  for (const name of requirements) {
    const matches = credentials.filter(item => key(item.name) === key(name) && item.verified);
    const current = matches.filter(item => !item.expirationDate || item.expirationDate >= today);
    if (!current.length) failures.push(`${name}: missing, unverified or expired`);
    else if (!current.some(item => !item.expirationDate || item.expirationDate > soon)) warnings.push(`${name}: expires within 60 days`);
  }
  return { color: failures.length ? "red" as const : warnings.length ? "amber" as const : "green" as const, reasons: failures.length ? [...failures, ...warnings] : warnings };
}

/** Uses current recorded assignment requirements; does not grant work authorization. */
export async function readMapCredentialCompliance(client: Pick<PoolClient, "query">, vendorId: number, userId: number, at: Date) {
  if (at.getTime() < Date.now() - 60000) return { color: "red" as const, reasons: ["Historical qualification evidence not established"] };
  const { rows } = await client.query(`
    WITH people AS (SELECT id FROM vendor_people WHERE vendor_id=$1 AND user_id=$2 AND is_active=true AND deleted_at IS NULL),
    requirements AS (
      SELECT unnest(sh.qualification_codes) AS name FROM gate_duty_sessions duty
      JOIN work_hub_shifts sh ON sh.id=duty.work_hub_shift_id
      WHERE duty.user_id=$2 AND sh.owner_org_type='vendor' AND sh.owner_org_id=$1
        AND duty.started_at <= $3 AND (duty.ended_at IS NULL OR duty.ended_at > $3)
      UNION
      SELECT unnest(coalesce(w.required_certifications,'{}') || coalesce(w.blocking_certifications,'{}'))
      FROM tickets t JOIN work_types w ON w.id=t.work_type_id
      WHERE t.vendor_id=$1 AND t.status='in_progress'
        AND (t.field_employee_id IN (SELECT id FROM people) OR t.foreman_user_id=$2)
    )
    SELECT ARRAY(SELECT DISTINCT name FROM requirements WHERE name IS NOT NULL) AS required,
      EXISTS(SELECT 1 FROM gate_duty_sessions d WHERE d.user_id=$2 AND (d.post_coverage->>'vendorId' IS NULL OR (d.post_coverage->>'vendorId')::int=$1) AND EXISTS(SELECT 1 FROM people) AND d.started_at <= $3 AND (d.ended_at IS NULL OR d.ended_at > $3)) AS gate_duty,
      coalesce((SELECT jsonb_agg(jsonb_build_object('programId',program_id,'progress',progress)) FROM vndrly_u_certifications
        WHERE owner_type='vendor' AND owner_id=$1 AND user_id=$2),'[]'::jsonb) AS awards,
      coalesce((SELECT jsonb_agg(jsonb_build_object('name',name,'expirationDate',expiration_date,'verified',vendor_verified_at IS NOT NULL))
        FROM employee_certifications WHERE employee_id IN (SELECT id FROM people) AND deleted_at IS NULL AND created_at <= $3),'[]'::jsonb) AS certificates,
      coalesce((SELECT jsonb_agg(jsonb_build_object('details',details,'verified',to_jsonb(license)->>'verified_at' IS NOT NULL))
        FROM employee_licenses license WHERE employee_id IN (SELECT id FROM people) AND deleted_at IS NULL AND created_at <= $3),'[]'::jsonb) AS licenses`, [vendorId, userId, at]);
  const row = rows[0] ?? { required: [], certificates: [], licenses: [] };
  const credentials: Credential[] = row.certificates;
  for (const award of row.awards ?? []) {
    const credential = award.progress?.credential;
    const profile = award.progress?.profileRecord;
    if (!credential || profile?.removedAt || Date.parse(credential.awardedAt) > at.getTime() || !Number.isFinite(Date.parse(credential.awardedAt))) continue;
    const expirationDate = profile && 'expiresAt' in profile ? profile.expiresAt : credential.expiresAt;
    const names = [award.programId, certificationProgramById(award.programId)?.title];
    // The full Site Security award includes its Gatekeeping course. This is
    // internal training evidence, never a substitute for an external license.
    if (award.programId === 'VUC116') names.push('VUC116-GATEKEEPING');
    for (const name of names) if (name) credentials.push({ name, expirationDate: expirationDate?.slice(0, 10) ?? null, verified: true });
  }
  if (row.gate_duty && !row.required.length) row.required = ['VUC116-GATEKEEPING'];
  for (const license of row.licenses) {
    const details = license.details;
    const names = details.type === "driver" ? ["Driver license", "Driver license / CDL", ...(/\bCDL\b/i.test(details.licenseClass ?? "") ? ["CDL"] : [])] : [details.type, PROFILE_LICENSE_TYPES.find(item => item.id === details.type)?.name];
    for (const name of names.filter(Boolean)) credentials.push({ name, expirationDate: details.noExpiration ? null : details.expirationDate || "0000-00-00", verified: license.verified });
  }
  return mapCredentialCompliance(row.required, credentials, at);
}
