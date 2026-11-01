/** Publish all 236 authored resources through the existing company Library model. */
import "./load-env-local.mjs";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { LibraryDraftSchema, LibraryMetadataSchema } from "../lib/api-zod/src/work-hub-library";
import { SAFETY_LIBRARY_REQUIREMENTS, SAFETY_LIBRARY_RESOURCE_TYPES, SAFETY_LIBRARY_RESOURCE_LABELS } from "../lib/api-zod/src/safety-library-catalog";
import { MATURITY_RESOURCE_LABELS, MATURITY_RESOURCE_TYPES, maturityResourceTitle } from "../lib/api-zod/src/safety-maturity";

const { Client } = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");
const root = new URL("../research/safety-program/2026-10-31/library-resources/", import.meta.url);
const reportRoot = new URL("../research/safety-program/2026-10-31/library-publication/", import.meta.url);
type Owner = { kind: "vendor" | "partner"; id: number; user_id: number };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const stableId = (value: string) => {const h=sha(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
export const safetyLibraryId = (owner: Pick<Owner,"kind"|"id">, family: string, type: string) => stableId(`safety-library-v2:${owner.kind}:${owner.id}:${family}:${type}`);
const common = "Original VNDRLY company-program resource. VNDRLY verifies company evidence; Partners verify job/site requirements. Valid external equivalents are accepted. Reading, uploads and completion do not automatically earn maturity credit, certify competence or authorize work. Qualified practical assessment and technical/site approval remain required where applicable. Evidence examples are fictional teaching material, never real company evidence.";
const files = new Map<string,string>();
const register = JSON.parse(readFileSync(new URL("resource-register.json",root),"utf8"));
const rewrittenPolicies = JSON.parse(readFileSync(new URL("../research/safety-program/policy-rewrite/publication.json",import.meta.url),"utf8")).policies as {id:string;title:string;description:string;policyText:string;sourceSha256:string}[];
if(register.resources.length!==236||SAFETY_LIBRARY_REQUIREMENTS.length!==59)throw Error("Incomplete authored Library");
for(const r of SAFETY_LIBRARY_REQUIREMENTS)for(const t of SAFETY_LIBRARY_RESOURCE_TYPES){
  const path=`${r.id}/${t}.md`;
  if(!register.resources.some((x:any)=>x.markdown===path))throw Error(`Unregistered resource ${path}`);
  const text=readFileSync(new URL(path,root),"utf8");
  if(text.length<1000||(t==="evidence-examples"&&!text.includes("SYNTHETIC TRAINING EXAMPLES ONLY")))throw Error(`Invalid resource ${path}`);
  files.set(path,text);
}
function nativeText(owner:Owner,family:string,text:string){
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_all,label:string,target:string)=>{
    if(/^https?:\/\//.test(target))return `${label}\n${target}`;
    const m=target.match(/^(?:(?:\.\.\/)?([LHCEIR]\d{2})\/)?(policy|form|training|evidence-examples)\.md$/);
    return m?`${label}\nhttps://vndrly.ai/work-hub/library/${safetyLibraryId(owner,m[1]??family,m[2])}`:label;
  });
}
function formFields(text:string){
  const lines=text.split("\n").filter(l=>l.startsWith("| "));
  const labels=[...new Set(lines.map(l=>l.split("|")[1].trim()).filter(l=>l&&!["Field","Control","Finding/failed control","Decision field"].includes(l)))];
  const fields:any[]=[];
  for(const [i,label] of labels.entries()){
    const control=lines.some(l=>l.startsWith(`| ${label} |`)&&l.split("|").length===6);
    fields.push({id:`field_${i}`,label,type:control?"choice":"textarea",required:false,...(control?{options:[{id:"not_verified",label:"Not verified"},{id:"pass",label:"Pass"},{id:"fail",label:"Fail — record restrictions and actions"},{id:"na",label:"N/A — explain and obtain review"}]}:{})});
    if(control)fields.push({id:`check_${i}`,label:`Observation, evidence, checker and time: ${label}`.slice(0,300),type:"textarea",required:false});
  }
  fields.push({id:"action_rows",label:"Additional findings/actions: immediate controls, owner, due date, completion and effectiveness verification",type:"textarea",required:false});
  return fields;
}
export function buildSafetyLibraryResources(owner:Owner){
  return SAFETY_LIBRARY_REQUIREMENTS.flatMap(r=>SAFETY_LIBRARY_RESOURCE_TYPES.map(type=>{
    const replacement=type==='policy'?rewrittenPolicies.find(p=>p.id===r.id):undefined;
    if(type==='policy'&&!replacement)throw Error(`Missing rewritten policy ${r.id}`);
    const source=replacement?.policyText??files.get(`${r.id}/${type}.md`)!;const text=replacement?source:nativeText(owner,r.id,source);
    const title=replacement?`${r.id} — ${replacement.title}`:`${r.id} — ${r.title} — ${SAFETY_LIBRARY_RESOURCE_LABELS[type]}`;
    const training=type==="training"?{completionMode:"both",passingPercent:100,
      lessons:[{id:`${r.id}_lesson`,title:r.title,body:text.replace(/## Facilitator answer key[\s\S]*?(?=## Practical demonstration)/,"")}],
      questions:[
        {id:"case",prompt:`${r.id}: what is required when the case-specific safeguard or authorization is missing?`,options:[{id:"stop",label:"Hold the affected activity, notify the responsible authority and verify the missing safeguard before release."},{id:"continue",label:"Continue because a policy or training completion is available."}],correctOptionIds:["stop"]},
        {id:"implementation",prompt:"Which supports implementation of this requirement?",options:[{id:"records",label:"Current authentic task/person/asset records showing the applicable controls were used."},{id:"blank",label:"A blank form or copied fictional example."}],correctOptionIds:["records"]},
        {id:"competence",prompt:"What does this lesson establish about practical competence?",options:[{id:"separate",label:"Knowledge evidence only; qualified practical assessment and employer/site authorization remain separate."},{id:"all",label:"It authorizes all activities named in the family."}],correctOptionIds:["separate"]},
        {id:"effectiveness",prompt:"What is additionally needed for effectiveness credit?",options:[{id:"followup",label:"Earlier evidence states plus suitable later follow-up showing the practice works within the reviewed scope."},{id:"closed",label:"A closed checkbox or purchased equipment alone."}],correctOptionIds:["followup"]},
        {id:"review",prompt:"Who reviews exclusions and evidence?",options:[{id:"owners",label:"VNDRLY reviews company evidence/exclusions; Partners review job/site requirements. Completion earns no automatic credit."},{id:"self",label:"Vendors can exclude requirements or award full credit without review."}],correctOptionIds:["owners"]},
      ]}:undefined;
    const content=LibraryDraftSchema.parse({kind:type==="training"?"training":type==="form"?"form":"policy",title,description:replacement?.description??`${r.applicability}. ${common}`,safetyRelated:true,policyText:type==="training"?"":text,fields:type==="form"?formFields(source):[],...(training?{training}:{})});
    const id=safetyLibraryId(owner,r.id,type);
    const metadata=LibraryMetadataSchema.parse({kind:content.kind,seriesId:id,contentVersion:1,version:1,state:"published",publishedAt:new Date().toISOString(),content,safetyResource:{familyId:r.id,categoryId:r.category,resourceType:type,sourceVersion:replacement?"2.0":"1.0",sourceSha256:sha(source)}});
    return {id,name:title,definition:content.fields,library_metadata:metadata};
  }));
}
function categoryHubs(owner:Owner){
  return Object.keys(MATURITY_RESOURCE_LABELS).flatMap(category=>MATURITY_RESOURCE_TYPES.map((type,index)=>{
    const title=maturityResourceTitle(category,type);const id=stableId(`safety-library-v1:${owner.kind}:${owner.id}:${category}:${type}`);
    const policyText=[title,common,"Each requirement below has four original Library resources. Select requirements for actual work. Completion is evidence for review, never automatic full credit.",...SAFETY_LIBRARY_REQUIREMENTS.filter(r=>r.category===category).map(r=>[`${r.id} — ${r.title}`,r.applicability,...SAFETY_LIBRARY_RESOURCE_TYPES.map(t=>`${SAFETY_LIBRARY_RESOURCE_LABELS[t]}: https://vndrly.ai/work-hub/library/${safetyLibraryId(owner,r.id,t)}`)].join("\n"))].join("\n\n");
    const content=LibraryDraftSchema.parse({kind:"policy",title,description:`${MATURITY_RESOURCE_LABELS[category]} — ${SAFETY_LIBRARY_RESOURCE_LABELS[SAFETY_LIBRARY_RESOURCE_TYPES[index]]} directory. ${common}`,policyText,safetyRelated:true});
    return {id,name:title,definition:[],library_metadata:LibraryMetadataSchema.parse({kind:"policy",seriesId:id,contentVersion:1,version:1,state:"published",publishedAt:new Date().toISOString(),content})};
  }));
}
async function main(){
  const apply=process.argv.includes("--apply");const target=new URL(process.env.DATABASE_URL??"");
  if(!target.hostname.endsWith(".pooler.supabase.com")||target.username!=="postgres.bihjmgbdzbhcnsuhzzwo"||target.pathname!=="/postgres")throw Error("Unexpected Library database");
  const client=new Client({connectionString:target.toString()});await client.connect();const results:any[]=[];
  try{
    const {rows:owners}=await client.query(`SELECT DISTINCT ON (m.org_type,COALESCE(m.vendor_id,m.partner_id)) m.org_type kind,COALESCE(m.vendor_id,m.partner_id) id,m.user_id FROM user_org_memberships m JOIN users u ON u.id=m.user_id WHERE m.role='admin' AND m.org_type IN ('vendor','partner') ORDER BY m.org_type,COALESCE(m.vendor_id,m.partner_id),m.id`);
    if(!owners.length)throw Error("No company Libraries");
    for(const owner of owners as Owner[]){
      const resources=buildSafetyLibraryResources(owner);const all=[...resources,...categoryHubs(owner)];
      if(!apply){results.push({kind:owner.kind,id:owner.id,resources:236,links:236});continue;}
      await client.query("BEGIN");
      try{
        await client.query("SET LOCAL lock_timeout='1500ms'");await client.query("SET LOCAL statement_timeout='30s'");
        const changed=await client.query(`INSERT INTO work_hub_form_templates(id,owner_org_type,owner_org_id,name,current_version,definition,created_by_id,library_metadata)
          SELECT r.id,$1,$2,r.name,1,r.definition,$3,r.library_metadata FROM jsonb_to_recordset($4::jsonb) AS r(id uuid,name text,definition jsonb,library_metadata jsonb)
          ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,definition=EXCLUDED.definition,library_metadata=EXCLUDED.library_metadata
          WHERE work_hub_form_templates.owner_org_type=EXCLUDED.owner_org_type AND work_hub_form_templates.owner_org_id=EXCLUDED.owner_org_id
          AND (work_hub_form_templates.library_metadata->'content' IS DISTINCT FROM EXCLUDED.library_metadata->'content' OR work_hub_form_templates.library_metadata->'safetyResource' IS DISTINCT FROM EXCLUDED.library_metadata->'safetyResource')`,[owner.kind,owner.id,owner.user_id,JSON.stringify(all)]);
        const {rows:verified}=await client.query("SELECT id,library_metadata FROM work_hub_form_templates WHERE owner_org_type=$1 AND owner_org_id=$2 AND id=ANY($3::uuid[])",[owner.kind,owner.id,resources.map(r=>r.id)]);
        if(verified.length!==236)throw Error(`Incomplete company import ${owner.kind}:${owner.id}`);
        for(const row of verified){const m=LibraryMetadataSchema.parse(row.library_metadata);const expected=resources.find(r=>r.id===row.id)!;if(JSON.stringify(m.content)!==JSON.stringify(expected.library_metadata.content)||m.safetyResource?.sourceSha256!==expected.library_metadata.safetyResource?.sourceSha256)throw Error(`Content verification failed ${row.id}`);}
        if(changed.rowCount)await client.query("INSERT INTO work_hub_audit_log(owner_org_type,owner_org_id,action,subject_type,subject_id,new_version,source,metadata) VALUES($1,$2,'library.safety_family_resources_published','library',$3,1,'system',$4::jsonb)",[owner.kind,owner.id,resources[0].id,JSON.stringify({authorization:"Add all 236 resources and link each safety requirement",sourceVersion:"1.0",families:59,resources:236,categoryDirectories:24,changed:changed.rowCount,assignmentsCreated:0,maturityCreditAwarded:0})]);
        await client.query("COMMIT");results.push({kind:owner.kind,id:owner.id,resources:236,links:236,changed:changed.rowCount});
        if(results.length%10===0)console.log(JSON.stringify({verifiedCompanies:results.length,totalCompanies:owners.length}));
      }catch(error){await client.query("ROLLBACK");throw error;}
    }
    const report={mode:apply?"apply":"dry-run",inspectedAt:new Date().toISOString(),families:59,resourcesPerCompany:236,requirementLinksPerCompany:236,companies:results.length,resourcesVerified:results.reduce((n,r)=>n+r.resources,0),changed:results.reduce((n,r)=>n+(r.changed??0),0),assignmentsCreated:0,maturityCreditAwarded:0,results};
    mkdirSync(reportRoot,{recursive:true});writeFileSync(new URL(apply?"publication.json":"dry-run.json",reportRoot),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));
  }finally{await client.end();}
}
if(process.argv[1]?.replace(/\\/g,"/").endsWith("/publish-safety-family-resources.ts"))await main();
