import { describe, it, expect } from "vitest";
import { assessSafetyReadiness } from "./safety-readiness";
describe("company safety readiness", () => {
 it("uses approved 60/40 weighting", () => { const r = assessSafetyReadiness(80, ["training","acknowledgements","credentials","drivers","inspections","correctiveActions"].map(id=>({id,completed:5,required:10,unknown:0}))); expect(r.score).toBe(62); expect(r.provisional).toBe(false); });
 it("never turns missing evidence or an empty denominator into perfect compliance",()=>{const r=assessSafetyReadiness(100,[{id:"training",completed:0,required:0,unknown:0}]);expect(r.score).toBe(40);expect(r.provisional).toBe(true);expect(r.maximumScore).toBe(100);});
 it("does not award points for uncompleted requirements",()=>{const r=assessSafetyReadiness(100,[{id:"training",completed:0,required:20,unknown:0}]);expect(r.categories[0].points).toBe(0);});
 it("includes unknown records in the denominator and potential range",()=>{const r=assessSafetyReadiness(100,[{id:"credentials",completed:2,required:4,unknown:2}]);expect(r.categories[2].points).toBe(5);expect(r.provisional).toBe(true);expect(r.categories[2].maximumPoints).toBe(10);});
});
