import {useQuery}from'@tanstack/react-query';
import {useAuth}from'@/hooks/use-auth';
import {z}from'zod/v4';
const catalogSchema=z.object({courses:z.array(z.object({id:z.string(),trainingItemId:z.string().nullable()}))});
const credentialSchema=z.object({credentials:z.array(z.object({courseSha256:z.string(),contentVersion:z.number(),passedAt:z.string(),score:z.number()}))});
export default function EnergySafetyCore(){
 const{user}=useAuth();
 const result=useQuery({queryKey:['energy-safety-core',user?.userId,user?.activeMembershipId,user?.vendorId,user?.partnerId],enabled:!!user,queryFn:async()=>{
  const get=async(path:string)=>{const r=await fetch(path,{credentials:'include'});if(!r.ok)throw Error('Energy Safety Core unavailable');const value=await r.json();return value.data??value;};
  const[catalog,personal]=await Promise.all([get('/api/safety/training-catalog?familyId=G99'),get('/api/work-hub/library/personal-energy-safety-credentials')]);
  return{itemId:catalogSchema.parse(catalog).courses.find(c=>c.id==='G99')?.trainingItemId,credentials:credentialSchema.parse(personal).credentials};
 }});
 if(result.isError)return <p role="alert">Energy Safety Core is temporarily unavailable. Your existing training records remain available in Work Hub.</p>;
 if(!result.data?.itemId)return null;
 return <section className="space-y-3 rounded-xl border-2 border-[var(--brand-primary)] bg-card p-5 text-foreground" aria-label="VNDRLY Energy Safety Core">
  <h2 className="text-xl font-bold">VNDRLY Energy Safety Core</h2>
  <p>Complete onshore safety lessons, 22 worked scenarios and 48 explained learning checks, followed by a separate 40-question certification exam.</p>
  <p>Optional references include the 42-objective PEC benchmark crosswalk and 68 OSHA and applicability entries. They are outside the required learning path. No evidence upload, independent assessor or blanket practical evaluation is required for online completion.</p>
  <a className="font-semibold underline" href={`/work-hub/library/${result.data.itemId}`}>Open Energy Safety Core</a>
  <p>VNDRLY internal knowledge credential. No external accreditation or universal operator acceptance is claimed.</p>
  {!!result.data.credentials.length&&<div className="border-t pt-3"><h3 className="font-semibold">Your portable Energy Safety Core record</h3>{result.data.credentials.map((c,i)=><p key={`${c.courseSha256}:${c.passedAt}:${i}`}>Version {c.contentVersion} · Exam passed {c.score.toFixed(1)}% · {new Date(c.passedAt).toLocaleDateString()}. Your earned record stays with your VNDRLY user across company changes.</p>)}</div>}
 </section>;
}
