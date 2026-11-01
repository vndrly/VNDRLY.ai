import {it,expect} from 'vitest';
import {trainingPositionIds} from './safety-training-position';
it('separates company admin, office and gate account types from job titles',()=>{
 const ids=trainingPositionIds({vendorRole:'office',roles:[],jobTitle:'Accountant',membershipRole:'admin'},[]);
 expect(ids).toContain('account:admin');expect(ids).toContain('account:office_staff');expect(ids).not.toContain('account:gatekeeper');
});
it('keeps gate supervisors distinct from gatekeepers',()=>{
 expect(trainingPositionIds({vendorRole:'gate_supervisor',roles:['gatekeeper'],jobTitle:null},[])).toContain('account:gate_supervisor');
 expect(trainingPositionIds({vendorRole:'gate_supervisor',roles:['gatekeeper'],jobTitle:null},[])).not.toContain('account:gatekeeper');
 expect(trainingPositionIds({vendorRole:'gatekeeper',roles:[],jobTitle:null},[])).toContain('account:gatekeeper');
});