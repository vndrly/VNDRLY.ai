import {describe,it,expect} from 'vitest';
import {LibraryDraftSchema,type LibraryMetadata} from '@workspace/api-zod';
import {safetyTrainingContentHash} from '../lib/safety-training-content-hash';
import {isCanonicalEnergySafetyCourse} from './certification-issuer';
const content=LibraryDraftSchema.parse({kind:'training',title:'Canonical Core',training:{completionMode:'checkoff',lessons:[{id:'l',title:'Lesson',body:'Canonical lesson'}],certificationExam:{questions:[{id:'q',domainId:'domain',prompt:'Choose',options:[{id:'a',label:'Safe'},{id:'b',label:'Unsafe'}],correctOptionIds:['a'],explanation:'Rationale'}],questionCount:1,passingPercent:80}}});
const metadata={content,safetyResource:{familyId:'G99',sourceSha256:'a'.repeat(64)}} as LibraryMetadata;
const registry=[{id:'G99',sourceSha256:'a'.repeat(64),contentSha256:safetyTrainingContentHash(content)}];
describe('trusted Energy Safety Core issuer',()=>{
 it('accepts canonical normalized content and tolerates JSON object key ordering',()=>{
 expect(isCanonicalEnergySafetyCourse(metadata,registry)).toBe(true);
 const reordered={...metadata,content:Object.fromEntries(Object.entries(content).reverse())} as LibraryMetadata;
 expect(isCanonicalEnergySafetyCourse(reordered,registry)).toBe(true);
 });
 it.each(['lesson','answer','prompt','threshold','title'])('rejects changed %s despite copied family/source labels',field=>{
 const altered=structuredClone(metadata),training=altered.content!.training!;
 if(field==='lesson')training.lessons[0].body+=' altered';
 if(field==='answer')training.certificationExam!.questions[0].correctOptionIds=['b'];
 if(field==='prompt')training.certificationExam!.questions[0].prompt+=' altered';
 if(field==='threshold')training.certificationExam!.passingPercent=1;
 if(field==='title')altered.content!.title='Company edited copy';
 expect(isCanonicalEnergySafetyCourse(altered,registry)).toBe(false);
 });
 it('requires a registered canonical source and valid content',()=>{
 expect(isCanonicalEnergySafetyCourse(metadata,[])).toBe(false);
 expect(isCanonicalEnergySafetyCourse({...metadata,safetyResource:{...metadata.safetyResource!,sourceSha256:'b'.repeat(64)}},registry)).toBe(false);
 expect(isCanonicalEnergySafetyCourse({...metadata,content:null},registry)).toBe(false);
 });
});
