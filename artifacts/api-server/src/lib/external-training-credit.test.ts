import {it,expect} from 'vitest';
import {acceptedExternalTraining,certificateEvidenceFingerprint,type ExternalCertificate} from './external-training-credit';
import {requiredTrainingCoverage} from './safety-training-requirements';
import {applySafetyTrainingScore} from './safety-training-score';
const cert:ExternalCertificate={id:12,name:'PEC H2S Clear',issuer:'Veriforce',certNumber:'SYNTHETIC-12',issuedDate:'2026-01-01',expirationDate:'2026-12-31',documentUrl:null,documentPath:null,vendorVerifiedAt:new Date('2026-01-02')};
const reviewed={...cert,trainingCredit:{version:1,reviewedAt:'2026-01-02T00:00:00Z',reviewedByUserId:5,reviewNote:'Synthetic syllabus and issuer verification reviewed.',evidenceFingerprint:certificateEvidenceFingerprint(cert),families:[{familyId:'H13',sourceSha256:'current'}]}};
const now=new Date('2026-11-13T00:00:00Z');
const base={selectedServiceIds:['h2s'],rules:[{serviceId:'h2s',roleIds:['monitor'],familyIds:['H13']}],people:[{userId:1,membershipId:11,active:true,roleIds:['monitor']}],curriculum:[{familyId:'H13',itemId:'course',sourceSha256:'current',contentVersion:1,available:true}],completions:[],now};
const evidence=()=>acceptedExternalTraining(reviewed,'2026-11-13').map(c=>({...c,userId:1,membershipId:11}));
it('allows optional issue dates and issuer-defined non-expiring credentials only after review',()=>{
 const optional={...cert,issuedDate:null};
 expect(acceptedExternalTraining({...optional,trainingCredit:{...reviewed.trainingCredit,evidenceFingerprint:certificateEvidenceFingerprint(optional)}},'2026-11-13')).toHaveLength(1);
 const permanent={...optional,name:'OSHA Outreach 10-Hour General Industry',expirationDate:null};
 expect(acceptedExternalTraining({...permanent,trainingCredit:{...reviewed.trainingCredit,evidenceFingerprint:certificateEvidenceFingerprint(permanent)}},'2026-11-13')).toHaveLength(1);
 expect(acceptedExternalTraining({...reviewed,expirationDate:null},'2026-11-13')).toEqual([]);
 expect(acceptedExternalTraining({...reviewed,qualificationDetails:{scope:'changed'}},'2026-11-13')).toEqual([]);
});
it('credits reviewed outside H2S and internal H2S identically without double counting',()=>{
 const completion={userId:1,membershipId:11,itemId:'course',sourceSha256:'current',contentVersion:1,status:'completed',refresherDueAt:null};
 for(const input of [{...base,externalCompletions:evidence()},{...base,completions:[completion]},{...base,completions:[completion],externalCompletions:evidence()}])expect(requiredTrainingCoverage(input)).toMatchObject({required:1,completed:1});
});
it('requires explicit topic review, not a PEC label or verification checkbox alone',()=>{
 expect(acceptedExternalTraining(cert,'2026-11-13')).toEqual([]);
 expect(requiredTrainingCoverage({...base,rules:[{serviceId:'h2s',roleIds:['monitor'],familyIds:['H13','H15','R02']}],externalCompletions:evidence()})).toMatchObject({required:3,completed:1});
});
it('rejects expired, revoked, changed, future-issued and unverified certificates',()=>{
 for(const patch of [{expirationDate:'2026-11-12'},{vendorVerifiedAt:null},{deletedAt:new Date()},{certNumber:'changed'},{issuedDate:'2027-01-01'},{issuer:null}])expect(acceptedExternalTraining({...reviewed,...patch},'2026-11-13')).toEqual([]);
 expect(acceptedExternalTraining(reviewed,'2026-12-31')).toHaveLength(1);
 expect(acceptedExternalTraining(reviewed,'2027-01-01')).toEqual([]);
});
it('does not transfer credit across people, memberships, or revised requirements',()=>{
 for(const patch of [{userId:2},{membershipId:12},{sourceSha256:'old'}])expect(requiredTrainingCoverage({...base,externalCompletions:evidence().map(c=>({...c,...patch}))}).completed).toBe(0);
});
it('puts training in its existing 10-point component, not the whole safety score',()=>{
 const assessment={score:0,categories:[{id:'competence',points:0},{id:'hazards',points:0}]};
 expect(applySafetyTrainingScore(assessment,{required:2,completed:1,provisional:false}).score).toBe(5);
 expect(applySafetyTrainingScore({...assessment,categories:[{id:'competence',points:15}]},{required:1,completed:1,provisional:false}).score).toBe(15);
 expect(applySafetyTrainingScore(assessment,{required:0,completed:0,provisional:true}).score).toBe(0);
});
