import { isDeepStrictEqual } from "node:util";
import { z } from "zod/v4";
import type { PoolClient } from "pg";
import { FleetRunEventSchema, type FleetRun } from "@workspace/api-zod";
import { FleetError } from "./fleet-repository";

type Event = FleetRun["events"][number];
type PendingEvent = { sequence: number; event: Event };
// Transaction-local facts are flushed with the canonical head and receipt.
// A failed transaction has no committed effect; the durable original command
// remains with its caller. This is not a client durability fallback.
const pending = new WeakMap<FleetRun, PendingEvent[]>();
export function appendFleetRunEvent(run: FleetRun, raw: Event) {
  if (!run.billingV2) { run.events.push(raw); return; }
  const event = FleetRunEventSchema.parse(JSON.parse(JSON.stringify(raw)));
  if (run.events.some(existing => existing.id === event.id))
    throw new FleetError("fleet.event_identity_conflict",409);
  const sequence = (run.eventHistory?.totalEvents ?? run.events.length) + 1;
  const firstEventId = run.events[0]?.id ?? event.id;
  pending.set(run, [...(pending.get(run) ?? []), { sequence, event: structuredClone(event) }]);
  run.events.push(structuredClone(event));
  if (run.events.length > 200) run.events = [run.events[0], ...run.events.slice(-199)];
  run.eventHistory = { version:2, totalEvents:sequence, firstEventId, latestEventId:event.id, complete:sequence===run.events.length };
}
export function pendingFleetRunEvents(run: FleetRun): readonly PendingEvent[] {
  return pending.get(run) ?? [];
}
export function clearPendingFleetRunEvents(run: FleetRun) { pending.delete(run); }

/** Existing scoped audit storage holds immutable event identities. Bootstrap
 * old complete heads once; never infer missing facts from a display window. */
export async function archiveFleetRunEvents(
  client: PoolClient, companyId: number, actorUserId: number,
  run: FleetRun, previous: FleetRun | undefined, added: readonly PendingEvent[],
) {
  if (!run.billingV2) return;
  if (run.eventHistory?.visibility === "permission_filtered") throw new FleetError("fleet.event_archive_unavailable",503);
  if (run.companyId !== companyId) throw new FleetError("fleet.event_archive_unavailable",503);
  previous ??= run.eventHistory && !added.length ? run : undefined;
  const entries: PendingEvent[] = [];
  if (previous?.eventHistory) {
    const last = previous.events.at(-1)!;
    const saved = (await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run-event' AND target_id=$2 ORDER BY id DESC LIMIT 1",[companyId,`${run.id}:${last.id}`])).rows[0]?.tool_output;
    if (!saved || saved.runId !== run.id || saved.companyId !== companyId || saved.sequence !== previous.eventHistory.totalEvents || !isDeepStrictEqual(saved.event,last))
      throw new FleetError("fleet.event_archive_unavailable",503);
    if (!added.length && !isDeepStrictEqual(run.events, previous.events))
      throw new FleetError("fleet.event_archive_adapter_required",503);
  } else {
    const original = previous?.events ?? (added.length ? [] : run.events);
    entries.push(...original.map((event,index)=>({sequence:index+1,event})));
  }
  entries.push(...added);
  const total = added.at(-1)?.sequence ?? previous?.eventHistory?.totalEvents ?? run.events.length;
  if (!total && !run.events.length) return;
  if (!total || !run.events.length) throw new FleetError("fleet.event_archive_unavailable",503);
  const records = entries.map(item=>({
    targetId:`${run.id}:${item.event.id}`,
    record:{version:2,companyId,runId:run.id,sequence:item.sequence,event:item.event},
  }));
  if (records.length) {
    const existing=(await client.query("SELECT target_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run-event' AND target_id=ANY($2::text[])",[companyId,records.map(row=>row.targetId)])).rows;
    const known=new Map(existing.map(row=>[row.target_id,row.tool_output]));
    for(const row of records) if(known.has(row.targetId)&&!isDeepStrictEqual(known.get(row.targetId),row.record))
      throw new FleetError("fleet.event_identity_conflict",409);
    const missing=records.filter(row=>!known.has(row.targetId));
    if(missing.length) await client.query("INSERT INTO assistant_action_audit(user_id,vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) SELECT $1,$2,'fleet','typed','canonical','fleet_event_archive','event-retained','fleet-run-event',entry->>'targetId',entry->'record','completed' FROM jsonb_array_elements($3::jsonb) entry",[actorUserId,companyId,JSON.stringify(missing)]);
  }
  run.eventHistory={version:2,totalEvents:total,firstEventId:run.events[0].id,latestEventId:run.events.at(-1)!.id,complete:total===run.events.length};
}

const pageQuery=z.object({cursor:z.string().regex(/^\d{1,16}:\d{1,16}$/).optional(),limit:z.coerce.number().int().min(1).max(200).default(50)}).strict();
const archivedEvent=z.object({version:z.literal(2),companyId:z.number().int().positive(),runId:z.uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),event:FleetRunEventSchema}).strict();
/** The owner resolves the actual run and current permission before calling.
 * Cursors hold the original upper sequence while newer work keeps flowing. */
export async function readFleetRunEventPage(client:PoolClient,run:FleetRun,raw:unknown={}) {
  const query=pageQuery.parse(raw), currentTotal=run.eventHistory?.totalEvents??run.events.length;
  const [upper,after]=query.cursor?query.cursor.split(":").map(Number):[currentTotal,0];
  if(!Number.isSafeInteger(upper)||!Number.isSafeInteger(after)||upper>currentTotal||after>upper||after<0)
    throw new FleetError("fleet.invalid_cursor",400);
  let entries:PendingEvent[];
  if(!run.eventHistory)entries=run.events.map((event,index)=>({sequence:index+1,event})).filter(row=>row.sequence>after&&row.sequence<=upper).slice(0,query.limit+1);
  else {
    const rows=(await client.query("SELECT tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-run-event' AND tool_output->>'runId'=$2 AND (tool_output->>'sequence')::bigint>$3::bigint AND (tool_output->>'sequence')::bigint<=$4::bigint ORDER BY (tool_output->>'sequence')::bigint,id LIMIT $5",[run.companyId,run.id,after,upper,query.limit+1])).rows;
    entries=rows.map((row,index)=>{
      const parsed=archivedEvent.safeParse(row.tool_output);
      if(!parsed.success||parsed.data.companyId!==run.companyId||parsed.data.runId!==run.id||parsed.data.sequence!==after+index+1)
        throw new FleetError("fleet.event_archive_unavailable",503);
      return {sequence:parsed.data.sequence,event:parsed.data.event};
    });
    if(entries.length<Math.min(query.limit+1,upper-after))throw new FleetError("fleet.event_archive_unavailable",503);
  }
  const included=entries.slice(0,query.limit);
  return {events:included.map(row=>row.event),totalEvents:upper,nextCursor:entries.length>query.limit?`${upper}:${included.at(-1)!.sequence}`:null,source:"recorded_fleet_events" as const,physicalProofVerified:false as const};
}
export async function readCompleteFleetRunEvents(client:PoolClient,run:FleetRun):Promise<Event[]> {
  if(!run.eventHistory?.complete&&run.eventHistory){
    const events:Event[]=[];let cursor:string|null=null;
    do{const page=await readFleetRunEventPage(client,run,{limit:200,...(cursor?{cursor}:{})});events.push(...page.events);cursor=page.nextCursor;}while(cursor);
    return events;
  }
  return run.events;
}

/** Pure projections must never mistake a compact display window for all facts. */
export function completeFleetRunEvents(run: FleetRun, source?: readonly Event[]): readonly Event[] {
  const events=source ?? run.events, history=run.eventHistory;
  if(history && (history.visibility === "permission_filtered" || events.length !== history.totalEvents || events[0]?.id !== history.firstEventId || events.at(-1)?.id !== history.latestEventId || new Set(events.map(event=>event.id)).size !== events.length))
    throw new FleetError("fleet.complete_event_history_required",503);
  return events;
}
