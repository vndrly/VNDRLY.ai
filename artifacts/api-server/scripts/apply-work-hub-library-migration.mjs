import {readFile} from "node:fs/promises";
import pg from "pg";
const url=process.env.DATABASE_URL?.trim();if(!url)throw Error("DATABASE_URL required");
const source=await readFile(new URL("../../../lib/db/drizzle/chunk_418_work_hub_library.sql",import.meta.url),"utf8");
const statements=source.split(";").map(s=>s.trim()).filter(Boolean);
if(statements.some(s=>!/^ALTER TABLE work_hub_form_(templates|instances) ADD COLUMN IF NOT EXISTS (library_metadata|bundle_definition|assignment_metadata) JSONB$/i.test(s)))throw Error("Non-additive library migration rejected");
const client=new pg.Client({connectionString:url});try{await client.connect();await client.query(source);process.stdout.write("Work Hub library additive migration passed\n");}finally{await client.end().catch(()=>{});}
