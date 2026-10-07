import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { ObjectStore, StoredObject } from "../lib/objectStore";
import type { SessionPayload } from "../lib/session";
import { createTicketPhotoService, ownedTicketPhoto } from "./ticket-photo-association";
function fixture() {
  let prior:any=null,notes=0,status="in_progress",authorized=true;
  const path="/objects/uploads/"+randomUUID();
  const object:StoredObject={contentType:"image/png",size:8,body:Buffer.from([137,80,78,71,13,10,26,10]),acl:{owner:"3",visibility:"private"}};
  const query=vi.fn(async(sql:string,args:any[]=[])=>{
    if(sql.includes("SELECT id,status FROM tickets"))return{rows:[{id:42,status}]};
    if(sql.includes("SELECT user_id,tool_input"))return{rows:prior?[prior]:[]};
    if(sql.includes("INSERT INTO ticket_note_logs")){notes++;return{rows:[{id:9}]};}
    if(sql.includes("INSERT INTO assistant_action_audit")){prior={user_id:args[0],tool_input:JSON.parse(args[5]),tool_output:JSON.parse(args[6])};}
    if(sql.includes("SELECT id FROM ticket_note_logs"))return{rows:[{id:9}]};
    return{rows:[]};
  });
  const store={getObject:vi.fn(async()=>object)} as unknown as ObjectStore;
  const service=createTicketPhotoService({connect:async()=>({query,release:vi.fn()}) as unknown as PoolClient} as Pick<Pool,"connect">,()=>store,async()=>{if(!authorized)throw Error("revoked");});
  const session={userId:3,role:"field_employee",sv:1} as SessionPayload,body={operationId:randomUUID(),objectPath:path};
  return{service,session,body,object,query,store,get notes(){return notes},set status(v:string){status=v},set authorized(v:boolean){authorized=v}};
}
it("atomically saves one note and exact receipt, then returns original note on identical retry",async()=>{const f=fixture(),first=await f.service.associate(f.session,42,f.body);expect(await f.service.associate(f.session,42,f.body)).toEqual(first);expect(await f.service.read(f.session,42,f.body.operationId)).toEqual(first);expect(f.notes).toBe(1);expect(first).toMatchObject({noteId:9,ticketId:42,status:"applied",physicalCaptureVerified:false});expect(f.query.mock.calls.some(([s])=>s.includes("pg_advisory_xact_lock"))).toBe(true);});
it("rejects reused operation with changed ticket/path/actor or changed actual bytes",async()=>{const f=fixture();await f.service.associate(f.session,42,f.body);await expect(f.service.associate(f.session,43,f.body)).rejects.toThrow("operation_conflict");await expect(f.service.associate(f.session,42,{...f.body,objectPath:"/objects/uploads/"+randomUUID()})).rejects.toThrow("operation_conflict");await expect(f.service.associate({...f.session,userId:4},42,f.body)).rejects.toThrow("operation_conflict");f.object.body=Buffer.concat([f.object.body,Buffer.from([1])]);f.object.size++;await expect(f.service.associate(f.session,42,f.body)).rejects.toThrow("operation_conflict");expect(f.notes).toBe(1);});
it("rechecks revoked authority, mutable status and actual owned private upload on replay",async()=>{const f=fixture();await f.service.associate(f.session,42,f.body);f.authorized=false;await expect(f.service.associate(f.session,42,f.body)).rejects.toThrow("revoked");f.authorized=true;f.status="submitted";await expect(f.service.read(f.session,42,f.body.operationId)).rejects.toThrow("not_editable");f.status="in_progress";f.object.acl!.owner="4";await expect(f.service.read(f.session,42,f.body.operationId)).rejects.toThrow("not_owned");expect(f.notes).toBe(1);});
it("refuses public/foreign/purpose-reserved/malformed/nonimage uploads before inserting",async()=>{const f=fixture();for(const acl of [{owner:"4",visibility:"private"},{owner:"3",visibility:"public"},{owner:"3",visibility:"private",purpose:"fleet-evidence"}]){f.object.acl=acl as StoredObject["acl"];await expect(f.service.associate(f.session,42,f.body)).rejects.toThrow("not_owned");}f.object.acl={owner:"3",visibility:"private"};f.object.contentType="image/jpeg";await expect(f.service.associate(f.session,42,f.body)).rejects.toThrow("invalid");await expect(ownedTicketPhoto(3,"/objects/fleet/secret",f.store)).rejects.toThrow("invalid");expect(f.notes).toBe(0);});
