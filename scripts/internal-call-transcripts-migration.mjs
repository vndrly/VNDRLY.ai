const columns = [
  ['vendors','call_transcription_policy','jsonb','YES'],
  ['work_hub_voicemail','transcription_state','text','NO'],
  ['work_hub_meetings','attendance_confirmation_required','boolean','NO'],
  ['work_hub_voicemail','transcription_attempts','integer','NO'],
  ['work_hub_voicemail','transcription_claim_token','uuid','YES'],
  ['work_hub_voicemail','transcription_claimed_at','timestamp with time zone','YES'],
  ['work_hub_voicemail','transcription_next_attempt_at','timestamp with time zone','YES'],
];
const inspect = client => client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('vendors','work_hub_voicemail','work_hub_meetings')");
function check(rows) {
  return columns.map(([table,column,type,nullable]) => {
    const row=rows.find(r=>r.table_name===table&&r.column_name===column);
    if(row&&(row.data_type!==type||row.is_nullable!==nullable))throw Error(`Incompatible existing column ${table}.${column}`);
    if(row&&column==='transcription_state'&&!String(row.column_default).includes("'pending'"))throw Error('Incompatible transcription state default');
    if(row&&column==='transcription_attempts'&&row.column_default!=='0')throw Error('Incompatible transcription attempts default');
    if(row&&column==='attendance_confirmation_required'&&row.column_default!=='false')throw Error('Incompatible attendance default');
    return !!row;
  });
}
export async function runInternalCallTranscriptsMigration(client,sql) {
  const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
  if(statements.length!==columns.length||statements.some((s,i)=>!s.startsWith(`ALTER TABLE ${columns[i][0]} ADD COLUMN IF NOT EXISTS ${columns[i][1]} `)))throw Error('Unexpected internal-call migration statements');
  const present=check((await inspect(client)).rows);
  for(let i=0;i<statements.length;i++)if(!present[i])await client.query(statements[i]);
  if(present.some(value=>!value)&&check((await inspect(client)).rows).some(value=>!value))throw Error('Internal-call migration verification failed');
}
