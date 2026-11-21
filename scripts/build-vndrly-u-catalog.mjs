import {readFileSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const source=JSON.parse(readFileSync('research/safety-program/certifications-115/catalog-publication.json','utf8'));
assert.equal(source.bundles.length,115);assert.equal(source.mappings.length,114);
const equivalents=new Map(source.mappings.map(m=>[m.programId,m.externalCertification]));
const catalog={programs:source.bundles.map(p=>({id:p.id,title:p.title,equivalentCertification:equivalents.get(p.id)??null,courseIds:p.courseFamilies})),courses:source.courses.map(c=>({id:c.id,title:c.title,lessons:c.content.training.lessons.map(l=>({id:l.id,title:l.title,body:l.body}))}))};
const online=JSON.parse(readFileSync('artifacts/api-server/src/data/online-instruction.json','utf8'));
const additions=JSON.parse(readFileSync('artifacts/api-server/src/data/online-certifications.json','utf8'));
for(const program of additions.programs){
 assert(!catalog.programs.some(p=>p.id===program.id));catalog.programs.push(program);
 for(const id of program.courseIds){
  const course=online.courses.find(c=>c.id===id);assert(course);
  if(!catalog.courses.some(c=>c.id===id))catalog.courses.push({id,title:course.title,lessons:course.sessions.map(s=>({id:s.id,title:s.title,body:s.instruction+(s.example?'\n\n## Worked example\n\n'+s.example:'')}))});
 }
}
const text=`// Generated central VNDRLY/U catalog. No company records or assignments.\nimport {gunzipSync} from 'node:zlib';\nexport type CatalogCourse={id:string;title:string;lessons:{id:string;title:string;body:string}[]};\nexport type CatalogProgram={id:string;title:string;equivalentCertification:string|null;courseIds:string[];parentProgramId?:string};\nexport const vndrlyUCatalog: {programs:CatalogProgram[];courses:CatalogCourse[]}=JSON.parse(gunzipSync(Buffer.from('${gzipSync(JSON.stringify(catalog)).toString('base64')}','base64')).toString('utf8'));\n`;
const target='artifacts/api-server/src/data/vndrly-u-catalog.ts';
if(process.argv.includes('--check'))assert.equal(readFileSync(target,'utf8'),text);else writeFileSync(target,text);
console.log(`${catalog.programs.length} shared certifications, ${catalog.courses.length} courses, ${equivalents.size} equivalent mappings`);
