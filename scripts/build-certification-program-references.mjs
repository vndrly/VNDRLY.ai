// Read-only UI references to the existing VNDRLY/U programs. No publication or DB access.
import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const source = JSON.parse(readFileSync(new URL('../research/safety-program/certifications-115/catalog-publication.json', import.meta.url), 'utf8'));
const programs = source.bundles.map(program => {
  const titles = new Map(source.courses.map(course => [course.id, course.title]));
  return {id: program.id, title: program.title, description: program.description,
    courses: program.courseFamilies.map(id => { assert(titles.has(id), `${program.id}: missing ${id}`); return {id, title: titles.get(id)}; })};
});
const output = `// Generated from the existing certification program definitions by scripts/build-certification-program-references.mjs.\n// Navigation/reference data only; never creates credentials, assignments or company catalogs.\nexport const CERTIFICATION_PROGRAM_REFERENCES = ${JSON.stringify(programs, null, 2)} as const;\n`;
const target = new URL('../lib/api-zod/src/certification-program-references.ts', import.meta.url);
if (process.argv.includes('--check')) assert.equal(readFileSync(target, 'utf8'), output, 'Program references differ from their source');
else writeFileSync(target, output);
const mappingsTarget = new URL('../lib/api-zod/src/certification-external-mappings.ts', import.meta.url);
const mappingsOutput = `// Generated curriculum crosswalk; not external accreditation or credit.\nexport const CERTIFICATION_EXTERNAL_MAPPINGS = ${JSON.stringify(source.mappings, null, 2)} as const;\n`;
if (process.argv.includes('--check')) assert.equal(readFileSync(mappingsTarget, 'utf8'), mappingsOutput);
else writeFileSync(mappingsTarget, mappingsOutput);
console.log(`${programs.length} existing VNDRLY/U program references ${process.argv.includes('--check') ? 'verified' : 'generated'}`);
