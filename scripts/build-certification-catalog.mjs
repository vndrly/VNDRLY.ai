/** Deterministic catalog integration of the 115 completed public material packages. */
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {LibraryDraftSchema} from '../lib/api-zod/src/work-hub-library.ts';
import {EXTERNAL_CERTIFICATION_CATALOG} from '../lib/api-zod/src/external-certification-catalog.ts';
import {safetyTrainingContentHash} from '../artifacts/api-server/src/lib/safety-training-content-hash.ts';
const dir = new URL('../research/safety-program/certifications-115/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('catalog-source.json', dir), 'utf8'));
const sha = text => createHash('sha256').update(text).digest('hex');
const courses = [], bundles = [], mappings = [];
const boundary = 'Course completion records study only. Certification also requires the separately controlled examination and applicable observed assessments specified in the program. This VNDRLY/U curriculum counterpart does not award, replace, or claim accreditation by the external credential issuer.';
assert.equal(source.programs.length, 115);
for (const program of source.programs) {
  const raw = readFileSync(new URL(program.file, dir), 'utf8');
  assert.equal(sha(raw), program.sha256, `${program.id}: material integrity`);
  const sections = raw.split(/(?=^# )/m).filter(Boolean);
  assert.equal(sections.join(''), raw, `${program.id}: missing material`);
  const families = [];
  for (const [index, section] of sections.entries()) {
    const id = `${program.id}-C${String(index + 1).padStart(2, '0')}`;
    const heading = section.match(/^# (.+)/m)?.[1]?.trim() || 'Program introduction';
    const title = `${program.id} | ${heading}`.slice(0, 200);
    // Keep every source character, including headings and source limitations.
    const chunks = section.split(/(?=^## )/m).flatMap(text => {
      const parts = [];
      while (text.length > 49000) {
        const cut = text.lastIndexOf('\n', 49000);
        const size = cut > 0 ? cut + 1 : 49000;
        parts.push(text.slice(0, size)); text = text.slice(size);
      }
      if (text) parts.push(text);
      return parts;
    }).filter(Boolean);
    while (chunks.length > 50) {
      const mergeAt = chunks.findIndex((part, i) => i + 1 < chunks.length && part.length + chunks[i + 1].length <= 49000);
      assert(mergeAt >= 0, `${id}: component exceeds course capacity`);
      chunks.splice(mergeAt, 2, chunks[mergeAt] + chunks[mergeAt + 1]);
    }
    assert.equal(chunks.join(''), section);
    // A long component remains one course, with sequential lesson parts.
    assert(chunks.length <= 50, `${id}: too many lessons`);
    const content = LibraryDraftSchema.parse({kind:'training', title, safetyRelated:true,
      description: boundary,
      training:{completionMode:'checkoff', questions:[], lessons:chunks.map((body, n) => ({
        id:`L${n + 1}`, title:(body.match(/^#{1,2} (.+)/m)?.[1]?.trim() || `${heading} — part ${n + 1}`).slice(0,300), body,
      }))}});
    courses.push({id,title,categoryId:'competence',sourceVersion:'1.0',sourceSha256:sha(section),contentSha256:safetyTrainingContentHash(content),content});
    families.push(id);
  }
  assert(families.length > 0 && families.length <= 100);
  const external = program.externalCertification;
  if (external) {
    const credential = EXTERNAL_CERTIFICATION_CATALOG.find(c => c.name === external);
    assert(credential, `${program.id}: unknown external credential ${external}`);
    mappings.push({externalCertification:external,programId:program.id,aliases:credential.aliases ?? [],relationship:'curriculum_counterpart',externalCredentialGranted:false});
  }
  bundles.push({id:program.id,title:program.title,description:`${boundary}\n\n${external ? `External benchmark: ${external}.` : 'Umbrella: verified component certificates plus integration assessment.'}\nSource boundary: ${program.sourceLimitation}`,
    courseFamilies:families,externalCredentialGrantedByOnlineCompletion:false,
    certificationRequirements:{programId:program.id,assessmentRequired:true,externalCertification:external,sourceSha256:program.sha256,...(program.id === 'VUC115' ? {umbrella:{commonRequired:source.umbrella.commonRequired,pathways:source.umbrella.pathways,capstoneRequired:true,maxReviewMonths:source.umbrella.maxReviewMonths,knowledgeOnlyFirstAidAccepted:false}} : {})},
    ...(program.id === 'VUC115' ? {umbrellaPolicy:source.umbrella} : {})});
}
assert.equal(mappings.length,114);
assert.equal(new Set(mappings.map(m=>m.externalCertification)).size,114);
assert.equal(EXTERNAL_CERTIFICATION_CATALOG.length,114);
assert.equal(new Set(courses.map(c=>c.id)).size,courses.length);
const manifest={version:1,scope:'115 VNDRLY/U certification curricula and 114 external curriculum counterparts; no learner awards or assignments',bundles,courses,mappings,umbrellaPolicy:source.umbrella};
const output=JSON.stringify(manifest,null,2)+'\n';
const target=new URL('catalog-publication.json',dir);
if(process.argv.includes('--check'))assert.equal(readFileSync(target,'utf8'),output);
else writeFileSync(target,output);
console.log(JSON.stringify({programs:bundles.length,courses:courses.length,externalMappings:mappings.length,sha256:sha(output)}));
