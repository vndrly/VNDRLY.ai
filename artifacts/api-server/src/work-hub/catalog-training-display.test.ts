import {it,expect} from 'vitest';
import {catalogTrainingDisplay,combinedTrainingDisplay} from './catalog-training-display';
const gate={id:'VUC116-C01',title:'Site Security — Gatekeeper',percent:100,sources:['VUC116-GATEKEEPING'],benchmarks:[]};
it('shows Gatekeeping and explicitly assigned certifications while counting the shared course once',()=>{
 const state={programs:[{id:'VUC116-GATEKEEPING',title:'Gatekeeping',parentProgramId:'VUC116',complete:true,courses:[gate]},{id:'VUC116',title:'Site Security',complete:false,courses:[gate,{...gate,id:'VUC116-C02',percent:0}]}],courses:[gate,{...gate,id:'extra',title:'Explicit extra',percent:0}]} as any;
 const summary=combinedTrainingDisplay([],state,7);
 expect(summary.displayGroups.map(g=>g.title)).toEqual(['Certifications','Standalone Courses']);
 expect(summary.displayGroups[0].items.map(i=>i.title)).toEqual(['Gatekeeping','Site Security']);
 expect(summary.overallTotal).toBe(5);expect(summary.overallCompleted).toBe(1);
 expect(summary.completedCertifications.map(c=>c.title)).toEqual(['Gatekeeping']);
 expect(catalogTrainingDisplay(state,7)[0].steps[0].href).toBe('/work-hub/course/VUC116-C01');
});
