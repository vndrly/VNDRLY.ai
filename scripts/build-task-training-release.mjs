import fs from 'node:fs';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {LibraryDraftSchema} from '../lib/api-zod/src/work-hub-library.ts';
import {safetyTrainingContentHash} from '../artifacts/api-server/src/lib/safety-training-content-hash.ts';
import {course as originalH03} from '../research/safety-program/2026-10-31/course-review/H03-permit-to-work-simops/guided-course.mjs';
import {streamlineCourseContent,streamlineBody,legalBoundary} from './lib/streamlined-training.mjs';
const priorRoot='research/safety-program/2026-11-01',root='research/safety-program/2026-11-02';
const previousVersions=JSON.parse(fs.readFileSync('research/safety-program/regulatory-streamlining/previous-course-identities.json'));
const sourceVersion=(id,sha)=>{const previous=previousVersions.find(c=>c.id===id);return previous.sourceSha256===sha?previous.sourceVersion:`${Number.parseInt(previous.sourceVersion,10)+1}.0`;};
const identities=JSON.parse(fs.readFileSync(`${root}/preserved-course-identities.json`));
function streamlineDescription(content){if(content.description)content.description=streamlineBody(content.description.replace(/;\s*practical competence and work authorization remain separate\./i,'.'));return content;}
const prior={courses:identities.map(({contentSha256,...identity})=>{
 const raw=identity.id==='H03'?originalH03:JSON.parse(fs.readFileSync(`${priorRoot}/${identity.id.startsWith('G')?'gap-courses':'complete-courses'}/${identity.id}.json`));
 const content=LibraryDraftSchema.parse({...raw,kind:'training',title:identity.title,safetyRelated:true});
 if(identity.id!=='H03')content.training.lessons.at(-1).links=[...new Set((raw.sources??[]).map(source=>source.url))].slice(0,20);
 if(safetyTrainingContentHash(content)!==contentSha256)throw Error(`${identity.id}:preserved content changed`);
 const streamlined=LibraryDraftSchema.parse(streamlineDescription(streamlineCourseContent(content,identity.id,identity.practicalBoundary)));
 const sourceSha256=crypto.createHash('sha256').update(JSON.stringify(streamlined)).digest('hex');
 return {...identity,sourceVersion:sourceVersion(identity.id,sourceSha256),sourceSha256,content:streamlined,practicalBoundary:legalBoundary(identity.id).join('\n')};
})};
const groups=JSON.parse(fs.readFileSync(`${priorRoot}/consolidated-training-gaps.json`));
const master=JSON.parse(fs.readFileSync(`${priorRoot}/service-training-map.json`));
const additional=JSON.parse(fs.readFileSync(`${priorRoot}/additional-course-service-rules.json`));
const files=fs.readdirSync(`${root}/task-courses`).filter(f=>/^G\d{2}\.json$/.test(f)).sort();
if(files.length!==47)throw Error(`Expected47 task courses, found${files.length}`);
// Reject a bulk draft padded with repeated lesson/case prose before publication.
const authored=files.map(file=>{const c=JSON.parse(fs.readFileSync(`${root}/task-courses/${file}`));return {id:c.courseId,tokens:c.training.lessons.slice(1,9).map(l=>l.body).join(' ').toLowerCase().match(/[a-z0-9]+/g)};});
const phrases=new Map();
for(const c of authored){const seen=new Set();for(let i=0;i<=c.tokens.length-15;i++)seen.add(c.tokens.slice(i,i+15).join(' '));for(const phrase of seen)phrases.set(phrase,(phrases.get(phrase)??0)+1);}
for(const c of authored){const repeated=new Set();for(let i=0;i<=c.tokens.length-15;i++)if(phrases.get(c.tokens.slice(i,i+15).join(' '))>=3)for(let j=i;j<i+15;j++)repeated.add(j);if(repeated.size/c.tokens.length>0.2)throw Error(`${c.id}:repeated generic teaching must be replaced before publication`);}
const roleLabels=[
 'Hazmat shipper, loader or driver','Waste handling or environmental field worker','Assigned process operators, maintenance roles and site management','Licensed clinical personnel and medical interface coordinator','Food handlers, kitchen staff and camp supervisors','Laboratory analyst or sample handler','Commercial diver or subsea operating team','Remote pilot and assigned flight crew','Rail worker or rail-freight operating personnel','Radiography or radioactive-decontamination worker','Qualified electrical technicians and electrical work authority','Marine operations or vessel-side worker','Explosives/perforating specialist','Well-service or drilling crew member','Pest-control applicators and responsible supervisor','Design engineer or technical consultant',null,
 'Electrical or instrument technician','HVAC installers and service technicians','Aviation operator, flight crew and passenger-interface personnel','Inspection or NDT technician','Instrument technicians, metrology personnel and measurement reviewers','Mechanical maintenance or fabrication worker','Coating, insulation or refractory worker','Nitrogen service engineers and actual execution personnel after scope review','Lifting or mobile-equipment worker','Mechanical maintenance or fabrication worker','Pressure equipment operator or technician','Survey field crew member','Site guard, gate attendant or security worker','Facility, camp or warehouse worker','Software/helpdesk/system-administration worker','Instructor or assessor','Investigator; Assurance reviewer','Waste handling or environmental field worker','Cleaning or vacuum/hydroblasting crew member','Civil construction or groundworks worker','Authorized entrants, attendants, entry supervisors and task technicians','Height-work or scaffold crew member','Licensed clinical personnel and medical interface coordinator','Staffing coordinator and host supervisor','Research scientists, analysts and research program owner','Pigging and inline-inspection crews and process authority','Rental asset custodian or handover worker',null,'Driver or load-handling transport worker','Photographers and media personnel','Assigned first aider or responder','Fire-system installer or maintenance technician'];
const taskCourses=[],residualGroups=[];
for(let n=1;n<=49;n++){
 const group=groups.groups[n-1],id=`G${49+n}`,path=`${root}/task-courses/${id}.json`;
 const raw=roleLabels[n-1]?JSON.parse(fs.readFileSync(path)):null;
 if(raw&&raw.gapGroupId!==group.groupId)throw Error(`${id}:wrong gap group`);
 const action=classification=>group.workstreams.find(w=>w.classification===classification).action;
 const residual={groupId:group.groupId,title:group.title,courseId:raw?id:null,role:raw?(raw.audience??[]).join('; '):'Actual contracted professional or technical duty must be established',serviceIds:group.affectedServiceIds,vendorEvidenceRequired:raw?.vendorEvidenceRequired??[action('employer_method_specific_instruction'),action('unresolved_actual_scope')],practicalAssessmentRequired:[...(raw?.practicalAssessmentRequired??[action('external_credential_or_practical_evaluation')]),'The assessment record must identify the worker, assessor and assessor competence basis, actual task/equipment or method, observed criteria and results, date, limits and reassessment triggers.'],scopeConfirmation:action('unresolved_actual_scope'),sourceUrls:group.primarySourceIds.map(key=>groups.sources[key]?.url).filter(Boolean)};
 residual.vendorEvidenceRequired=[];
 residual.practicalAssessmentRequired=raw?legalBoundary(id):[];
 if(group.groupId==='TG45'){
  const scope=JSON.parse(fs.readFileSync(`${root}/task-courses/TG45-residual-scope.json`));
  if(scope.services.length!==21||scope.services.some(s=>!group.affectedServiceIds.includes(s.serviceId)))throw Error('Incomplete service-specific scope clarifications');
  residual.serviceEvidence=scope.services.map(s=>({...s,vendorEvidenceRequired:[],practicalAssessmentRequired:[]}));
 }
 residualGroups.push(residual);
 if(!raw)continue;
 const content=LibraryDraftSchema.parse(streamlineDescription(streamlineCourseContent({...raw,kind:'training',title:`${id} — ${raw.title}`,safetyRelated:true},id,raw.practicalBoundary)));
 content.training.lessons.at(-1).links=[...new Set((raw.sources??[]).map(s=>s.url))].slice(0,20);
 LibraryDraftSchema.parse(content);
 const words=raw.training.lessons.slice(1,9).map(l=>l.body).join(' ').split(/\s+/).length;
 if(words<2500||content.training.lessons.length!==10||content.training.questions.length!==26||content.training.guided?.steps.length!==10)throw Error(`${id}:incomplete teaching or assessment (${words} words)`);
 const sourceSha256=crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
 const course={id,categoryId:'competence',title:content.title,purpose:raw.purpose,practicalBoundary:legalBoundary(id).join('\n'),sourceVersion:sourceVersion(id,sourceSha256),sourceSha256,content};
 taskCourses.push(course);
 const sourceUrls=[...new Set(group.affectedServices.flatMap(s=>s.sourceUrls))];
 const reviewedFoundation=additional.courses.find(course=>course.groupId===group.groupId);
 const roleMappings=reviewedFoundation?reviewedFoundation.roleMappings.map((rule,index)=>({...rule,id:`task_${id.toLowerCase()}_${index+1}`,familyIds:[id],rationale:`Task-specific instruction and worked exercises for this confirmed duty; employer evidence and practical capability remain separate. ${rule.rationale}`})):[{id:`task_${id.toLowerCase()}`,role:roleLabels[n-1],familyIds:[id],masterServiceIds:group.affectedServiceIds,requiresExposureConfirmation:true,trigger:`Confirm the person's actual assigned task within ${group.title}. ${residual.scopeConfirmation}`,rationale:`Task-specific taught knowledge and worked exercises. Completion does not close the listed employer evidence or practical assessment.`,sourceUrls}];
 additional.courses.push({courseId:id,groupId:group.groupId,title:content.title,masterServiceIds:group.affectedServiceIds,roleMappings});
}
const courses=[...prior.courses,...taskCourses];
const h2s=JSON.parse(fs.readFileSync(`${root}/h2s-remaining-evidence.json`));
for(const r of h2s.residualRequirements){r.vendorEvidenceRequired=[];r.practicalAssessmentRequired=/respirator|rescue/i.test(r.role)?legalBoundary(/rescue/i.test(r.role)?'R02':'H15'):[];}
h2s.roleMappings.find(rule=>rule.role==='Detector calibration/repair technician').familyIds.push('G71');
const calibration=additional.courses.find(c=>c.courseId==='G71');
calibration.legacyServiceCodes=[h2s.id];
calibration.roleMappings.push({id:'task_g71_h2s_calibration',role:'Detector calibration/repair technician',familyIds:['G71'],masterServiceIds:[],legacyServiceCodes:[h2s.id],requiresExposureConfirmation:true,trigger:'Only actual detector calibration/repair duties, confirmed for this person or position. User bump checks do not establish a service-technician role.',rationale:'Calibration interpretation knowledge complements actual manufacturer/model service instruction and separately observed practical capability.',sourceUrls:h2s.sourceUrls});
const residuals={version:1,reviewDate:'2026-11-01',knowledgeCourseCount:taskCourses.length,qualificationGapsClosedByOnlineCompletion:0,groups:residualGroups,extensions:[h2s]};
fs.writeFileSync(`${root}/remaining-evidence-register.json`,JSON.stringify(residuals,null,2));
fs.writeFileSync(`${root}/additional-course-service-rules.json`,JSON.stringify(additional,null,2));
fs.writeFileSync(`${root}/prepared-course-publication.json`,JSON.stringify({version:1,courses},null,2));
const data={catalog:master,legacy:JSON.parse(fs.readFileSync(`${priorRoot}/legacy-service-training-crosswalk.json`)),common:JSON.parse(fs.readFileSync(`${priorRoot}/common-training-role-rules.json`)),additional,residuals,curriculum:courses.map(({content,...c})=>({...c,contentSha256:safetyTrainingContentHash(content)}))};
// Previous gap labels are research findings, not an authority to impose extra
// qualification requirements. Current legal role duties are in residuals.
for(const service of data.catalog.services)service.gapTopicIds=[];
function simplifyScope(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(['rationale','scopeConfirmation','trigger'].includes(key)&&typeof item==='string')value[key]=streamlineBody(item)||'Apply this training only to the actual assigned work.';else if(key==='scopeNotes'&&Array.isArray(item))value[key]=item.map(x=>streamlineBody(x)).filter(Boolean);else simplifyScope(item);}}
simplifyScope(data.catalog);simplifyScope(data.legacy);simplifyScope(data.common);simplifyScope(data.additional);simplifyScope(data.residuals);
fs.writeFileSync('artifacts/api-server/src/data/safety-training-catalog.ts',`// Generated from source-linked original VNDRLY training and explicit residual evidence.\nimport {gunzipSync}from'node:zlib';\nexport const safetyTrainingCatalog: unknown = JSON.parse(gunzipSync(Buffer.from(${JSON.stringify(gzipSync(Buffer.from(JSON.stringify(data))).toString('base64'))},'base64')).toString('utf8'));\n`);
console.log(JSON.stringify({priorCourses:69,newTaskCourses:taskCourses.length,totalCourses:courses.length,residualGroups:residualGroups.length,services:master.services.length,practicalGapsFalselyClosed:0}));
// The separately assessed flagship adds its own immutable identity after this baseline.
await import('./build-energy-safety-core.mjs');
