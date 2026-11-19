import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {siteSecurity} from '../research/safety-program/online-instruction/site-security.mjs';
import {siteSecurityAssessment} from '../research/safety-program/online-instruction/site-security-assessment.mjs';
const source=JSON.parse(readFileSync('research/safety-program/energy-safety-core/course.json','utf8')).content.training;
const catalog=JSON.parse(readFileSync('research/safety-program/certifications-115/catalog-publication.json','utf8'));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const courses=[];
for(const lesson of source.lessons.filter(l=>/^ESC\d\d$/.test(l.id))){
 const course=catalog.courses.find(c=>c.id.startsWith('VUC001-')&&c.title.endsWith(`| ${lesson.title}`));
 assert(course,`Canonical course missing: ${lesson.id}`);
 // Preserve complete authored instruction. Split at paragraph boundaries, never
 // in a procedure or sentence. The estimate is guidance, not a completion timer.
 const paragraphs=lesson.body.split('\n\n');
 let best=1,distance=Infinity;
 const total=lesson.body.split(/\s+/).length;
 for(let i=1;i<paragraphs.length;i++){
  const delta=Math.abs(paragraphs.slice(0,i).join('\n\n').split(/\s+/).length-total/2);
  if(delta<distance){distance=delta;best=i;}
 }
 const bodies=[paragraphs.slice(0,best).join('\n\n'),paragraphs.slice(best).join('\n\n')];
 assert.equal(bodies.join('\n\n'),lesson.body,'Instruction must not be omitted');
 const step=source.guided.steps.find(s=>s.lessonId===lesson.id);
 const checks=step.questionIds.map(id=>{
  const q=source.questions.find(q=>q.id===id);
  assert(q&&!q.multiple&&q.correctOptionIds.length===1);
  const answer=q.options.findIndex(o=>o.id===q.correctOptionIds[0]);
  assert(answer>=0&&source.guided.explanations[id]);
  return {id:q.id,prompt:q.prompt,options:q.options.map(o=>o.label),answer,feedback:source.guided.explanations[id]};
 });
 const objectives=lesson.body.match(/^[-] .+$/gm)?.map(s=>s.slice(2)).join(' ')??lesson.title;
 const sessions=bodies.map((instruction,i)=>({id:`${lesson.id}-${i+1}`,title:i===0?lesson.title:'Application and retention',
  minutes:Math.ceil(instruction.split(/\s+/).length/180+(i===1?checks.length*0.5:0.5)),
  objective:objectives,instruction,checks:i===1?checks:[]}));
 if(lesson.id==='ESC01')sessions[1].practice={
  prompt:'You are taking over a gate shift. A maintenance tag is visible, the delivery lane is partly barricaded, and a driver asks to enter. The outgoing worker says everything is normal. Write the radio message you would use from your safe position. Include the uncertainty and the action you need confirmed.',
  modelResponse:'Coordinator, this is the gate handover at the delivery lane. A maintenance tag and partial barricade are present, but I have not confirmed the active work boundary or the permitted route. The arriving truck is waiting at the designated safe point. Please have the responsible lead confirm the boundary and the authorized delivery route before entry.',
  rationale:'Compare your message with four elements: location, observed facts, unresolved information and a safe next action. A different wording is fine. Do not claim that the equipment is isolated, that the route is clear, or that entry is approved without confirmation. This exercise records communication practice; it does not issue a real access permission.',
 };
 courses.push({id:course.id,title:lesson.title,version:digest(sessions),sessions});
}
assert.equal(courses.length,10);
assert.equal(courses.flatMap(c=>c.sessions.flatMap(s=>s.checks)).length,source.guided.steps.filter(s=>/^ESC\d\d$/.test(s.lessonId)).reduce((n,s)=>n+s.questionIds.length,0));
// Site Security is included in the local catalog with the approved assessment
// rules. End-to-end acceptance and publication are tracked separately.
const securitySessions=siteSecurity.sections.flatMap(s=>s.sessions);
for(const session of securitySessions){
 assert(session.minutes>=5&&session.minutes<=10);
 assert(session.instruction.trim().split(/\s+/).length>100);
 for(const q of session.checks){assert(q.answer>=0&&q.answer<q.options.length);assert(q.feedback.trim());}
}
for(const [index,section] of siteSecurity.sections.entries()){
 const id=`VUC116-C${String(index+1).padStart(2,'0')}`;
 courses.push({id,title:`Site Security — ${section.title}`,version:digest(section.sessions),sessions:section.sessions});
}
const securityProgram={id:'VUC116',title:'VNDRLY/U Site Security',equivalentCertification:null,courseIds:courses.filter(c=>c.id.startsWith('VUC116-')).map(c=>c.id),description:siteSecurity.purpose};
assert.equal(siteSecurityAssessment.questions.length,20);
for(const q of siteSecurityAssessment.questions)assert(q.correct>=0&&q.correct<q.options.length);
const certifications=JSON.stringify({programs:[securityProgram],exams:[{programId:'VUC116',passingPercent:siteSecurityAssessment.scoring.passingPercent,questions:siteSecurityAssessment.questions}]},null,2)+'\n';
const certificationsTarget='artifacts/api-server/src/data/online-certifications.json';
if(process.argv.includes('--check'))assert.equal(readFileSync(certificationsTarget,'utf8'),certifications);else writeFileSync(certificationsTarget,certifications);
const output=JSON.stringify({courses},null,2)+'\n';
const target='artifacts/api-server/src/data/online-instruction.json';
if(process.argv.includes('--check'))assert.equal(readFileSync(target,'utf8'),output);else writeFileSync(target,output);
console.log(JSON.stringify({connectedDefinitions:courses.length,sections:courses.reduce((n,c)=>n+c.sessions.length,0),retentionChecks:courses.flatMap(c=>c.sessions.flatMap(s=>s.checks)).length,siteSecurityDraftSections:securitySessions.length,certificationsCompleted:0}));
