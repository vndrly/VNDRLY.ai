import { db,runWithTrainingWorkerDatabase } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { buildStoredTrainingProjections } from './stored-training-projections';
import { repositoryCertificationProgress } from './repository-certifications';
import { companyTrainingProgress } from './team-training-progress';
import { storedCompanySafetyMaturity, companySafetyScoreSummary } from '../lib/company-safety-maturity';
import { storedCompanySafetyReadiness } from '../lib/company-safety-readiness';
import { storedCompanySafetyCatalog } from '../lib/safety-training-catalog-view';
import type { WorkHubOwner } from '@workspace/api-zod';
import {computeSafetyMetrics} from '../lib/safety-metrics';
import {storedLibraryRows} from './library-service';

export async function rebuildTrainingOwner(owner: WorkHubOwner) {
  return runWithTrainingWorkerDatabase(()=>buildStoredTrainingProjections(async () => {
    await storedLibraryRows(owner);
    await repositoryCertificationProgress(db,owner,null,{optimized:true});
    await companySafetyScoreSummary(owner,{optimized:true});
    await storedCompanySafetyMaturity(owner);
    await storedCompanySafetyReadiness(owner);
    await storedCompanySafetyCatalog(owner);
    await companyTrainingProgress(owner);
    const members = await db.execute(sql`SELECT id,user_id FROM user_org_memberships
      WHERE org_type=${owner.type} AND (CASE WHEN org_type='vendor' THEN vendor_id ELSE partner_id END)=${owner.id}`);
    for (const row of members.rows) await repositoryCertificationProgress(db,owner,Number(row.user_id),{optimized:true,membershipId:Number(row.id)});
  }));
}

let timer: ReturnType<typeof setInterval> | undefined;
let running=false;
export async function runTrainingProjectionWorker() {
  if(running)return;
  running=true;
  let claimedKey:string|undefined;
  try {
    // The additive migration seeds existing owners; source triggers enqueue new
    // owners and mutations. Ordinary ticks only claim that durable queue.
    const jobs=await db.execute(sql`WITH candidate AS (SELECT owner_key FROM training_projection_queue
      WHERE (lease_until IS NULL OR lease_until<now()) AND COALESCE(next_attempt_at,now())<=now()
      AND (completed_at IS NULL OR requested_at>completed_at OR completed_at<now()-interval '1 hour')
      ORDER BY CASE WHEN owner_key IN (SELECT 'vendor:'||id FROM vendors WHERE lower(name)='gatego') THEN 0 ELSE 1 END,
      COALESCE(completed_at,'epoch'::timestamptz),requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE training_projection_queue q SET lease_until=now()+interval '10 minutes',attempts=COALESCE(attempts,0)+1
      FROM candidate WHERE q.owner_key=candidate.owner_key RETURNING q.owner_key,q.requested_at`);
    const job=jobs.rows[0];if(!job)return;
    claimedKey=String(job.owner_key);
    const [type,id,siteId]=String(job.owner_key).split(':');
    if(type==='metrics')await buildStoredTrainingProjections(()=>computeSafetyMetrics(id==='site'?{siteLocationId:Number(siteId)}:{}));
    else await rebuildTrainingOwner({type:type as 'vendor'|'partner',id:Number(id)});
    await db.execute(sql`UPDATE training_projection_queue SET completed_at=${job.requested_at as Date},last_error=NULL,lease_until=NULL,attempts=0,next_attempt_at=now() WHERE owner_key=${String(job.owner_key)}`);
  } catch(error) {
    if(claimedKey)await db.execute(sql`UPDATE training_projection_queue SET lease_until=NULL,next_attempt_at=now()+interval '1 minute',last_error=${(error as {code?:string}).code??'build_failed'} WHERE owner_key=${claimedKey}`).catch(()=>undefined);
    console.error('Training summary worker could not finish; saved summaries remain available.',{code:(error as {code?:string}).code??'build_failed'});
  } finally {running=false;}
}
export function startTrainingProjectionWorker(){if(timer)return;const run=()=>runWithTrainingWorkerDatabase(()=>runTrainingProjectionWorker());timer=setInterval(()=>void run(),15000);timer.unref();}
export function stopTrainingProjectionWorker(){if(timer)clearInterval(timer);timer=undefined;}
