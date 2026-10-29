import { expect, it, vi } from "vitest";
import { createMemoryGateReportDependencies, generateGateReport, parseGateReportFilters } from "./gate-reports";
const filters = {siteId: 10, siteIds: [10,20], range: "30d" as const, recordType: "all" as const};
function setup() {
 const deps = createMemoryGateReportDependencies({access:new Map([[1,{kind:"full_site"}]])});
 deps.queryRows = vi.fn(async f => [{id:`note-${f.siteId}`, notes:`Note at site ${f.siteId}`}]);
 deps.resolveContext = async f => ({siteName:`Site ${f.siteId}`,stationName:"Main Gate"});
 return deps;
}
it.each(["pdf","excel","word"] as const)("combines all authorized sites in one %s report",async format=>{
 const deps=setup(); const result=await generateGateReport({userId:1,reportKind:"shift_notes",format,filters},deps);
 expect(result.body.length).toBeGreaterThan(100);
 expect(deps.queryRows).toHaveBeenCalledTimes(2);
 expect((deps.queryRows as any).mock.calls.map(([f]:any[])=>f)).toEqual([{siteId:10,range:"30d",recordType:"all"},{siteId:20,range:"30d",recordType:"all"}]);
});
it("denies all-site export before reading notes if one site is unauthorized",async()=>{
 const deps=setup(); deps.resolveAccess=async(_user,f)=>f.siteId===10?{kind:"full_site"}:null;
 await expect(generateGateReport({userId:1,reportKind:"shift_notes",format:"pdf",filters},deps)).rejects.toMatchObject({status:403});
 expect(deps.queryRows).not.toHaveBeenCalled();
});
it("limits combined exports to full 30-day shift notes and validates site IDs",async()=>{
 expect(()=>parseGateReportFilters({...filters,siteIds:[20]})).toThrow();
 await expect(generateGateReport({userId:1,reportKind:"history",format:"pdf",filters},setup())).rejects.toThrow();
});
