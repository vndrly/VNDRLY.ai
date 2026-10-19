import {expect,it} from "vitest";
import {evaluateFleetTriggers,currentFleetPositions,fleetCurrentPhoneSpeed} from "./fleet-monitoring";
it("fires only sourced conditions outside the saved cooldown without inventing unavailable ETA",()=>{
 const rule={id:"r",version:1,kind:"stale_position" as const,thresholdMinutes:5,cooldownMinutes:30,enabled:true,fleetId:"g",recipientUserIds:[1]},now="2026-10-17T20:00:00Z",run={id:"run",fleetId:"g",siteIds:[9],status:"in_progress",currentStopId:null,dispatchedAt:null,acknowledgedAt:null,stopArrivedAt:null,positionAt:"2026-10-17T19:00:00Z",etaAt:null,plannedArrivalAt:null,credentialDueAt:null};
 expect(evaluateFleetTriggers({runs:[run],previous:[]},[rule],now)).toHaveLength(1);
 expect(evaluateFleetTriggers({runs:[run],previous:[{ruleId:"r",runId:"run",at:now}]},[rule],now)).toHaveLength(0);
 expect(evaluateFleetTriggers({runs:[run],previous:[]},[{...rule,kind:"late_eta"}],now)).toEqual([]);
});
it("keeps one newest sourced marker per vehicle and hides stale or unqualified speed",()=>{
 const point:any={runId:"old",vehicleAssetId:"truck",recordedAt:"2026-10-17T19:00:00Z",freshness:"stale",speedMetersPerSecond:10,speedAccuracyMetersPerSecond:1};
 expect(currentFleetPositions([point,{...point,runId:"current",recordedAt:"2026-10-17T20:00:00Z",freshness:"recent"}]).map(row=>row.runId)).toEqual(["current"]);
 expect(fleetCurrentPhoneSpeed(point)).toBeNull();expect(fleetCurrentPhoneSpeed({...point,freshness:"recent"})).toBe(10);expect(fleetCurrentPhoneSpeed({...point,freshness:"recent",speedAccuracyMetersPerSecond:null})).toBeNull();
});
