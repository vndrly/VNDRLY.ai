export const gateHistoryAssociationStatements = [
  'ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS gate_station_id uuid CONSTRAINT site_visits_gate_station_id_gate_stations_id_fk REFERENCES gate_stations(id)',
  'ALTER TABLE site_visits ADD COLUMN IF NOT EXISTS gate_association_provenance jsonb',
  'ALTER TABLE ticket_check_ins ADD COLUMN IF NOT EXISTS gate_station_id uuid CONSTRAINT ticket_check_ins_gate_station_id_gate_stations_id_fk REFERENCES gate_stations(id)',
  'ALTER TABLE ticket_check_ins ADD COLUMN IF NOT EXISTS gate_association_provenance jsonb',
];

/** Additive only. Nullable fields leave existing records and GPS evidence intact. */
export async function migrateGateHistoryAssociations(client) {
  for (const sql of gateHistoryAssociationStatements) await client.query(sql);
}
