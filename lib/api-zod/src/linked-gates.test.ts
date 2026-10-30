import { expect, it } from "vitest";
import { CreateSiteLocationBody, ListSiteLocationsResponse } from "./generated/api";

it("keeps manually configured sites available when choosing an existing Site / Spur", () => {
  const site = {id:1,partnerId:2,name:"North Site",address:"Private road",latitude:32,longitude:-102,siteCode:"SITE-NORTH",state:"TX",isActive:true,status:"active",
    partnerName:"Partner",siteRadiusMeters:500,afe:null,photoUrl:null,taxJurisdictionPostalCode:null,taxJurisdictionCounty:null,taxJurisdictionCity:null,taxJurisdictionLabel:null,
    stateTaxRate:"0.0625",localTaxRate:"0",combinedTaxRate:"0.0625",merchandiseTaxRate:"0.0625",laborTaxRate:"0.0625",taxJurisdictionResolvedAt:null,taxProvider:"manual",createdAt:"2026-10-30T12:00:00Z",
    gateLinkId:"11111111-1111-4111-8111-111111111111",gateLinkName:"North Spur"};
  expect(ListSiteLocationsResponse.parse([site])[0]).toMatchObject({taxProvider:"manual",gateLinkId:site.gateLinkId,gateLinkName:"North Spur"});
});

it("retains the requested Site / Spur link through the generated creation contract", () => {
  const input={partnerId:2,name:"Second pad",address:"Private road",latitude:32,longitude:-102,gateLink:{targetSiteId:1}};
  expect(CreateSiteLocationBody.parse(input).gateLink).toEqual({targetSiteId:1});
});
