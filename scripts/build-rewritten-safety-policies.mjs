import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {policies} from '../research/safety-program/policy-rewrite/policies.mjs';
import {SAFETY_LIBRARY_REQUIREMENTS} from '../lib/api-zod/src/safety-library-catalog.ts';
const root='research/safety-program/policy-rewrite';
const hash=s=>createHash('sha256').update(s).digest('hex');
if(policies.length!==59||new Set(policies.map(p=>p[0])).size!==59)throw Error('Expected59 distinct policies');
const documents=policies.map(([id,title,body])=>{
 const requirement=SAFETY_LIBRARY_REQUIREMENTS.find(r=>r.id===id);
 if(!requirement||body.trim().split(/\s+/).length<115||body.split('\n\n').length<4)throw Error(id+':incomplete policy');
 if(/Adoption record|Research traceability|Inventory priority|fixed category share|\bPEC\b|accredit|Internal knowledge credential|unproctored|no universal operator acceptance|Approval item|Enter entity|This policy (?:adds|creates|does not|imposes)/i.test(body))throw Error(id+':removed clutter returned');
 const text=`# ${title}\n\n${body.trim()}\n`;
 fs.mkdirSync(`${root}/documents`,{recursive:true});fs.writeFileSync(`${root}/documents/${id}.md`,text);
 const original=fs.readFileSync(`research/safety-program/2026-10-31/library-resources/${id}/policy.md`,'utf8');
 return {id,title,categoryId:requirement.category,description:body.split('\n\n')[0],policyText:text,sourceSha256:hash(text),previousSourceSha256:hash(original),words:body.trim().split(/\s+/).length};
});
const manifest={sourceVersion:'2.0',authoredAt:'2026-11-01',policies:documents};
fs.writeFileSync(`${root}/publication.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({policies:documents.length,words:documents.reduce((n,p)=>n+p.words,0),complete:true}));

