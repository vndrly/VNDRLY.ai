import fs from'node:fs';import{createHash}from'node:crypto';import{gzipSync,gunzipSync}from'node:zlib';
import{LibraryDraftSchema}from'../lib/api-zod/src/work-hub-library.ts';
import{safetyTrainingContentHash}from'../artifacts/api-server/src/lib/safety-training-content-hash.ts';
import{streamlineBody}from'./lib/streamlined-training.mjs';
import{additionalChecks}from'../research/safety-program/energy-safety-core/additional-checks.mjs';
const root='research/safety-program/energy-safety-core',read=p=>JSON.parse(fs.readFileSync(`${root}/${p}.json`));
const privateRoot='.local/private-training',privateBankPath=`${privateRoot}/energy-core-exam-bank.json`;
const examBank=fs.existsSync(privateBankPath)?JSON.parse(fs.readFileSync(privateBankPath)):null;
if(examBank){
 const benchmarkMappings=JSON.parse(fs.readFileSync(`${privateRoot}/energy-core-benchmark-map.json`));
 fs.writeFileSync(`${root}/assessment-index.json`,JSON.stringify({items:examBank.map(({id,domainId})=>({id,domainId})),benchmarkMappings},null,2));
}
await import('../research/safety-program/energy-safety-core/build-crosswalk.mjs');
const assessmentIndex=read('assessment-index');
const chapters=['a','b'].flatMap(p=>read(`lessons-${p}`)).map(l=>({...l,body:streamlineBody(l.body),questions:[...l.questions,...(additionalChecks[l.id]??[])]}));
const benchmark=read('benchmark-crosswalk'),osha=read('osha-crosswalk'),review=read('independent-review-register');
const learningQuestions=chapters.flatMap(l=>l.questions),explanations=Object.fromEntries(learningQuestions.map(q=>[q.id,q.explanation]));
const lesson=(id,title,body,links=[])=>({id,title,body,fileIds:[],links:links.slice(0,20)});
const intro=lesson('ESC_START','Start here',`Read the ten lessons and worked scenarios, then answer the 48 knowledge checks. A wrong answer displays an explanation; acknowledge the correction to continue. Your original and remediated scores remain separate. No evidence upload, supervisor sign-off or practical evaluation is required to finish this online course.

After learning completion, take the separate 40-question exam. Answers save individually. Submit the complete attempt for marking; the passing threshold is 80%. Failed attempts remain recorded and you may retake. Learning remediation does not change exam scores.

Your result is a VNDRLY internal knowledge credential, not an accredited PEC or OSHA Outreach credential. It stays with your VNDRLY user. The optional benchmark and regulatory references are not required course sections. Specific legal duties apply only to the actual work roles identified in the regulatory reference; they do not create additional course-completion steps. All scenarios are fictional.`);
const benchmarkBody=`## How to read this crosswalk
This optional author-prepared mapping addresses the 42 published objectives in the January 8, 2025 Basic Orientation 7.0 syllabus. Topic labels identify the original instruction and assessments. A random exam samples the bank. This reference adds no learner completion steps and does not claim external endorsement or equivalence.

${benchmark.objectives.map(r=>`### Benchmark ${r.objective}: ${r.topic}\nInstruction: ${r.instruction.lessonId} — ${r.instruction.heading}.\nLearning checks: ${r.learningChecks.join(', ')}.\nSeparate exam bank: ${r.examQuestionIds.join(', ')}.`).join('\n\n')}

## Separate benchmarks and delivery
This crosswalk does not establish current Core Compliance equivalence. The publicly available Core Compliance syllabus is dated 2016 and needs a current specification. H2S Clear is a separate current instructor-led specialty course and is not replaced by H2S awareness here. Offshore/SafeGulf modules and site-specific requirements remain separate. PEC Basic is instructor-led; publication of this self-paced course does not prove equivalent delivery or operator recognition.`;
const oshaBody=`## Coverage is not workplace compliance
This register covers 68 OSHA and related applicability topics for the defined onshore knowledge scope. Each row identifies the rule or boundary, who it can affect, the course knowledge connection and what still needs evidence. No row is automatically satisfied by completing this course. The employer must determine the rules applicable to the actual work, including state-plan additions and specialist regimes. OSHA's older training-requirements publication is an index, not a substitute for current regulations. The course cannot enumerate every possible task in every industry or complete workplace duties through a general exam.

${osha.rows.map(r=>`### ${r.id}: ${r.topic}\nReference: ${r.citation}.\nApplies to: ${r.appliesTo}.\nCore connection: ${r.lessonIds.join(', ')}. ${r.coreCoverage}.\nStill required: ${r.remainingEmployerEvidence}\n${r.legalTaskRequirements.length?`Legal task requirement: ${r.legalTaskRequirements.map(x=>x.citation+' — '+x.appliesTo+': '+x.requirement).join(' ')}`:''}\nReview: ${r.status}.\nSource: ${r.sourceUrls.join(' ')}`).join('\n\n')}

This is an optional employer reference. No upload, independent review, blanket practical assessment or supervisor sign-off is added to VNDRLY course completion.`;
const lessons=[intro,...chapters.map(l=>lesson(l.id,l.title,`## Learning objectives\n${l.objectives.map(s=>`- ${s}`).join('\n')}\n\n${l.body}`,l.sourceUrls)),lesson('ESC_BENCHMARK','PEC benchmark: actual content and assessment crosswalk',benchmarkBody,[benchmark.sourceUrl]),lesson('ESC_OSHA','OSHA coverage: remaining employer and practical requirements',oshaBody,['https://www.osha.gov/laws-regs/regulations/standardnumber','https://www.osha.gov/stateplans','https://www.osha.gov/sites/default/files/publications/osha2254.pdf'])];
const content=LibraryDraftSchema.parse({kind:'training',title:'VNDRLY Energy Safety Core',description:'Complete onshore energy safety instruction, worked jobsite scenarios and explained learning checks, followed by a separate domain-balanced certification examination. Optional benchmark and regulatory references are available outside the required learning path. No blanket evidence upload or practical evaluation is required for online completion. English; self-paced; VNDRLY internal knowledge credential, not externally accredited.',safetyRelated:true,training:{lessons,completionMode:'both',questions:learningQuestions.map(({explanation,...q})=>q),passingPercent:100,allowRetries:true,maximumAttempts:100,refresherDays:null,guided:{steps:lessons.filter(l=>!['ESC_BENCHMARK','ESC_OSHA'].includes(l.id)).map(l=>({lessonId:l.id,questionIds:chapters.find(c=>c.id===l.id)?.questions.map(q=>q.id)??[]})),explanations},...(examBank?{certificationExam:{questions:examBank,questionCount:40,questionsPerDomain:4,passingPercent:80,maximumAttempts:100}}:{})}});
const words=chapters.reduce((sum,l)=>sum+l.body.split(/\s+/).filter(Boolean).length,0);
if(chapters.length!==10||learningQuestions.length!==48||words<14000||assessmentIndex.items.length!==75)throw Error('Incomplete flagship instruction/checks/examination');
for(const l of chapters){if(l.body.split(/\s+/).length<1100||l.questions.length<4)throw Error(`${l.id}:incomplete instruction`);}
const teaching=structuredClone(content);delete teaching.training.certificationExam;
const teachingSha256=safetyTrainingContentHash(teaching),previousContract=fs.existsSync(`${root}/assessment-contract.json`)?read('assessment-contract'):null;
if(!examBank&&previousContract?.teachingSha256!==teachingSha256)throw Error('Teaching changed: authorized private bank required to rebuild trusted course');
const sourceSha256=examBank?createHash('sha256').update(JSON.stringify(content)).digest('hex'):previousContract.sourceSha256;
const contentSha256=examBank?safetyTrainingContentHash(content):previousContract.contentSha256;
const course={id:'G99',categoryId:'competence',title:content.title,purpose:'Teach onshore safety knowledge through complete lessons and scenarios, with a separate exam.',practicalBoundary:'No evidence upload, independent assessor or practical evaluation is required to complete this online course. Legal task requirements apply only to the named work role under the cited regulation.',sourceVersion:'2.0',sourceSha256,contentSha256,teachingSha256,content:teaching};
fs.writeFileSync(`${root}/course.json`,JSON.stringify(course,null,2));
fs.writeFileSync(`${root}/assessment-contract.json`,JSON.stringify({courseId:'G99',bankSize:75,questionCount:40,questionsPerDomain:4,domains:10,passingPercent:80,maximumAttempts:100,sourceSha256,contentSha256,teachingSha256,bankLocation:'Authorized server publication payload only; not in public source'},null,2));
if(examBank){fs.mkdirSync(privateRoot,{recursive:true});fs.writeFileSync(`${privateRoot}/energy-core-course.json`,JSON.stringify({...course,content},null,2));}
const prior=JSON.parse(fs.readFileSync('research/safety-program/2026-11-02/prepared-course-publication.json')).courses;
if(prior.length!==116||prior.some(c=>c.id==='G99'))throw Error('Expected116preservedcourses');
fs.writeFileSync(`${root}/preserved-course-identities.json`,JSON.stringify(prior.map(c=>({id:c.id,sourceSha256:c.sourceSha256,contentSha256:safetyTrainingContentHash(LibraryDraftSchema.parse(c.content))})),null,2));
const dataFile='artifacts/api-server/src/data/safety-training-catalog.ts',dataText=fs.readFileSync(dataFile,'utf8'),encoded=dataText.match(/Buffer\.from\(("[A-Za-z0-9+/=]+")/)[1];
const catalog=JSON.parse(gunzipSync(Buffer.from(JSON.parse(encoded),'base64')).toString('utf8'));
catalog.curriculum=catalog.curriculum.filter(c=>c.id!=='G99');
if(catalog.curriculum.length!==116)throw Error('Existing curriculum count changed');
catalog.curriculum.push(Object.fromEntries(Object.entries(course).filter(([k])=>k!=='content')));
const historical=JSON.parse(fs.readFileSync('research/safety-program/regulatory-streamlining/previous-course-identities.json'));
for(const current of catalog.curriculum)current.compatibleVersions=historical.filter(c=>c.id===current.id).map(({sourceSha256,contentSha256})=>({sourceSha256,contentSha256}));
fs.writeFileSync(dataFile,`// Generated from source-linked original VNDRLY training and explicit residual evidence.\nimport {gunzipSync}from'node:zlib';\nexport const safetyTrainingCatalog: unknown = JSON.parse(gunzipSync(Buffer.from(${JSON.stringify(gzipSync(Buffer.from(JSON.stringify(catalog))).toString('base64'))},'base64')).toString('utf8'));\n`);
fs.writeFileSync(`${root}/publication.json`,JSON.stringify({version:1,courses:[course]},null,2));
const validation={courseId:'G99',instructionWords:words,chapters:10,sections:lessons.length,workedScenarios:chapters.reduce((n,l)=>n+(l.body.match(/worked scenario/gi)?.length??0),0),learningChecks:learningQuestions.length,examBank:75,examQuestions:40,examDomains:10,benchmarkObjectives:benchmark.objectives.length,oshaRows:osha.rows.length,openReviewItems:review.items.length,preservedCourses:116,sourceSha256,contentSha256:course.contentSha256};
fs.writeFileSync(`${root}/validation.json`,JSON.stringify(validation,null,2));console.log(JSON.stringify(validation));
