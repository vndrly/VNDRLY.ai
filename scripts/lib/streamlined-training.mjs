// Only the cited, role-specific legal duties below may add physical evaluation
// or records. None is an extra VNDRLY online-course completion condition.
export const legalTaskRequirements = [
 {id:'PPE',courses:['H08','H14','G04','G51','G53','G73'],citation:'29 CFR 1910.132(f)(2), (g)',appliesTo:'Employees using the eye/face, head, foot, hand or personal fall protection covered by paragraph (g)',requirement:'Before that work, demonstrate understanding of the PPE training and ability to use the PPE properly. This is not a separate independent certification requirement. Respirators and electrical protective equipment follow their own standards rather than paragraph (f).',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.132'},
 {id:'RESP',courses:['H15','H13','G02','G04','G51','G53','G73'],citation:'29 CFR 1910.134(e), (f), (k)(1)',appliesTo:'Required respirator users; tight-fitting facepieces require the applicable fit test',requirement:'Complete the required medical evaluation before fit testing or use, the applicable fit test, and training that enables demonstration of the listed knowledge and respirator-use skills. These duties apply to the actual respirator assignment, not everyone taking awareness training.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.134'},
 {id:'PIT',courses:['H07','E02','E09','C01','C04','G75','G90'],citation:'29 CFR 1910.178(l)(2), (4), (6)',appliesTo:'Operators of powered industrial trucks covered by this standard',requirement:'Formal instruction, practical training and workplace performance evaluation are required before independent operation, with employer certification and applicable refresher/evaluation duties. A trainer/evaluator needs the knowledge, training and experience specified in (l)(2)(iii); an outside assessor is not universally required.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178'},
 {id:'CRANE',courses:['H07','E09','G75'],citation:'29 CFR 1926.1427(a), (f)',appliesTo:'Operators of construction cranes/equipment covered by Subpart CC, subject to the stated exceptions',requirement:'Meet the applicable operator training/certification or licensing provisions and employer evaluation requirements for the equipment and assigned work. Do not apply this crane rule to every lifting worker or every piece of mobile equipment.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.1427'},
 {id:'SIGNAL',courses:['H07','G75'],citation:'29 CFR 1926.1428(a), (c)(5)',appliesTo:'Construction crane signal persons covered by Subpart CC',requirement:'Demonstrate the specified knowledge through an oral or written test and a practical test. The standard permits a qualified third-party evaluator or the employer\'s qualified evaluator, with the stated documentation and portability limits.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.1428'},
 {id:'RESCUE',courses:['H05','R02','G87'],citation:'29 CFR 1910.146(k)(2)(iv)',appliesTo:'Employer-designated employees performing covered permit-space rescue',requirement:'Practice the assigned permit-space rescues at least every 12 months using the specified actual or representative spaces, subject to the real-rescue exception. This is a rescue-team duty, not a practical test required of every awareness-course learner.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146'},
 {id:'HAZWOPER',courses:['G02','G51','G84'],citation:'29 CFR 1910.120(e)(3), (e)(4), (q)(6)',appliesTo:'Workers whose actual hazardous-waste or emergency-response duties fall within the cited provisions',requirement:'Apply the training and supervised field-experience or response-role competence requirements specified for that actual assignment. Do not assign the hazardous-waste field-experience requirement to ordinary waste handling or awareness-only roles.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.120'},
 {id:'POWER',courses:['H12','G60'],citation:'29 CFR 1910.269(a)(2)(viii)',appliesTo:'Employees doing covered electric-power generation, transmission or distribution work',requirement:'Demonstrate proficiency in the applicable work practices before the training required by this paragraph is treated as complete. This does not impose the power-industry rule on every employee taking electrical awareness.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.269'},
 {id:'ASBESTOS',courses:['H16','G73'],citation:'29 CFR 1926.1101(k)(9)(iii)-(v)',appliesTo:'Workers performing the particular construction asbestos work classes covered by these provisions',requirement:'Use the training specified for the actual work class, including its applicable hands-on component and required course duration. General asbestos awareness does not impose these abatement-training requirements on a worker who does not perform that work.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.1101'},
 {id:'RADIOGRAPHY',courses:['G59','G70'],citation:'10 CFR 34.43(b)(4), (c)(3), (f)',appliesTo:'Radiographers and radiographer assistants using licensed material in covered NRC industrial-radiography operations',requirement:'The licensee must provide the applicable hardware practical examination and maintain the required training/examination records. These are radiography-role duties, not requirements for every NDT method or an awareness-course learner.',url:'https://www.govinfo.gov/content/pkg/CFR-2025-title10-vol1/pdf/CFR-2025-title10-vol1-sec34-43.pdf'},
 {id:'HAZMAT_RECORD',courses:['G01','G50'],citation:'49 CFR 172.702(d), 172.704(a), (d)',appliesTo:'Hazmat employees performing functions covered by the Hazardous Materials Regulations',requirement:'Provide the applicable function-specific training and testing and retain the employer training record specified in (d). No universal separate practical examination or VNDRLY evidence upload is prescribed by these provisions.',url:'https://www.phmsa.dot.gov/training/hazmat/training-requirements-industry'},
 {id:'ISOLATION_RECORD',courses:['H04','C07'],citation:'29 CFR 1910.147(c)(7)(i), (iv)',appliesTo:'Employees with the specified roles in covered general-industry energy-control work; excludes oil/gas well drilling/servicing and the other exclusions in (a)(1)(ii)',requirement:'Provide the specified assigned-role energy-control training and employer certification identifying employee and training date. This paragraph does not prescribe a universal separate independent practical examination.',url:'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147'},
];

export function courseLegalRequirements(id){return legalTaskRequirements.filter(r=>r.courses.includes(id));}
export function legalBoundary(id){return courseLegalRequirements(id).map(r=>`${r.citation} — ${r.appliesTo}: ${r.requirement} Source: ${r.url}`);}

// Presentation-only corrections also cover immutable, already-assigned versions.
// Keep their stored identities, answers and earned results intact.
export function removeAccreditationDisclaimers(content){
 const replacements=[
  ['Includes the actual PEC benchmark crosswalk, OSHA applicability/evidence register and exact independent-review/partner-acceptance status.',''],
  ['This lesson is awareness education, not legal advice, a PEC credential, or an independent authorization to perform regulated work.',''],
  ['VNDRLY internal knowledge credential','VNDRLY Energy Safety Core credential'],
  ['VNDRLY internal course credential','VNDRLY Energy Safety Core credential'],
  ['No evidence upload, supervisor sign-off or practical evaluation is required to finish this online course.',''],
  ['No evidence upload, independent assessor, supervisor sign-off or practical evaluation is required for online completion.',''],
  ['No blanket evidence upload or practical evaluation is required for online completion.',''],
  ['Optional benchmark and regulatory references are available outside the required learning path.',''],
  ['The optional benchmark and regulatory references are not required course sections.',''],
  ['Specific legal duties apply only to the actual work roles identified in the regulatory reference; they do not create additional course-completion steps.',''],
  ['The online course and exercise attendance are learning records, not accreditation or proof of all emergency readiness.',''],
  ['A course completion badge cannot create its own accreditation.',''],
  ['laboratory scope/accreditation where required','laboratory scope'],
  ['This course teaches reasoning and planning, not asbestos survey accreditation, lead-abatement qualification, industrial-hygiene certification or permission to disturb suspect materials.','This course teaches reasoning and planning.'],
  ['Specialized credentials depend on the actual legal/contractual scope; this course creates no accreditation or universal licensing requirement.',''],
  ['This module teaches transferable instructional design and evaluation methods; it grants no subject-matter qualification or provider accreditation.','This module teaches transferable instructional design and evaluation methods.'],
  ['The assessment form cannot create its own accreditation.',''],
  ['Provider approval and accreditation require an actual external or authorized basis where applicable.',''],
  ['A course cannot become accredited because its title says certified or because it cites a respected regulator.',''],
  ['6. Evaluate transfer and keep accreditation claims exact','6. Evaluate learning transfer'],
  ['Does citing CDC make a provider accredited?','Does citing a reference establish that a learner can apply a procedure?'],
  ['No; approval/accreditation requires its actual authorized basis.','No; check whether the learner understands and can apply the taught procedure.'],
  ['Yes, citations confer approval.','Yes, citing a reference demonstrates the learner can apply it.'],
  ['Reference use is not accreditation.','A reference supports instruction; the learner’s answers show whether they understood it.'],
  ['Accreditation for every provider.','Only the provider’s name.'],
  ["This course's paper assessment demonstrates instructional reasoning only; it cannot accredit the provider or create subject competence.","This course's paper assessment demonstrates instructional reasoning."],
  [', not externally accredited',''],
  [', not an accredited PEC or OSHA Outreach credential',''],
  ['Exact work class, required licensed/accredited instruction where applicable and observed actual task competence.','Training specified for the actual asbestos work class.'],
  ['Separate regulator/operator requirements, licenses, OQ, H2S specialty standards and accredited courses as actually required.','Applicable legal requirements for the actual transport, offshore, mine, aviation or licensed work.'],
 ];
 const clean=value=>{let text=value;for(const [from,to]of replacements)text=text.replaceAll(from,to);return text.replace(/ {2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();};
 const result=structuredClone(content);
 const removed=new Set(['ESC_BENCHMARK','ESC_OSHA','ESC_REVIEW']);
 if(result.training){result.training.lessons=result.training.lessons.filter(l=>!removed.has(l.id));if(result.training.guided)result.training.guided.steps=result.training.guided.steps.filter(s=>!removed.has(s.lessonId));}
 if(result.description)result.description=clean(result.description);
 for(const lesson of result.training?.lessons??[]){lesson.title=clean(lesson.title);lesson.body=clean(lesson.body);}
 for(const question of result.training?.questions??[]){question.prompt=clean(question.prompt);for(const option of question.options)option.label=clean(option.label);}
 for(const [id,value]of Object.entries(result.training?.guided?.explanations??{}))result.training.guided.explanations[id]=clean(value);
 return result;
}

// These headings were inserted as universal obligations by the old builders.
const extraHeading=/^#{1,6}\s+(?:Vendor evidence still required|Qualified practical assessment still required|Separate practical evaluation|What needs a separate practical evaluation|Practical evaluation(?: and.*)?|Practical assessment(?: and.*)?|Record a defensible practical evaluation)\s*$/i;
const extraSentence=/(?:practical.{0,65}(?:assess|evaluat|demonstrat|qualif|competence|capabilit|skills|train|instruct|check|drill)|qualified practical|qualified assessor|assessor must|must.*assessor|vendor evidence|separate practical boundary|separately assess|separately evaluat|observed.*(?:assessment|demonstration).*required)/i;
const notices=/(?:Company evidence review, practical competence and job\/site authorization are separate judgments|Awareness means recognizing the hazard and knowing when to stop and seek help|An appropriate assessor must have|A competent assessor must observe|An assessor must record|Review learning and practical readiness|Supply the listed vendor evidence)/i;

export function streamlineBody(body,{administrative=false}={}){
 let skip=false;
 const parts=[];
 for(const paragraph of body.split(/\n\n+/)){
  if(/^#{1,6}\s/.test(paragraph))skip=extraHeading.test(paragraph.trim());
  if(skip||notices.test(paragraph))continue;
  // Remove added assessment demands, including copied boundary prose. The
  // applicable statutory duty is supplied once, separately, with its citation.
  const sentences=paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const kept=sentences.filter(s=>!extraSentence.test(s));
  let text=kept.join(' ').replace(/Those roles require separate practical evaluation and employer\/site authorization\./g,'').replace(/legally or contractually required/g,'legally required').trim();
  if(text)parts.push(text);
 }
 return parts.join('\n\n').replace(/\n{3,}/g,'\n\n');
}

export function streamlineCourseContent(content,id,originalBoundary='',preserveAssessment=false){
 const result=structuredClone(content),t=result.training;
 for(const lesson of t.lessons){lesson.body=streamlineBody(originalBoundary?lesson.body.replaceAll(originalBoundary,''):lesson.body);if(/(?:finish|completion|feedback)$/.test(lesson.id))lesson.title=lesson.title.replace(/(?: and practical boundaries| and practical evaluation boundary|Completion and practical boundaries)/i,'');}
 if(id==='G99')for(const lesson of t.lessons){
  if(lesson.id==='ESC_START')lesson.body='Read the ten lessons and scenarios and answer the 48 knowledge checks. A wrong answer displays an explanation; acknowledge it to continue. Both learning scores remain recorded. Then take the separate 40-question exam and explicitly submit it for marking; the passing threshold is 80%. No evidence upload, independent assessor, supervisor sign-off or practical evaluation is required for online completion. Your result is a VNDRLY internal knowledge credential, not an accredited PEC or OSHA Outreach credential.';
  if(['ESC_BENCHMARK','ESC_OSHA','ESC_REVIEW'].includes(lesson.id))lesson.body='Reference information is maintained separately from the teaching and assessment. No additional evidence upload, independent review or blanket practical evaluation is required to complete this online course. Specific regulatory duties apply only to the actual covered work role.';
 }
 const replacements={
  H08_final_6_3:['What should happen if a work position cannot be reached while maintaining the fall-protection arrangement?',['Treat the written score as permission to proceed.','Stop and have the work method reviewed before continuing.','Extend the connector without checking compatibility.'],'The intended protection must remain effective throughout the task. An improvised extension can change the fall and impact risks.'],
  G67_final15:['Which information controls the limits used for the actual instrument task?',['The applicable current equipment instructions and approved task limits.','The document reviewer’s memory alone.','Any value used in a fictional course example.','The online course score.'],'Use the actual equipment information and task limits; fictional course values do not establish operating limits.'],
  G71_final20:['What should a calibration record identify?',['Only the online course score.','The actual instrument, method, reference, results and applicable limitations.','Only this quiz.','Only an invoice.'],'A traceable record connects the result to the instrument and method. A quiz or invoice cannot supply missing measurement information.'],
  G79_check6:['Is a surprise uncontrolled confrontation an appropriate training exercise?',['An online score makes it acceptable.','No; use a planned, safe fictional exercise.','Yes, bravery is the goal.','Yes, after a quiz.'],'A learning exercise must not create an uncontrolled confrontation. The fictional course scenario is sufficient for this knowledge check.'],
  G81_final19:['Should a training exercise introduce uncontrolled production-system changes?',['No; use fictional data or an approved isolated exercise environment.','Yes, realism is enough.','Yes, if reversible in theory.','An online course score authorizes production changes.'],'Practice with fictional data or an isolated environment so learning does not alter a live operation.'],
 };
 if(!preserveAssessment)for(const q of t.questions){const edit=replacements[q.id];if(edit){q.prompt=edit[0];q.options.forEach((o,i)=>o.label=edit[1][i]);t.guided.explanations[q.id]=edit[2];}}
 const wording=[['equipment outside the scope of the recorded practical assessment','a powered industrial truck outside the scope of the recorded operator evaluation'],['A supervisor has course attendance evidence but no practical assessment required for the planned equipment task.','A forklift operator has course attendance evidence but lacks the workplace performance evaluation required by 29 CFR 1910.178(l).'],['Verify relevant practical assessment and employer/site authorization before assigning isolator duties.','Verify the assigned-role training, applicable isolation procedure and employer designation before assigning isolator duties.'],['before night operators receive instruction or practical assessment','before night operators receive instruction for the changed controls']];
 if(!preserveAssessment)for(const q of t.questions){for(const [from,to]of wording){q.prompt=q.prompt.replaceAll(from,to);q.options.forEach(o=>o.label=o.label.replaceAll(from,to));}}
 // The existing introductory and closing teaching remains; no extra supervisor
 // checklist, evidence upload or independent assessor is invented for completion.
 const law=legalBoundary(id);
 if(law.length)t.lessons.at(-1).body+='\n\n## Legal requirements for the named work role\nThese apply only when you perform the work described below. They are not additional steps for completing this online course.\n\n'+law.join('\n\n');
 return removeAccreditationDisclaimers(result);
}
