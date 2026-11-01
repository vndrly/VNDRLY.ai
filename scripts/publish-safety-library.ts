/** Original program-level resources derived from the reviewed public-source inventory. */
import "./load-env-local.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { LibraryDraftSchema, LibraryMetadataSchema } from "../lib/api-zod/src/work-hub-library";
import { MATURITY_RESOURCE_LABELS, MATURITY_RESOURCE_TYPES, maturityResourceTitle } from "../lib/api-zod/src/safety-maturity";
import { existingCompanyGoQuery, isCompanyGoFixture } from "./go-ecosphere/existing-company-identity.mjs";
const { Client } = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");
const target = new URL(process.env.DATABASE_URL ?? "");
if (!target.hostname.endsWith(".pooler.supabase.com") || target.username !== "postgres.bihjmgbdzbhcnsuhzzwo" || target.pathname !== "/postgres") throw Error("Unexpected Library database");
const root = new URL("../research/safety-program/2026-10-31/library-inventory/", import.meta.url);
const inventory = JSON.parse(readFileSync(new URL("inventory-data.json", root), "utf8"));
const sourceRegister = JSON.parse(readFileSync(new URL("source-register.json", root), "utf8"));
const items = inventory.items.map((values: unknown[]) => Object.fromEntries(inventory.schema.map((key: string, i: number) => [key, values[i]])));
const categories: Record<string, string> = { leadership: "L", hazards: "H", competence: "C", equipment: "E", learning: "I", emergency: "R" };
const stableId = (value: string) => { const h=createHash("sha256").update(value).digest("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const references = (item: any) => item.sources.map((id: string) => {
  const source=sourceRegister.sources.find((s: any)=>s.id===id);if(!source)throw Error(`Missing source ${id}`);
  return `${source.company}: ${source.title}\n${source.url}\nScope/date: ${source.scope}; ${source.date}\nEvidence limitation: ${source.limit}`;
}).join("\n\n");
const common = "Use this resource to prepare and document your company program. Select only requirements applicable to your actual services. VNDRLY reviews company-level evidence; the hiring Partner reviews job/site requirements. Valid equivalent external evidence is accepted. Completing this resource does not automatically award maturity credit or authorize hazardous work. Task procedures and specialist training must be approved by appropriately competent personnel for the actual work.";
function resource(category: string, type: string) {
  const families=items.filter((item: any)=>item.category===categories[category]);
  if(!families.length)throw Error(`Empty category ${category}`);
  const title=maturityResourceTitle(category,type);
  const description=`${MATURITY_RESOURCE_LABELS[category]}. ${common}`;
  if(type==="Program template")return LibraryDraftSchema.parse({kind:"policy",title,description,policyText:["PROGRAM TEMPLATE — adapt and approve for your company",common,"Assign a program owner. Define scope and applicable requirements. Record current procedures, worker consultation, implementation responsibilities, review dates and evidence. Review changed services and ineffective controls; retain decisions and follow-up.",...families.map((f:any)=>`${f.id}: ${f.title}\nApplicability: ${f.applicability}\nPurpose: ${f.purpose_and_oil_gas_value}\nInclude in your program: ${f.policy_scope}\nSupporting evidence: ${f.vendor_evidence}\nPublic references:\n${references(f)}`)].join("\n\n")});
  if(type==="Evidence form")return LibraryDraftSchema.parse({kind:"form",title,description,fields:[
    {id:"scope",label:"Company, services and job/site scope",type:"textarea",required:true},
    {id:"owner",label:"Accountable owner and role",type:"text",required:true},
    {id:"version",label:"Procedure / requirement version and applicable period",type:"text",required:true},
    ...families.map((f:any)=>({id:f.id,label:`${f.id}: ${f.title}`,type:"textarea",required:false})),
    {id:"evidence",label:"Evidence references, issuer, dates, validity and relevant people/assets",type:"textarea",required:true},
    {id:"observation",label:"What was actually implemented or observed, by whom and when",type:"textarea",required:true},
    {id:"gaps",label:"Gaps, corrective actions, owners and due dates; proposed exclusions with rationale",type:"textarea"},
    {id:"effectiveness",label:"Effectiveness follow-up, findings and supporting records",type:"textarea"},
  ],policyText:""});
  if(type==="Preparation training")return LibraryDraftSchema.parse({kind:"training",title,description,training:{completionMode:"both",lessons:families.map((f:any)=>({id:f.id,title:f.title,body:`${common}\n\nApplicability: ${f.applicability}\n\nLearning and assessment needed: ${f.learning_objectives_and_assessment}\n\nPrepare records covering: ${f.form_fields}\n\nEvidence to assemble: ${f.vendor_evidence}\n\nActivity: identify your applicable procedure and accountable owner; describe an implementation example; identify the evidence and competent reviewer needed to check it. Record any gaps and the next action.\n\nPublic references:\n${references(f)}`})),questions:[{id:"credit",prompt:"What earns maturity credit?",options:[{id:"review",label:"Reviewed evidence that supports the requirement and credit level"},{id:"click",label:"Opening this lesson"}],correctOptionIds:["review"]},{id:"authorization",prompt:"Does completing this preparation briefing authorize hazardous work?",options:[{id:"no",label:"No. Task-specific competence, authorization and controls are still required."},{id:"yes",label:"Yes, for every activity described."}],correctOptionIds:["no"]}]}});
  return LibraryDraftSchema.parse({kind:"policy",title,description,policyText:["EVIDENCE PREPARATION AND REVIEW GUIDE",common,"Credit progression: 0% insufficient evidence; 25% documented practice and accountable owner; 50% implementation with current records; 75% implementation checked; 100% effectiveness demonstrated through follow-up. Each level requires the previous levels. Expired evidence loses affected credit until renewed and verified.","For each submission record identity, work scope, applicable requirement, document version, validity period, reviewer, findings and follow-up. Public company examples illustrate methods; they are not evidence that your company has implemented those methods.",...families.map((f:any)=>`${f.id}: ${f.title}\nApplicable work: ${f.applicability}\nExample record contents: ${f.form_fields}\nEvidence package to submit: ${f.vendor_evidence}\nReview limitation: ${f.public_example_gap}\nReal-world references:\n${references(f)}`)].join("\n\n")});
}
const client=new Client({connectionString:target.toString()});await client.connect();
try {
 await client.query("BEGIN");await client.query("SET LOCAL lock_timeout='1500ms'");await client.query("SET LOCAL statement_timeout='20s'");
 const {rows:owners}=await client.query(existingCompanyGoQuery,[["gasgo","fieldgo","fleetgo","gatego"]]);
 if(owners.length!==4||owners.some((r:any)=>!isCompanyGoFixture(r,"Synthetic VNDRLY test company (go-ecosphere-v1). No real work, person, credential, vehicle, or payment is represented.")))throw Error("CompanyGo identity mismatch");
 const {rows:midcon}=await client.query("SELECT 'vendor' kind,id,name FROM vendors WHERE id=1054 AND name='MidCon Solutions'");if(midcon.length!==1)throw Error("MidCon identity mismatch");owners.push(midcon[0]);
 let inserted=0;
 for(const owner of owners){
  const {rows:members}=await client.query("SELECT user_id FROM user_org_memberships WHERE org_type=$1 AND role='admin' AND (CASE WHEN org_type='vendor' THEN vendor_id ELSE partner_id END)=$2 ORDER BY id LIMIT 1",[owner.kind,owner.id]);
  if(!members.length)throw Error(`No administrator for ${owner.name}`);
  for(const category of Object.keys(categories))for(const type of MATURITY_RESOURCE_TYPES){
   const content=resource(category,type);const id=stableId(`safety-library-v1:${owner.kind}:${owner.id}:${category}:${type}`);
   const metadata=LibraryMetadataSchema.parse({kind:content.kind,seriesId:id,contentVersion:1,version:1,state:"published",publishedAt:new Date().toISOString(),content});
   const result=await client.query("INSERT INTO work_hub_form_templates(id,owner_org_type,owner_org_id,name,current_version,definition,created_by_id,library_metadata) VALUES($1,$2,$3,$4,1,$5::jsonb,$6,$7::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id",[id,owner.kind,owner.id,content.title,JSON.stringify(content.fields),members[0].user_id,JSON.stringify(metadata)]);
   inserted+=result.rowCount;
   if(result.rowCount)await client.query("INSERT INTO work_hub_audit_log(owner_org_type,owner_org_id,action,subject_type,subject_id,new_version,source,metadata) VALUES($1,$2,'library.safety_resources_published','library',$3,1,'system',$4::jsonb)",[owner.kind,owner.id,id,JSON.stringify({authorization:"John requested supporting safety Library resources",script:"publish-safety-library.ts",category,resourceType:type,sourceInventory:"2026-10-31",assignmentsCreated:0,scoreCreditAwarded:0})]);
  }
 }
 console.log(JSON.stringify({mode:process.argv.includes("--apply")?"apply":"dry-run",companies:owners.map((o:any)=>o.name),resourcesPerCompany:24,inserted,assignmentsCreated:0,scoreCreditAwarded:0}));
 await client.query(process.argv.includes("--apply")?"COMMIT":"ROLLBACK");
}catch(error){await client.query("ROLLBACK");throw error;}finally{await client.end();}
