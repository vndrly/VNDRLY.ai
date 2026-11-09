import {readAdditiveCatalog,additiveCatalogProblems} from './gate-additive-catalog.mjs';
export const gateHistoryAssociationStatements = [
  'ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS gate_station_id uuid CONSTRAINT site_visits_gate_station_id_gate_stations_id_fk REFERENCES gate_stations(id)',
  'ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS gate_association_provenance jsonb',
  'ALTER TABLE ticket_check_ins ADD COLUMN IF NOT EXISTS gate_station_id uuid CONSTRAINT ticket_check_ins_gate_station_id_gate_stations_id_fk REFERENCES gate_stations(id)',
  'ALTER TABLE ticket_check_ins ADD COLUMN IF NOT EXISTS gate_association_provenance jsonb',
];

export const gateHistoryAssociationContract={
 columns:Object.fromEntries(['site_visits','ticket_check_ins'].map(table=>[table,{gate_station_id:{type:'uuid',notNull:false},gate_association_provenance:{type:'jsonb',notNull:false}}])),
 constraints:['site_visits','ticket_check_ins'].map(table=>({table,type:'f',columns:['gate_station_id'],target:'gate_stations',targetColumns:['id'],deleteAction:'a'})),
};
/** Caller retains its existing transaction. No completed table receives DDL. */
export async function migrateGateHistoryAssociations(client) {
 const before=await readAdditiveCatalog(client,gateHistoryAssociationContract);
 const problems=additiveCatalogProblems(before,gateHistoryAssociationContract);
 if(!problems.length)return {applied:false,verified:true};
 const missing=gateHistoryAssociationStatements.filter(sql=>{const [,table,column]=sql.match(/^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/);return !before.columns.some(c=>c.table_name===table&&c.name===column);});
 if(!missing.length)throw Error(`Gate history association catalog mismatch: ${problems.join(', ')}`);
 await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='30s'");
 for(const sql of missing)await client.query(sql);
 const remaining=additiveCatalogProblems(await readAdditiveCatalog(client,gateHistoryAssociationContract),gateHistoryAssociationContract);
 if(remaining.length)throw Error(`Gate history association migration postflight failed: ${remaining.join(', ')}`);
 return {applied:true,verified:true};
}
