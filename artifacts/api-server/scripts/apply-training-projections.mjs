import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { guardAdditiveReplay } from '../../../scripts/guard-additive-replay.mjs';

// Table/mode/columns are deliberately a fixed allowlist. Global dependencies use
// one statement trigger; per-owner dependencies preserve both OLD and NEW scope.
export const trainingProjectionSources = [
  ['work_hub_form_templates','owner',['owner_org_type','owner_org_id']],
  ['work_hub_form_instances','instance',['template_id']],
  ['work_hub_form_submissions','submission',['instance_id']],
  ['work_hub_file_library','org',['org_type','org_id']],
  ['work_hub_files','owner',['owner_org_type','owner_org_id']],
  ['work_hub_acknowledgements','owner',['owner_org_type','owner_org_id']],
  ['user_org_memberships','membership',['user_id','org_type','vendor_id','partner_id']],
  ['vendor_people','vendor',['vendor_id']],
  ['users','user',['id']],
  // staff_role_catalog and fleet_ops_state are stored on vendors.
  ['vendors','vendor-id',['id']],
  ['partners','partner-id',['id']],
  ['vendor_work_types','vendor',['vendor_id']],
  ['vendor_capabilities','vendor',['vendor_id']],
  ['vendor_partner_service_offers','offer',['vendor_capability_id','partner_id']],
  ['canonical_services','global',[]],
  ['canonical_service_aliases','global',[]],
  ['service_mappings','global',[]],
  // Partner work-type lineage can affect vendors through shared offers/mappings.
  ['work_types','global',[]],
  ['safety_maturity_assessments','org',['org_type','org_id']],
  ['safety_events','event',['id','vendor_id','partner_id','site_location_id']],
  ['safety_corrective_actions','event-child',['event_id']],
  ['safety_event_history','event-child',['event_id']],
  ['safety_training_modules','global',[]],
  ['safety_training_completions','user-child',['user_id']],
  ['employee_certifications','certificate',['employee_id']],
  ['fleet_person_capabilities','company',['company_id']],
  // Site changes influence safety-metric start dates and visibility.
  ['site_locations','site',['id']],
];

export async function runTrainingProjectionsMigration(client) {
  const source = await readFile(new URL('./apply-training-projections.sql', import.meta.url), 'utf8');
  if (/\b(?:DROP|TRUNCATE)\s+(?:TABLE|SCHEMA|DATABASE)|\bDELETE\s+FROM/i.test(source)) {
    throw new Error('Training projection migration contains a forbidden destructive statement');
  }
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('training-projections-v1'))");
    // Fail closed rather than install a trigger against a guessed schema.
    for (const [table,,columns] of trainingProjectionSources) {
      const result = await client.query(`SELECT attname FROM pg_attribute
        WHERE attrelid=to_regclass($1) AND attnum>0 AND NOT attisdropped`,[`public.${table}`]);
      const available = new Set(result.rows.map(row=>row.attname));
      if (!available.size || columns.some(column=>!available.has(column))) {
        throw new Error(`Training projection source schema is unavailable: ${table}`);
      }
    }
    await client.query(guardAdditiveReplay(source));
    for (const [table,mode] of trainingProjectionSources) {
      const trigger = `training_projection_dirty_${table}`;
      const existing = await client.query(`SELECT t.tgenabled,p.proname,t.tgargs
        FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE t.tgrelid=to_regclass($1) AND t.tgname=$2 AND NOT t.tgisinternal`,[`public.${table}`,trigger]);
      if (existing.rows.length) {
        const row=existing.rows[0];
        if (row.tgenabled !== 'O' || row.proname !== 'training_projection_source_changed'
          || Buffer.from(row.tgargs).toString('utf8') !== `${mode}\0`) {
          throw new Error(`Existing training projection trigger differs: ${table}`);
        }
      } else {
        // Identifiers and argument are from the static source allowlist above.
        await client.query(`CREATE TRIGGER "${trigger}" AFTER INSERT OR UPDATE OR DELETE ON public."${table}"
          FOR EACH ${mode==='global'?'STATEMENT':'ROW'} EXECUTE FUNCTION public.training_projection_source_changed('${mode}')`);
      }
    }
    const security = await client.query(`SELECT relname,relrowsecurity FROM pg_class
      WHERE oid IN ('public.training_read_projections'::regclass,'public.training_projection_queue'::regclass)`);
    if(security.rows.length!==2 || security.rows.some(row=>!row.relrowsecurity)) throw new Error('Projection RLS verification failed');
    await client.query('COMMIT');
    return { tables:2, sourceTriggers:trainingProjectionSources.length, existingDataPreserved:true };
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const url=process.env.DATABASE_URL?.trim();
  if(!url) throw new Error('DATABASE_URL is required for the additive training projections migration');
  const client=new pg.Client({connectionString:url});
  try {
    await client.connect();
    const projections=await runTrainingProjectionsMigration(client);
    console.log('Training projections migration verified',projections);
  } finally { await client.end().catch(()=>undefined); }
}
