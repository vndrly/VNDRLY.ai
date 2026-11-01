import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInternalCallTranscriptsMigration} from '../internal-call-transcripts-migration.mjs';
const sql=readFileSync(new URL('../../lib/db/drizzle/chunk_415_internal_call_transcripts.sql',import.meta.url),'utf8');
const rows=[['vendors','call_transcription_policy','jsonb','YES',null],['work_hub_voicemail','transcription_state','text','NO',"'pending'::text"],['work_hub_meetings','attendance_confirmation_required','boolean','NO','false'],['work_hub_voicemail','transcription_attempts','integer','NO','0'],['work_hub_voicemail','transcription_claim_token','uuid','YES',null],['work_hub_voicemail','transcription_claimed_at','timestamp with time zone','YES',null],['work_hub_voicemail','transcription_next_attempt_at','timestamp with time zone','YES',null]].map(([table_name,column_name,data_type,is_nullable,column_default])=>({table_name,column_name,data_type,is_nullable,column_default}));
test('already applied columns use read-only preflight and acquire no DDL locks',async()=>{
 let reads=0;await runInternalCallTranscriptsMigration({query:async q=>{assert.ok(q.startsWith('SELECT'));reads++;return{rows};}},sql);assert.equal(reads,1);
});
test('only missing columns are added and then verified',async()=>{
 const calls=[];await runInternalCallTranscriptsMigration({query:async q=>{calls.push(q);return{rows:calls.length===1?rows.slice(1):rows};}},sql);
 assert.equal(calls.length,3);assert.match(calls[1],/^ALTER TABLE vendors ADD COLUMN IF NOT EXISTS call_transcription_policy jsonb$/);
});
test('wrong types fail instead of masking drift or rewriting data',async()=>{
 await assert.rejects(runInternalCallTranscriptsMigration({query:async()=>({rows:[{...rows[0],data_type:'text'},...rows.slice(1)]})},sql),/Incompatible/);
});
