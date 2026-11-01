import {it,expect} from 'vitest';
import {requiredTrainingCoverage} from './safety-training-requirements';
const course={familyId:'H13',itemId:'trusted',contentVersion:3,sourceSha256:'platform-hash',available:true};
const person={userId:1,membershipId:11,active:true,roleIds:['monitor']};
const completion={userId:1,membershipId:11,itemId:'trusted',contentVersion:3,sourceSha256:'platform-hash',status:'completed',refresherDueAt:null};
const base={selectedServiceIds:['h2s','other-gas'],rules:[{serviceId:'h2s',roleIds:['monitor'],familyIds:['H13']},{serviceId:'other-gas',roleIds:['monitor'],familyIds:['H13']}],people:[person],curriculum:[course],completions:[completion],now:new Date('2026-11-01T00:00:00Z')};
it('deduplicates a required person/course across selected services',()=>{
 const result=requiredTrainingCoverage(base);expect(result).toMatchObject({required:1,completed:1,provisional:false});expect(result.requirements[0].serviceIds).toEqual(['h2s','other-gas']);
});
it('keeps vendor extras and unrelated completions out of both numerator and denominator',()=>{
 const result=requiredTrainingCoverage({...base,completions:[{...completion,itemId:'vendor-extra',sourceSha256:'vendor-hash'}]});expect(result).toMatchObject({required:1,completed:0});
});
it('recomputes role changes and new hires while retaining the same trusted completion evidence',()=>{
 expect(requiredTrainingCoverage({...base,people:[{...person,roleIds:['office']}]})).toMatchObject({required:0,completed:0});
 const newHire={...person,userId:2,membershipId:12};expect(requiredTrainingCoverage({...base,people:[person,newHire]})).toMatchObject({required:2,completed:1});
});
it('does not credit another membership, old version, changed curriculum or expired completion',()=>{
 for(const bad of [{...completion,membershipId:99},{...completion,contentVersion:2},{...completion,sourceSha256:'changed'},{...completion,refresherDueAt:'2026-10-31T00:00:00Z'}])expect(requiredTrainingCoverage({...base,completions:[bad]}).completed).toBe(0);
});
it('keeps an unpublished required course outstanding and marks unknown service/role coverage provisional',()=>{
 const result=requiredTrainingCoverage({...base,selectedServiceIds:['h2s','unmapped'],curriculum:[{...course,available:false}],people:[person,{...person,userId:2,membershipId:12,roleIds:[]}]});
 expect(result).toMatchObject({required:1,completed:0,unavailable:1,unmappedServiceIds:['unmapped'],unclassifiedMembershipIds:[12],provisional:true});
});
it('removes inactive memberships from the baseline',()=>expect(requiredTrainingCoverage({...base,people:[{...person,active:false}]})).toMatchObject({required:0,completed:0}));
it('applies company common training once without imposing a field role on office staff',()=>{
 const result=requiredTrainingCoverage({...base,people:[{...person,roleIds:['office']}],rules:[...base.rules,{serviceId:'*',roleIds:['*'],familyIds:['C02']}],curriculum:[course,{...course,familyId:'C02',itemId:'induction'}]});
 expect(result.required).toBe(1);expect(result.requirements[0].familyId).toBe('C02');
 expect(requiredTrainingCoverage({...base,selectedServiceIds:[]})).toMatchObject({serviceScopeMissing:true,provisional:true});
});
