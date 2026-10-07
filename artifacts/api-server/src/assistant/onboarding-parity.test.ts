import {describe,it,expect} from 'vitest';
import {validateStepCompletion,buildHappyPayload} from './onboarding-validation';
import {getStepSpec,renderStepGuidance} from './prompts/onboarding-flows';
describe('onboarding wizard parity',()=>{
 it('collects required field role and saved certification observations',()=>{expect(getStepSpec('field_employee','personal-info')?.fields.map(f=>f.path)).toContain('info.vendorRole');expect(getStepSpec('field_employee','photo-certs')?.fields.map(f=>f.path)).toEqual(expect.arrayContaining(['pec.certified','pec.expirationDate']));});
 it('refuses missing role, certification false and missing expiry before marking steps complete',()=>{
 for(const [step,nextStep,payload] of [['personal-info','photo-certs',{info:{firstName:'Fictional',lastName:'Reviewer',phone:'555'}}],['photo-certs','set-password',{photoUrl:'saved-private-url',pec:{certified:false,expirationDate:'2027-01-01'}}],['photo-certs','set-password',{photoUrl:'saved-private-url',pec:{certified:true}}]] as const){expect(validateStepCompletion({persona:'field_employee',step,nextStep,existing:{currentStep:step,payload}}).ok).toBe(false)}
 expect(validateStepCompletion({persona:'field_employee',step:'photo-certs',nextStep:'set-password',existing:{currentStep:'photo-certs',payload:{photoUrl:'saved-private-url',pec:{certified:true,expirationDate:'2027-01-01'}}}}).ok).toBe(true);
 });
 it('supports wizard deferral without treating empty sections as completed',()=>{
 for(const [persona,step,nextStep] of [['partner','first-site','tax-billing'],['partner','tax-billing','preferences'],['vendor','tax-ids','work-types'],['vendor','work-types','first-employee'],['vendor','first-employee','first-employee']] as const){expect(validateStepCompletion({persona,step,nextStep,skipped:true,existing:{currentStep:step,payload:{}}})).toEqual({ok:true});expect(validateStepCompletion({persona,step,nextStep,skipped:false,existing:{currentStep:step,payload:{}}}).ok).toBe(false);expect(renderStepGuidance(persona,step)).toContain('defer');}
 expect(validateStepCompletion({persona:'vendor',step:'first-employee',nextStep:'done',skipped:true,existing:{currentStep:'first-employee',payload:{}}}).ok).toBe(false);
 for(const persona of ['partner','vendor'] as const)expect(validateStepCompletion({persona,step:'legal-consent',nextStep:'branding',skipped:true,existing:{currentStep:'legal-consent',payload:{}}}).ok).toBe(false);
 });
});
