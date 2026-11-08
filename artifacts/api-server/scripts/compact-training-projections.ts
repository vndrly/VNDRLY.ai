import{db,pool}from'@workspace/db';import{sql}from'drizzle-orm';
import{encodeTrainingProjection,decodeTrainingProjection}from'../src/work-hub/stored-training-projections';
import assert from'node:assert/strict';
try{
 const keys=await db.execute(sql`SELECT projection_key FROM training_read_projections WHERE payload->>'encoding' IS DISTINCT FROM 'gzip-json-v1'`);
 let count=0,before=0,after=0;
 for(const key of keys.rows){
 const rows=await db.execute(sql`SELECT payload,computed_at FROM training_read_projections WHERE projection_key=${String(key.projection_key)}`);
 const row=rows.rows[0];if(!row)continue;
 const encoded=encodeTrainingProjection(row.payload);assert.deepEqual(decodeTrainingProjection(encoded),row.payload);
 const saved=await db.execute(sql`UPDATE training_read_projections SET payload=${JSON.stringify(encoded)}::jsonb WHERE projection_key=${String(key.projection_key)} AND computed_at=${row.computed_at as Date} RETURNING projection_key`);
 if(saved.rows.length){count++;before+=JSON.stringify(row.payload).length;after+=JSON.stringify(encoded).length;}
 }
 console.log({compacted:count,beforeBytes:before,afterBytes:after});
}finally{await pool.end();}
