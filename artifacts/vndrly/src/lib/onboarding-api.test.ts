import {afterEach,describe,expect,it,vi} from 'vitest';
import {onboardingApi} from './onboarding-api';
afterEach(()=>vi.unstubAllGlobals());
describe('onboarding completion errors',()=>{it('retains actionable missing fields while preserving server validation failure',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:400,json:async()=>({error:'Required fields missing',code:'onboarding.required_fields_missing',missing:['taxIds.stateTaxId','firstEmployee.email']})}));await expect(onboardingApi.complete('vendor',609)).rejects.toMatchObject({message:'Required fields missing: Tax IDs: state tax ID; First employee: email',status:400,code:'onboarding.required_fields_missing',missing:['taxIds.stateTaxId','firstEmployee.email']});});});
