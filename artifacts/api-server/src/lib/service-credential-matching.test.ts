import {describe,it,expect} from 'vitest';
import {assessServiceCredentials} from './service-credential-matching';
describe('advisory service credentials',()=>{
 it('keeps missing and expired records assignable',()=>{
 expect(assessServiceCredentials(['PEC','H2S'],[{name:'PEC',expirationDate:'2026-01-01'}],'2026-11-12')).toEqual({status:'needs_review',required:['PEC','H2S'],missing:['H2S'],expired:['PEC'],assignmentAllowed:true});
 });
 it('accepts a renewed copy and normalizes names without equating different credentials',()=>{
 expect(assessServiceCredentials(['H2S Awareness'],[{name:'h2s-awareness',expirationDate:null}], '2026-11-12').status).toBe('recorded_match');
 expect(assessServiceCredentials(['H2S Clear'],[{name:'H2S Awareness',expirationDate:null}]).missing).toEqual(['H2S Clear']);
 });
 it('does not claim qualification when requirements are not configured',()=>{expect(assessServiceCredentials([],[]).status).toBe('not_configured');});
});
