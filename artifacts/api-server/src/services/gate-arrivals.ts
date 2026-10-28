import { FleetRunSchema, FleetLocationObservationSchema, type FleetRun, type FleetLocationObservation, type GateArrival, type GateArrivalDetail, type GateArrivalsResponse, type GateMapVehicle } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import type { Pool } from "pg";
import type { SessionPayload } from "../lib/session";
import { estimateMapboxDrivingRoute, type RouteEstimateResult, type RouteCoordinate } from "../lib/mapbox-routing";
import { authorizeOfflineGateObservation } from "./gate-offline-observation";
import { effectiveDuty, type NativeState } from "./native-operations-policy";
import { metersBetween } from "./gate-post-policy";
import { readCompleteFleetRunEvents } from "./fleet-run-events";

export class GateArrivalsError extends Error {
  constructor(public code: string, public status = 403) { super(code); }
}
type Site = { id: number; name: string; partner_id: number; latitude: number | null; longitude: number | null; geofence_radius_m: number | null };
type Candidate = { run: FleetRun; companyName: string; driverName: string | null; vehicleLabel: string | null; observation: FleetLocationObservation | null };
type Estimate = (args: {origin: RouteCoordinate; destination: RouteCoordinate}) => Promise<RouteEstimateResult>;

/** Modern route siteId is billing-only. An explicit physical destination must
 * actually fall inside this site's fence; its billing context is never proof. */
export function gateStopMatchesSite(stop: FleetRun["stops"][number], site: Site): boolean {
  if (!stop.destination) return stop.siteId === site.id;
  const d = stop.destination;
  if (d.ownerType === "partner" && d.ownerId !== site.partner_id) return false;
  return d.latitude !== null && d.longitude !== null && site.latitude !== null && site.longitude !== null &&
    Number.isFinite(site.latitude) && Number.isFinite(site.longitude) && !!site.geofence_radius_m &&
    metersBetween(d as RouteCoordinate, site as RouteCoordinate) <= site.geofence_radius_m;
}
export function gateIncomingStop(run: FleetRun, site: Site) {
  if (run.status !== "in_progress" || !["traveling_to_pickup","traveling_to_next_stop"].includes(run.phase ?? "") || run.currentStopId) return null;
  const next = run.stops.find(stop => !run.visitedStopIds.includes(stop.id));
  return next && gateStopMatchesSite(next, site) ? next : null;
}
export function gatePhoneDirectionAvailable(observation: FleetLocationObservation,site:Site):boolean {
  // Use measured direction only when supplied with usable motion accuracy.
  // Missing phone motion remains a directed-assignment observation, never proof.
  const speed=observation.speedMetersPerSecond, accuracy=observation.speedAccuracyMetersPerSecond;
  if (speed==null || accuracy==null || accuracy>2) return true;
  if (speed<=0.5) return false;
  if (observation.headingDegrees==null || site.latitude===null || site.longitude===null) return true;
  const radians=Math.PI/180,from=observation.latitude*radians,to=site.latitude*radians,delta=(site.longitude-observation.longitude)*radians;
  const bearing=(Math.atan2(Math.sin(delta)*Math.cos(to),Math.cos(from)*Math.sin(to)-Math.sin(from)*Math.cos(to)*Math.cos(delta))/radians+360)%360;
  const difference=Math.abs(((observation.headingDegrees-bearing+540)%360)-180);
  return difference<=100;
}
export function freshGateObservation(raw: unknown, run: FleetRun, now: Date): FleetLocationObservation | null {
  const value = FleetLocationObservationSchema.safeParse(raw);
  if (!value.success) return null;
  const o = value.data, age = now.getTime() - Date.parse(o.recordedAt);
  return o.runId === run.id && o.driverUserId === run.driverUserId && o.vehicleAssetId === run.vehicleAssetId &&
    o.accuracyMeters !== null && o.accuracyMeters <= 1000 && age >= -30000 && age <= 360000 ? o : null;
}
export function projectGateRun(candidate: Candidate, site: Site): GateArrival {
  const {run, observation} = candidate;
  const nextStop=gateIncomingStop(run,site);
  return {
    id: `${run.id}:${nextStop?.id??"record"}`, runId: run.id, ticketId: run.linkedTicketId!, ticketNumber: String(run.linkedTicketId),
    title: run.title, driverName: candidate.driverName, vehicleLabel: candidate.vehicleLabel,
    companyName: candidate.companyName, status: run.status, phase: run.phase,
    etaMinutes: null, etaUnavailableReason: "gate_arrivals.route_unavailable", observedAt: observation?.recordedAt ?? null,
    destinationName: gateIncomingStop(run, site)?.destination?.name ?? site.name,
    siteLocationId: site.id, physicalProofVerified: false,
  };
}

export function createGateArrivalsService(
  database: Pick<Pool,"connect"> = pool,
  authorize = authorizeOfflineGateObservation,
  estimate: Estimate = estimateMapboxDrivingRoute,
  clock: () => Date = () => new Date(),
) {
  const capture = async (session: SessionPayload, siteId: number, runId?: string) => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='10s'");
      await authorize(client, session, siteId);
      const found = await client.query("SELECT id,name,partner_id,latitude,longitude,COALESCE(site_radius_meters,500) AS geofence_radius_m FROM site_locations WHERE id=$1 AND is_active=true AND hidden=false", [siteId]);
      if (!found.rows[0]) throw new GateArrivalsError("gate_arrivals.site_unavailable",404);
      const site = found.rows[0] as Site;
      // Read canonical retained heads and the legacy open aggregate, choosing
      // the newest version before filtering. A stale head cannot resurrect work.
      const rows = await client.query(`
        WITH heads AS (
          SELECT DISTINCT ON(a.vendor_id,a.target_id) a.vendor_id,a.tool_output AS run,0 AS source
          FROM assistant_action_audit a JOIN vendors v ON v.id=a.vendor_id
          JOIN partner_vendor_relationships r ON r.vendor_id=v.id AND r.partner_id=$1 AND r.status='approved'
          WHERE a.target_type='fleet-run' AND v.fleet_ops_state->>'enabled'='true'
            AND ($2::text IS NULL OR a.target_id=$2)
          ORDER BY a.vendor_id,a.target_id,a.id DESC
        ), all_runs AS (
          SELECT * FROM heads UNION ALL
          SELECT v.id,run,1 FROM vendors v
          JOIN partner_vendor_relationships r ON r.vendor_id=v.id AND r.partner_id=$1 AND r.status='approved'
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.fleet_ops_state->'runs','[]'::jsonb)) run
          WHERE v.fleet_ops_state->>'enabled'='true' AND ($2::text IS NULL OR run->>'id'=$2)
        ), current_runs AS (
          SELECT DISTINCT ON(vendor_id,run->>'id') vendor_id,run FROM all_runs
          ORDER BY vendor_id,run->>'id',(run->>'version')::int DESC,source DESC
        )
        SELECT c.run,c.vendor_id AS company_id,v.name AS company_name,u.display_name AS driver_name,asset.name AS vehicle_label
        FROM current_runs c JOIN vendors v ON v.id=c.vendor_id
        JOIN tickets t ON t.id=(c.run->>'linkedTicketId')::int AND t.vendor_id=c.vendor_id
        JOIN site_locations billing ON billing.id=t.site_location_id AND billing.partner_id=$1
        JOIN users u ON u.id=(c.run->>'driverUserId')::int AND u.suspended_at IS NULL
        JOIN assets asset ON asset.id::text=c.run->>'vehicleAssetId' AND asset.responsible_org_type='vendor' AND asset.responsible_org_id=c.vendor_id
        WHERE ($2::text IS NOT NULL OR (c.run->>'status'='in_progress' AND c.run->>'phase' IS DISTINCT FROM 'paused'
          AND t.status IN('draft','initiated','in_progress')))
        ORDER BY c.run->>'id' LIMIT 201`, [site.partner_id,runId ?? null]);
      const candidates: Candidate[] = [];
      for (const row of rows.rows.slice(0,200)) {
        const parsed = FleetRunSchema.safeParse(row.run);
        if (!parsed.success || !parsed.data.linkedTicketId || parsed.data.companyId!==row.company_id) continue;
        const run = parsed.data;
        if (runId ? !run.stops.some(stop => gateStopMatchesSite(stop, site)) : !gateIncomingStop(run,site)) continue;
        candidates.push({run,companyName:row.company_name,driverName:row.driver_name,vehicleLabel:row.vehicle_label,observation:null});
      }
      if (candidates.length) {
        const locations = await client.query(`
          SELECT DISTINCT ON(a.vendor_id,a.target_id) a.vendor_id,a.target_id,a.tool_output,p.native_operations
          FROM assistant_action_audit a
          JOIN work_hub_device_preferences p ON p.user_id=(a.tool_output->'observation'->>'driverUserId')::int
            AND p.owner_org_type='vendor' AND p.owner_org_id=a.vendor_id
          JOIN work_hub_devices d ON d.id::text=a.tool_output->>'deviceId' AND d.user_id=p.user_id
            AND d.owner_org_type='vendor' AND d.owner_org_id=a.vendor_id AND d.revoked_at IS NULL AND d.device_class='phone'
          JOIN vendors v ON v.id=a.vendor_id
          WHERE a.target_type='fleet-location' AND a.target_id=ANY($1::text[])
            AND v.native_operations_policy->>'enabled' IS DISTINCT FROM 'false'
            AND p.native_operations->>'designatedDeviceId'=a.tool_output->>'deviceId'
            AND EXISTS(SELECT 1 FROM user_org_memberships m WHERE m.user_id=p.user_id AND m.vendor_id=a.vendor_id AND m.org_type='vendor')
            AND (p.native_operations->'duty'->>'mode'='manual'
              OR (p.native_operations->'duty'->>'mode'='scheduled' AND EXISTS(
                SELECT 1 FROM work_hub_shifts sh JOIN work_hub_shift_assignments sa ON sa.shift_id=sh.id
                WHERE sh.id::text=p.native_operations->'duty'->>'shiftId' AND sa.user_id=p.user_id
                  AND sh.owner_org_type='vendor' AND sh.owner_org_id=a.vendor_id AND sa.status IN('assigned','accepted')
                  AND sh.starts_at<=now() AND sh.ends_at>now() AND sh.milestone_status<>'cancelled'))
              OR (p.native_operations->'duty'->>'mode'='ticket' AND EXISTS(
                SELECT 1 FROM tickets t WHERE t.id::text=p.native_operations->'duty'->>'ticketId'
                  AND t.vendor_id=a.vendor_id AND t.status='in_progress' AND t.lifecycle_state='on_site'
                  AND (t.field_employee_id IN(SELECT id FROM vendor_people WHERE user_id=p.user_id AND vendor_id=a.vendor_id AND is_active=true AND deleted_at IS NULL)
                    OR t.foreman_user_id=p.user_id OR t.acting_foreman_user_id=p.user_id
                    OR EXISTS(SELECT 1 FROM ticket_crew tc JOIN vendor_people vp ON vp.id=tc.employee_id WHERE tc.ticket_id=t.id AND vp.user_id=p.user_id AND tc.removed_at IS NULL AND vp.is_active=true AND vp.deleted_at IS NULL)))))
            AND EXISTS(SELECT 1 FROM location_consents c WHERE c.user_id=p.user_id AND c.device_id=a.tool_output->>'deviceId' AND c.revoked_at IS NULL
              AND (a.tool_output->'observation'->>'recordedAt')::timestamptz>=c.accepted_at-interval '30 seconds')
          ORDER BY a.vendor_id,a.target_id,(a.tool_output->'observation'->>'recordedAt')::timestamptz DESC,a.id DESC`,[candidates.map(c=>c.run.id)]);
        for (const candidate of candidates) {
          const saved = locations.rows.find(row=>row.target_id===candidate.run.id && row.vendor_id===candidate.run.companyId);
          if (!saved) continue;
          const native = saved.native_operations as NativeState | undefined;
          const expected = JSON.stringify([candidate.run.id,candidate.run.companyId,candidate.run.driverUserId,candidate.run.vehicleAssetId,candidate.run.trailerAssetId]);
          if (saved.tool_output.assignment === expected && native?.consent?.locationSharing === true && native.duty?.active === true && effectiveDuty(native.duty,clock().getTime()))
            candidate.observation = freshGateObservation(saved.tool_output.observation,candidate.run,clock());
          if (candidate.observation && !gatePhoneDirectionAvailable(candidate.observation,site)) candidate.observation=null;
        }
      }
      let details: Pick<GateArrivalDetail,"events"|"linkedVisitIds"> | undefined;
      if (runId && candidates[0]) {
        const run = candidates[0].run, ids = new Set(run.stops.filter(stop=>gateStopMatchesSite(stop,site)).map(stop=>stop.id));
        const events = await readCompleteFleetRunEvents(client,run);
        const links = await client.query("SELECT tool_output FROM assistant_action_audit WHERE target_type='fleet-gate-link' AND vendor_id=$1 AND tool_output->>'runId'=$2 ORDER BY id DESC LIMIT 201",[run.companyId,run.id]);
        details = {
          events: events.filter(event=>ids.has(String(event.details?.stopId)) && ["arrive_stop","depart_stop","gate_linked"].includes(event.type)).map(event=>({type:event.type,recordedAt:event.recordedAt})),
          linkedVisitIds: [...new Set(links.rows.filter(row=>row.tool_output.observation?.siteId===siteId).map(row=>Number(row.tool_output.visitId)))].filter(Number.isSafeInteger),
        };
      }
      await client.query("COMMIT");
      return {site,candidates,truncated:rows.rows.length>200,details};
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  };
  const read = async (session: SessionPayload,siteId:number,runId?:string) => {
    const before = await capture(session,siteId,runId);
    const selected = before.candidates.filter(c=>runId || c.observation).slice(0,50);
    const estimates = await Promise.all(selected.map(async candidate=> {
      if (!candidate.observation || !gateIncomingStop(candidate.run,before.site) || before.site.latitude===null || before.site.longitude===null) return null;
      return estimate({origin:candidate.observation,destination:{latitude:before.site.latitude,longitude:before.site.longitude}});
    }));
    // Re-read authority, run version and current consent after provider calls.
    const after = await capture(session,siteId,runId);
    const arrivals = selected.flatMap((candidate,index)=> {
      const current = after.candidates.find(c=>c.run.id===candidate.run.id);
      if (!current || (!runId && !current.observation)) return [];
      const result = projectGateRun(current,after.site), route = estimates[index];
      if (route?.ok && current.run.version===candidate.run.version && current.observation?.recordedAt===candidate.observation?.recordedAt &&
        current.observation?.latitude===candidate.observation?.latitude && current.observation?.longitude===candidate.observation?.longitude && Number.isFinite(route.durationMinutes) && route.durationMinutes>=0) {
        result.etaMinutes=route.durationMinutes; result.etaUnavailableReason=null;
      } else if (!current.observation) result.etaUnavailableReason="gate_arrivals.location_unavailable";
      return [result];
    });
    return {arrivals,after,truncated:before.truncated || before.candidates.filter(c=>c.observation).length>50};
  };
  return {
    async map(session: SessionPayload, siteId: number): Promise<{ vehicles: GateMapVehicle[]; truncated: boolean }> {
      const result = await read(session, siteId);
      const vehicles = result.arrivals.flatMap(arrival => {
        const candidate = result.after.candidates.find(row => row.run.id === arrival.runId);
        if (!candidate?.observation) return [];
        const { run, observation } = candidate;
        const origin = [...run.stops].reverse().find(stop => run.visitedStopIds.includes(stop.id));
        const speed = observation.speedMetersPerSecond;
        return [{ ...arrival, latitude: observation.latitude, longitude: observation.longitude,
          accuracyMeters: observation.accuracyMeters,
          speedMph: speed != null && observation.speedAccuracyMetersPerSecond != null && observation.speedAccuracyMetersPerSecond <= 2 ? speed * 2.2369362921 : null,
          headingDegrees: observation.headingDegrees ?? null, originName: origin?.destination?.name ?? null }];
      });
      return { vehicles, truncated: result.truncated };
    },
    async visitLinks(session:SessionPayload,siteId:number,visitId:number):Promise<{runs:GateArrivalDetail[]}> {
      const client=await database.connect();
      let ids:string[];
      try {
        await client.query("BEGIN");
        await authorize(client,session,siteId);
        const visit=await client.query("SELECT id FROM site_visits WHERE id=$1 AND site_location_id=$2",[visitId,siteId]);
        if (!visit.rows.length) throw new GateArrivalsError("gate_arrivals.visit_unavailable",404);
        const links=await client.query("SELECT DISTINCT tool_output->>'runId' AS run_id FROM assistant_action_audit WHERE target_type='fleet-gate-link' AND target_id=$1 AND (tool_output->'observation'->>'siteId')::int=$2 AND (tool_output->>'visitId')::int=$1::int LIMIT 11",[String(visitId),siteId]);
        if (links.rows.length>10) throw new GateArrivalsError("gate_arrivals.link_capacity_reached",409);
        ids=links.rows.map(row=>row.run_id);
        await client.query("COMMIT");
      } catch(error) {await client.query("ROLLBACK");throw error;}
      finally {client.release();}
      const service=createGateArrivalsService(database,authorize,estimate,clock);
      const runs:GateArrivalDetail[]=[];
      for (const id of ids) {
        try {const detail=await service.detail(session,siteId,id);if(detail.linkedVisitIds.includes(visitId))runs.push(detail);}
        catch(error) {if (!(error instanceof GateArrivalsError && error.status===404)) throw error;}
      }
      return {runs};
    },
    async list(session:SessionPayload,siteId:number):Promise<GateArrivalsResponse> {
      const result = await read(session,siteId);
      // The booth handles the final approach; the map still shows the full run.
      const arrivals = result.arrivals.filter(arrival => arrival.etaMinutes !== null && arrival.etaMinutes >= 0 && arrival.etaMinutes <= 10);
      return {arrivals,truncated:result.truncated,generatedAt:clock().toISOString()};
    },
    async detail(session:SessionPayload,siteId:number,runId:string):Promise<GateArrivalDetail> {
      const result=await read(session,siteId,runId), candidate=result.after.candidates[0], arrival=result.arrivals[0];
      if (!candidate || !arrival) throw new GateArrivalsError("gate_arrivals.run_unavailable",404);
      const run=candidate.run, stops=run.stops.filter(stop=>gateStopMatchesSite(stop,result.after.site)), ids=new Set(stops.map(stop=>stop.id));
      return {...arrival,detailScope:"selected_site",runComplete:run.status==="completed",stops:stops.map(stop=>({id:stop.id,kind:stop.kind,destinationName:stop.destination?.name??result.after.site.name,state:run.currentStopId===stop.id?"current":run.visitedStopIds.includes(stop.id)?"visited":"pending"})),
        loads:run.loads.filter(load=>ids.has(load.pickupStopId) || !!load.deliveryStopId&&ids.has(load.deliveryStopId)).map(load=>({id:load.id,commodity:load.commodity,quantity:load.quantity,unit:load.unit,deliveredAt:load.deliveryStopId&&ids.has(load.deliveryStopId)?load.deliveredAt:null})),
        events:result.after.details?.events??[],linkedVisitIds:result.after.details?.linkedVisitIds??[]};
    },
  };
}
