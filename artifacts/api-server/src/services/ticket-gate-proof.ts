import { pool } from "@workspace/db";
import { canReadTicket } from "../lib/field-ticket-access";
import type { SessionPayload } from "../lib/session";
export async function readTicketGateProof(
  session: SessionPayload | null,
  ticketId: number,
) {
  if (!session?.userId || !(await canReadTicket(session, ticketId)))
    return null;
  const result = await pool.query(
    `SELECT v.id,v.site_location_id AS "siteId",s.name AS "siteName",g.name AS "gateName",v.check_in_time AS "checkInTime",v.check_out_time AS "checkOutTime",v.admission_status AS "admissionStatus",v.gate_capture AS capture,v.check_in_gps_evidence AS "entryGps",v.check_out_gps_evidence AS "exitGps"
 FROM site_visits v JOIN site_locations s ON s.id=v.site_location_id LEFT JOIN gate_stations g ON g.id=v.gate_station_id
 WHERE v.gate_capture->>'ticketId'=$1 ORDER BY v.check_in_time,v.id`,
    [String(ticketId)],
  );
  return { ticketId, visits: result.rows };
}
