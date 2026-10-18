import {it,expect} from "vitest";
import {resolveEffectiveFinancialLine,sumEffectiveFinancialLines,projectEffectiveInvoiceLine} from "./effective-financial-line";
it("keeps reviewed precise quantities/rates and authoritative currency amounts across every consumer",()=>{
 const metadata={version:2,charge:{id:"11111111-1111-4111-8111-111111111111",revision:1,quantity:"123.456789",unitRate:"0.000125",exactAmount:"0.015432098625",currencyAmount:"0.02",currency:"USD",reviewedByUserId:7,reviewedAt:"2026-10-17T18:00:00Z"}};
 const line={quantity:"123.46",unitPrice:"0.00",preciseQuantity:"123.456789000",preciseUnitPrice:"0.000125000",fleetBillingMetadata:metadata};
 expect(resolveEffectiveFinancialLine(line)).toMatchObject({version:2,quantity:"123.456789",unitPrice:"0.000125",exactAmount:"0.015432098625",currencyAmount:"0.02",chargeId:metadata.charge.id});
 expect(sumEffectiveFinancialLines([line,line])).toMatchObject({currency:"USD",currencyAmount:"0.04"});
 expect(()=>resolveEffectiveFinancialLine({...line,fleetBillingMetadata:{...metadata,charge:{...metadata.charge,reviewedByUserId:null}}})).toThrow();
 expect(()=>resolveEffectiveFinancialLine({...line,preciseUnitPrice:"99"})).toThrow();
 expect(resolveEffectiveFinancialLine({quantity:"3.00",unitPrice:"2.50"})).toMatchObject({version:1,currencyAmount:"7.5"});
});
it("restores exact invoice tax provenance and rejects a changed tax calculation",()=>{
 const metadata={version:2,charge:{id:"11111111-1111-4111-8111-111111111111",revision:1,quantity:"1",unitRate:"98.46",exactAmount:"98.46",currencyAmount:"98.46",currency:"USD",reviewedByUserId:7,reviewedAt:"2026-10-17T18:00:00Z"},invoiceTax:{version:1,rate:"0.08875",basis:"98.46",amount:"8.74",rounding:"per_line_half_away_from_zero"}};
 const line={quantity:"1",unitPrice:"98.46",taxRate:"0.0888",taxAmount:"8.74",fleetBillingMetadata:metadata};
 expect(projectEffectiveInvoiceLine(line)).toMatchObject({taxRate:"0.08875",taxAmount:"8.74"});
 expect(()=>projectEffectiveInvoiceLine({...line,taxAmount:"8.73"})).toThrow("mismatch");
 expect(()=>projectEffectiveInvoiceLine({...line,fleetBillingMetadata:{...metadata,invoiceTax:{...metadata.invoiceTax,basis:"100"}}})).toThrow();
});
