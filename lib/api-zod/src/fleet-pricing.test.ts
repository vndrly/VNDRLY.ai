import {expect, it } from "vitest";
import {FleetQuantityReviewSelectionSchema} from "./fleet-pricing";
import * as contracts from "./index";
import type { ZodType } from "zod/v4";

function schema(name: string): ZodType {
  const value = (contracts as unknown as Record<string, ZodType>)[name];
  expect(value, name).toBeDefined();
  return value;
}
it("keeps an office quantity endorsement distinct from independent instrument verification", () => {
  const id = "11111111-1111-4111-8111-111111111111", at = "2026-10-16T18:00:00Z";
  const review = { version: 2, revision: 1, operationId: id, vendorId: 11, evidenceId: id,
    reportOperationId: id, reportFingerprint: "a".repeat(64), activityId: id, originalActivityVersion: 1,
    ticketId: 123, decision: "accept_as_billable", reason: "Office checked retained report",
    reviewedByUserId: 7, reviewedAt: at, reportedReviewAt: at, reportedReviewTimeZone: "America/Chicago",
    quantity: { id, cycleId: null, kind: "billable", quantity: "123.456789", unit: "barrel", source: "manual", evidenceReferences: [], capturedAt: at, recordedByUserId: 8 },
    independentInstrumentVerification: false,
  };
  const contract = schema("FleetQuantityReviewSchema");
  expect(contract.safeParse(review).success).toBe(true);
  for (const bad of [{ ...review, independentInstrumentVerification: true }, { ...review, quantity: null },
    { ...review, decision: "reject" }, { ...review, quantity: { ...review.quantity, id: "22222222-2222-4222-8222-222222222222" } }])
    expect(contract.safeParse(bad).success).toBe(false);
  expect(contract.safeParse({ ...review, decision: "reject", quantity: null }).success).toBe(true);
});
it("preserves exact prices as strings and rejects excess precision or floating wire prices", () => {
  const decimal = schema("FleetExactDecimalSchema");
  expect(decimal.safeParse("0.000125").success).toBe(true);
  expect(decimal.safeParse(0.000125).success).toBe(false);
  expect(decimal.safeParse("0.0000000001").success).toBe(false);
  expect(decimal.safeParse("1000000000000000").success).toBe(false);
});
it("records unpriced work explicitly instead of silently pricing it at zero", () => {
  const pricing = schema("FleetPricingIntentSchema");
  expect(pricing.safeParse({ mode: "unpriced", reason: "offline_reference_missing", serviceId: 7, approvalRef: null }).success).toBe(true);
  expect(pricing.safeParse({ mode: "unpriced", reason: "offline_reference_missing", serviceId: 7, approvalRef: null, rate: "0" }).success).toBe(false);
});
it("supports explicit delivered, accepted and billable quantities without implicit conversion", () => {
  expect(schema("FleetQuantityEvidenceSchema").safeParse({ id: "11111111-1111-4111-8111-111111111111", cycleId: null, kind: "delivered", quantity: "123.456789", unit: "barrel", source: "meter", evidenceReferences: [], capturedAt: "2026-10-16T12:00:00Z", recordedByUserId: 42 }).success).toBe(true);
});
it("keeps per-activity billing separate from the ticket and refuses unpriced financial approval",()=>{
  const value={version:2,revision:1,ticketId:100,ticketRevisionAtBinding:2,context:{vendorId:7,partnerId:8,billingSiteId:9,afeNumber:"SYNTHETIC",workDate:"2026-10-16",currency:"USD"},serviceId:3,pricing:{mode:"unpriced",reason:"approval_required",serviceId:3,approvalRef:null},review:{status:"pending",reason:null}};
  const runBilling=schema("FleetRunBillingV2Schema");
  expect(runBilling.parse(value)).toEqual(value);
  expect(runBilling.safeParse({...value,review:{status:"reviewed",operationId:"11111111-1111-4111-8111-111111111111",reviewedByUserId:4,reviewedAt:"2026-10-17T00:00:00Z",chargeRevision:1}}).success).toBe(false);
  expect(runBilling.safeParse({...value,pricing:{...value.pricing,serviceId:99}}).success).toBe(false);
  expect(runBilling.safeParse({...value,context:{...value.context,rate:"0"}}).success).toBe(false);
});
it("preserves v2 run billing only on its actual parent and refuses mixing financial writers",()=>{
  const billingV2={version:2,revision:1,ticketId:100,ticketRevisionAtBinding:1,context:{vendorId:7,partnerId:8,billingSiteId:9,afeNumber:"SYNTHETIC",workDate:"2026-10-16",currency:"USD"},serviceId:3,pricing:{mode:"unpriced",reason:"approval_required",serviceId:3,approvalRef:null},review:{status:"pending",reason:null}};
  const value={id:"11111111-1111-4111-8111-111111111111",companyId:7,fleetId:"22222222-2222-4222-8222-222222222222",title:"Synthetic",driverUserId:42,vehicleAssetId:"33333333-3333-4333-8333-333333333333",trailerAssetId:null,siteIds:[9],status:"draft",phase:null,version:1,stops:[{id:"44444444-4444-4444-8444-444444444444",siteId:9,kind:"pickup",sequence:0}],loads:[],inspections:[],currentStopId:null,visitedStopIds:[],events:[],linkedTicketId:100,allowedActions:[],billingV2};
  const run=schema("FleetRunSchema");
  expect(run.parse(value)).toHaveProperty("billingV2",billingV2);
  expect(run.safeParse({...value,linkedTicketId:101}).success).toBe(false);
  expect(run.safeParse({...value,billing:{afeNumber:"SYNTHETIC",workDate:"2026-10-16"}}).success).toBe(false);
});
it("requires an explicit billing protocol marker because legacy plan version is an edit counter",()=>{
  const value={version:2,revision:1,vendorId:7,partnerId:8,billingSiteId:9,afeNumber:"SYNTHETIC",workDate:"2026-10-16",currency:"USD",batchingAllowed:true,serviceIds:[3],reviewedChargeIds:[],finalizedAt:null,finalizationOperationId:null};
  const ticket=schema("FleetTicketBillingV2Schema");
  expect(ticket.safeParse(value).success).toBe(false);
  expect(ticket.safeParse({...value,billingVersion:2}).success).toBe(true);
});

it("requires an explicit positive reviewed conversion factor, divisor and rounding",()=>{
 expect(FleetQuantityReviewSelectionSchema.safeParse({evidenceId:"11111111-1111-4111-8111-111111111111",expectedReviewRevision:0,decision:"accept_as_billable",reason:"42 US gallons per barrel",conversion:{unit:"barrel",factor:"1",divisor:"42",rounding:"half_away_from_zero"}}).success).toBe(true);
 expect(FleetQuantityReviewSelectionSchema.safeParse({evidenceId:"11111111-1111-4111-8111-111111111111",expectedReviewRevision:0,decision:"accept_as_billable",reason:"bad",conversion:{unit:"barrel",factor:"1",divisor:"0",rounding:"half_away_from_zero"}}).success).toBe(false);
});
