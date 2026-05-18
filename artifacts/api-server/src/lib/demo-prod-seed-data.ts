// Auto-generated demo data captured from the dev DB.
// DO NOT EDIT BY HAND. Re-run scripts/capture-demo-prod-seed.sh to refresh.
//
// Used exclusively by the one-shot POST /api/demo/seed-prod-demo endpoint
// to additively populate a fresh production database with the demo
// lifecycle tickets. Token-gated, idempotent, no DELETE/UPDATE of
// non-demo rows.

export interface DemoTicket {
  _dev_id: number;
  site_location_id: number;
  vendor_id: number;
  field_employee_id: number | null;
  work_type_id: number;
  status: string;
  description: string;
  notes: string | null;
  kickback_reason: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  check_in_latitude: number | null;
  check_in_longitude: number | null;
  check_out_latitude: number | null;
  check_out_longitude: number | null;
  created_at: string;
  updated_at: string;
  unlocked_at: string | null;
  unlocked_by_id: number | null;
  unlock_count: number;
  lifecycle_state: string | null;
  en_route_at: string | null;
  arrived_at: string | null;
  departure_latitude: number | null;
  departure_longitude: number | null;
  created_by_id: number | null;
  closed_by_id: number | null;
  pre_cancel_status: string | null;
  cancelled_at: string | null;
  cancelled_by_id: number | null;
  scheduled_start_at: string | null;
  scheduled_duration_minutes: number | null;
  foreman_user_id: number | null;
  scheduled_at: string | null;
  scheduled_by_id: number | null;
  late_check_in_reminder_sent_at: string | null;
  approved_at: string | null;
  intake_channel: string;
  payment_method: string | null;
  payment_reference: string | null;
  payment_dispersed_at: string | null;
  payment_dispersed_by_id: number | null;
  payment_note: string | null;
}

export interface DemoStatusHistoryRow {
  ticket_id: number; // dev id, mapped to prod id at insert time
  from_status: string | null;
  to_status: string;
  actor_user_id: number | null; // dev id, mapped to prod via DEV_USERID_TO_USERNAME
  actor_role: string | null;
  reason: string | null;
  created_at: string;
}

export interface DemoCheckInRow {
  ticket_id: number;
  employee_id: number; // vendor_people.id (stable)
  check_in_at: string;
  check_in_latitude: number | null;
  check_in_longitude: number | null;
  check_out_at: string | null;
  check_out_latitude: number | null;
  check_out_longitude: number | null;
  hourly_rate_at_time: number | null;
  source: string;
  corrected_by_id: number | null;
  corrected_reason: string | null;
  created_at: string;
}

export interface DemoGpsLogRow {
  ticket_id: number;
  latitude: number;
  longitude: number;
  event_type: string;
  recorded_at: string;
  battery_level: number | null;
  speed_mps: number | null;
}

export interface DemoSwaRow {
  site_location_id: number;
  work_type_id: number;
  vendor_id: number;
  afe: string | null;
}

// Maps a dev users.id to the canonical username it represents in prod.
// New demo logins (winchester/baker/mach) get auto-assigned ids in prod
// that won't match dev, so all FK references are resolved by username
// at insert time.
export const DEV_USERID_TO_USERNAME: Record<number, string> = {
  1: "admin",
  2: "exxon",
  5: "winchester",            // dev "winchester@vndrly.com" -> prod "winchester"
  9: "matt@elerick.com",
  10: "joe.boggs@winchester.com",
  327: "mach",                // dev "mach@vndrly.com" -> prod "mach"
  341: "baker",
  343: "daniel",
};

export const DEMO_TICKETS: DemoTicket[] = [
  {
    "site_location_id": 1,
    "vendor_id": 3,
    "field_employee_id": null,
    "work_type_id": 9,
    "status": "awaiting_acceptance",
    "description": "Surface pump down \u2014 needs replacement of mechanical seal and full bearing pack.",
    "notes": null,
    "kickback_reason": null,
    "check_in_time": null,
    "check_out_time": null,
    "check_in_latitude": null,
    "check_in_longitude": null,
    "check_out_latitude": null,
    "check_out_longitude": null,
    "created_at": "2026-04-29T13:58:53.85733+00:00",
    "updated_at": "2026-04-29T18:00:57.521412+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "pending_arrival",
    "en_route_at": null,
    "arrived_at": null,
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 2,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-30T17:58:53.85733+00:00",
    "scheduled_duration_minutes": 240,
    "foreman_user_id": null,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "partner_self_service",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 120
  },
  {
    "site_location_id": 4,
    "vendor_id": 3,
    "field_employee_id": 4,
    "work_type_id": 5,
    "status": "initiated",
    "description": "Perforating run on the 8.5\" production string \u2014 3 zones, 6 SPF charges loaded.",
    "notes": null,
    "kickback_reason": null,
    "check_in_time": null,
    "check_out_time": null,
    "check_in_latitude": null,
    "check_in_longitude": null,
    "check_out_latitude": null,
    "check_out_longitude": null,
    "created_at": "2026-04-29T15:58:53.85733+00:00",
    "updated_at": "2026-04-29T18:00:57.521412+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "en_route",
    "en_route_at": "2026-04-29T17:23:53.85733+00:00",
    "arrived_at": null,
    "departure_latitude": 35.45,
    "departure_longitude": -97.4,
    "created_by_id": 5,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-29T16:58:53.85733+00:00",
    "scheduled_duration_minutes": 360,
    "foreman_user_id": 10,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "office_on_behalf_of_field_employee",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 121
  },
  {
    "site_location_id": 4,
    "vendor_id": 3,
    "field_employee_id": 5,
    "work_type_id": 9,
    "status": "pending_review",
    "description": "Replace down-hole pump on Well #14 lift unit.",
    "notes": "Pump pulled, new pump set at 4,200 ft. Pressure-tested OK. Awaiting reviewer signoff.",
    "kickback_reason": null,
    "check_in_time": "2026-04-29T11:28:53.85733+00:00",
    "check_out_time": "2026-04-29T16:58:53.85733+00:00",
    "check_in_latitude": 35.5382,
    "check_in_longitude": -97.2788,
    "check_out_latitude": 35.5382,
    "check_out_longitude": -97.2788,
    "created_at": "2026-04-29T09:58:53.85733+00:00",
    "updated_at": "2026-04-29T18:00:57.521412+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "off_site",
    "en_route_at": "2026-04-29T10:58:53.85733+00:00",
    "arrived_at": "2026-04-29T11:28:53.85733+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 9,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-29T09:58:53.85733+00:00",
    "scheduled_duration_minutes": 360,
    "foreman_user_id": 9,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "vendor_field_self_service",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 122
  },
  {
    "site_location_id": 4,
    "vendor_id": 3,
    "field_employee_id": 5,
    "work_type_id": 13,
    "status": "kicked_back",
    "description": "Wireline run at Jones Southside \u2014 gauge log + production survey.",
    "notes": "Initial submit kicked back by Exxon AP for hour reconciliation.",
    "kickback_reason": "Hour totals on the line items don't match the GPS check-in/out window \u2014 please re-verify before resubmit.",
    "check_in_time": "2026-04-27T11:58:53.85733+00:00",
    "check_out_time": "2026-04-27T16:58:53.85733+00:00",
    "check_in_latitude": 35.5382,
    "check_in_longitude": -97.2788,
    "check_out_latitude": 35.5382,
    "check_out_longitude": -97.2788,
    "created_at": "2026-04-27T09:58:53.85733+00:00",
    "updated_at": "2026-04-28T17:58:53.85733+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": null,
    "en_route_at": "2026-04-27T10:58:53.85733+00:00",
    "arrived_at": "2026-04-27T11:58:53.85733+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 5,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-27T10:58:53.85733+00:00",
    "scheduled_duration_minutes": 300,
    "foreman_user_id": 9,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "office_on_behalf_of_field_employee",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 123
  },
  {
    "site_location_id": 1,
    "vendor_id": 3,
    "field_employee_id": 4,
    "work_type_id": 11,
    "status": "awaiting_payment",
    "description": "Hot oil treatment \u2014 paraffin cut on tubing, 80 bbl heated treatment.",
    "notes": "Approved by Exxon ops \u2014 sitting in AP queue.",
    "kickback_reason": null,
    "check_in_time": "2026-04-24T09:58:53.85733+00:00",
    "check_out_time": "2026-04-24T15:58:53.85733+00:00",
    "check_in_latitude": 31.9973,
    "check_in_longitude": -102.0779,
    "check_out_latitude": 31.9973,
    "check_out_longitude": -102.0779,
    "created_at": "2026-04-24T07:58:53.85733+00:00",
    "updated_at": "2026-04-28T17:58:53.85733+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": null,
    "en_route_at": "2026-04-24T08:58:53.85733+00:00",
    "arrived_at": "2026-04-24T09:58:53.85733+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 5,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-24T08:58:53.85733+00:00",
    "scheduled_duration_minutes": 360,
    "foreman_user_id": 10,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": "2026-04-28T17:58:53.85733+00:00",
    "intake_channel": "office_on_behalf_of_field_employee",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 124
  },
  {
    "site_location_id": 2,
    "vendor_id": 2,
    "field_employee_id": null,
    "work_type_id": 4,
    "status": "awaiting_acceptance",
    "description": "Surface casing cement job \u2014 9-5/8\" string to 1,200 ft. Full returns expected.",
    "notes": null,
    "kickback_reason": null,
    "check_in_time": null,
    "check_out_time": null,
    "check_in_latitude": null,
    "check_in_longitude": null,
    "check_out_latitude": null,
    "check_out_longitude": null,
    "created_at": "2026-04-29T12:00:02.164786+00:00",
    "updated_at": "2026-04-29T18:00:02.164786+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "pending_arrival",
    "en_route_at": null,
    "arrived_at": null,
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 2,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-05-01T18:00:02.164786+00:00",
    "scheduled_duration_minutes": 480,
    "foreman_user_id": null,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "partner_self_service",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 125
  },
  {
    "site_location_id": 1,
    "vendor_id": 2,
    "field_employee_id": 11,
    "work_type_id": 19,
    "status": "in_progress",
    "description": "Quarterly site safety inspection \u2014 wellhead, BOP visuals, H2S monitor calibration check.",
    "notes": null,
    "kickback_reason": null,
    "check_in_time": "2026-04-29T16:15:02.164786+00:00",
    "check_out_time": null,
    "check_in_latitude": 31.9973,
    "check_in_longitude": -102.0779,
    "check_out_latitude": null,
    "check_out_longitude": null,
    "created_at": "2026-04-29T15:00:02.164786+00:00",
    "updated_at": "2026-04-29T16:15:02.164786+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "on_site",
    "en_route_at": "2026-04-29T15:30:02.164786+00:00",
    "arrived_at": "2026-04-29T16:15:02.164786+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 343,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-29T15:00:02.164786+00:00",
    "scheduled_duration_minutes": 240,
    "foreman_user_id": 343,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "vendor_field_self_service",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 126
  },
  {
    "site_location_id": 1,
    "vendor_id": 2,
    "field_employee_id": 3,
    "work_type_id": 4,
    "status": "submitted",
    "description": "Production casing cement squeeze on lower zone \u2014 12 bbl Class H slurry.",
    "notes": "Job complete, returns at surface, WOC 6h. Submitted to Exxon for review.",
    "kickback_reason": null,
    "check_in_time": "2026-04-28T10:00:02.164786+00:00",
    "check_out_time": "2026-04-28T22:00:02.164786+00:00",
    "check_in_latitude": 31.9973,
    "check_in_longitude": -102.0779,
    "check_out_latitude": 31.9973,
    "check_out_longitude": -102.0779,
    "created_at": "2026-04-28T08:00:02.164786+00:00",
    "updated_at": "2026-04-29T18:00:57.521412+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "off_site",
    "en_route_at": "2026-04-28T09:00:02.164786+00:00",
    "arrived_at": "2026-04-28T10:00:02.164786+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 341,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-28T09:00:02.164786+00:00",
    "scheduled_duration_minutes": 720,
    "foreman_user_id": 341,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "office_on_behalf_of_field_employee",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 127
  },
  {
    "site_location_id": 1,
    "vendor_id": 2,
    "field_employee_id": 12,
    "work_type_id": 13,
    "status": "approved",
    "description": "Wireline gauge run + memory tool retrieval on the lateral.",
    "notes": null,
    "kickback_reason": null,
    "check_in_time": "2026-04-26T10:00:02.164786+00:00",
    "check_out_time": "2026-04-26T16:00:02.164786+00:00",
    "check_in_latitude": 31.9973,
    "check_in_longitude": -102.0779,
    "check_out_latitude": 31.9973,
    "check_out_longitude": -102.0779,
    "created_at": "2026-04-26T08:00:02.164786+00:00",
    "updated_at": "2026-04-29T14:00:02.164786+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": null,
    "en_route_at": "2026-04-26T09:00:02.164786+00:00",
    "arrived_at": "2026-04-26T10:00:02.164786+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 341,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-26T09:00:02.164786+00:00",
    "scheduled_duration_minutes": 360,
    "foreman_user_id": 341,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": "2026-04-29T14:00:02.164786+00:00",
    "intake_channel": "office_on_behalf_of_field_employee",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 128
  },
  {
    "site_location_id": 5,
    "vendor_id": 3,
    "field_employee_id": null,
    "work_type_id": 9,
    "status": "initiated",
    "description": "ESP failure on STACK well \u2014 pull and replace surface VFD plus check downhole MLE splice.",
    "notes": null,
    "kickback_reason": null,
    "check_in_time": null,
    "check_out_time": null,
    "check_in_latitude": null,
    "check_in_longitude": null,
    "check_out_latitude": null,
    "check_out_longitude": null,
    "created_at": "2026-04-29T15:00:02.164786+00:00",
    "updated_at": "2026-04-29T18:00:02.164786+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "pending_arrival",
    "en_route_at": null,
    "arrived_at": null,
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 327,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-29T22:00:02.164786+00:00",
    "scheduled_duration_minutes": 600,
    "foreman_user_id": null,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "office_on_behalf_of_partner",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 129
  },
  {
    "site_location_id": 6,
    "vendor_id": 3,
    "field_employee_id": 4,
    "work_type_id": 5,
    "status": "in_progress",
    "description": "Perforating run on Stage 7 \u2014 4-3/4\" guns, big-hole charges.",
    "notes": null,
    "kickback_reason": null,
    "check_in_time": "2026-04-29T15:15:02.164786+00:00",
    "check_out_time": null,
    "check_in_latitude": 35.541,
    "check_in_longitude": -97.987,
    "check_out_latitude": null,
    "check_out_longitude": null,
    "created_at": "2026-04-29T14:00:02.164786+00:00",
    "updated_at": "2026-04-29T18:00:57.521412+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "on_site",
    "en_route_at": "2026-04-29T14:30:02.164786+00:00",
    "arrived_at": "2026-04-29T15:15:02.164786+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 5,
    "closed_by_id": 10,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-29T14:00:02.164786+00:00",
    "scheduled_duration_minutes": 360,
    "foreman_user_id": 10,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "office_on_behalf_of_field_employee",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 130
  },
  {
    "site_location_id": 12,
    "vendor_id": 3,
    "field_employee_id": 5,
    "work_type_id": 9,
    "status": "submitted",
    "description": "SCOOP well \u2014 replace failed downhole pump assembly.",
    "notes": "Pulled rods, replaced pump (P-32), re-spaced. Production back online before checkout. Submitted to Mach.",
    "kickback_reason": null,
    "check_in_time": "2026-04-27T10:00:02.164786+00:00",
    "check_out_time": "2026-04-27T16:00:02.164786+00:00",
    "check_in_latitude": 34.706,
    "check_in_longitude": -97.31,
    "check_out_latitude": 34.706,
    "check_out_longitude": -97.31,
    "created_at": "2026-04-27T08:00:02.164786+00:00",
    "updated_at": "2026-04-29T18:00:57.521412+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": "off_site",
    "en_route_at": "2026-04-27T09:00:02.164786+00:00",
    "arrived_at": "2026-04-27T10:00:02.164786+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 5,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-27T09:00:02.164786+00:00",
    "scheduled_duration_minutes": 360,
    "foreman_user_id": 9,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": null,
    "intake_channel": "office_on_behalf_of_field_employee",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 131
  },
  {
    "site_location_id": 13,
    "vendor_id": 3,
    "field_employee_id": 4,
    "work_type_id": 13,
    "status": "approved",
    "description": "Wireline production logging tool run on dual-zone completion.",
    "notes": null,
    "kickback_reason": null,
    "check_in_time": "2026-04-25T10:00:02.164786+00:00",
    "check_out_time": "2026-04-25T16:00:02.164786+00:00",
    "check_in_latitude": 34.479,
    "check_in_longitude": -97.853,
    "check_out_latitude": 34.479,
    "check_out_longitude": -97.853,
    "created_at": "2026-04-25T08:00:02.164786+00:00",
    "updated_at": "2026-04-29T12:00:02.164786+00:00",
    "unlocked_at": null,
    "unlocked_by_id": null,
    "unlock_count": 0,
    "lifecycle_state": null,
    "en_route_at": "2026-04-25T09:00:02.164786+00:00",
    "arrived_at": "2026-04-25T10:00:02.164786+00:00",
    "departure_latitude": null,
    "departure_longitude": null,
    "created_by_id": 5,
    "closed_by_id": null,
    "pre_cancel_status": null,
    "cancelled_at": null,
    "cancelled_by_id": null,
    "scheduled_start_at": "2026-04-25T09:00:02.164786+00:00",
    "scheduled_duration_minutes": 360,
    "foreman_user_id": 10,
    "scheduled_at": null,
    "scheduled_by_id": null,
    "late_check_in_reminder_sent_at": null,
    "approved_at": "2026-04-29T12:00:02.164786+00:00",
    "intake_channel": "office_on_behalf_of_field_employee",
    "payment_method": null,
    "payment_reference": null,
    "payment_dispersed_at": null,
    "payment_dispersed_by_id": null,
    "payment_note": null,
    "_dev_id": 132
  }
];

export const DEMO_STATUS_HISTORY: DemoStatusHistoryRow[] = [
  {
    "ticket_id": 120,
    "from_status": null,
    "to_status": "awaiting_acceptance",
    "actor_user_id": 2,
    "actor_role": "partner",
    "reason": "partner self-service ticket created \u2014 invited Winchester",
    "created_at": "2026-04-29T13:58:53.85733+00:00"
  },
  {
    "ticket_id": 121,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "office assigned Joe Boggs",
    "created_at": "2026-04-29T15:58:53.85733+00:00"
  },
  {
    "ticket_id": 121,
    "from_status": "initiated",
    "to_status": "initiated",
    "actor_user_id": 10,
    "actor_role": "field_employee",
    "reason": "en route",
    "created_at": "2026-04-29T17:23:53.85733+00:00"
  },
  {
    "ticket_id": 122,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 9,
    "actor_role": "field_employee",
    "reason": "field self-create",
    "created_at": "2026-04-29T09:58:53.85733+00:00"
  },
  {
    "ticket_id": 122,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 9,
    "actor_role": "field_employee",
    "reason": "check-in",
    "created_at": "2026-04-29T11:28:53.85733+00:00"
  },
  {
    "ticket_id": 122,
    "from_status": "in_progress",
    "to_status": "pending_review",
    "actor_user_id": 9,
    "actor_role": "field_employee",
    "reason": "check-out \u2014 awaiting review",
    "created_at": "2026-04-29T16:58:53.85733+00:00"
  },
  {
    "ticket_id": 123,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "office assigned Matt Elerick",
    "created_at": "2026-04-27T09:58:53.85733+00:00"
  },
  {
    "ticket_id": 123,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 9,
    "actor_role": "field_employee",
    "reason": "check-in",
    "created_at": "2026-04-27T11:58:53.85733+00:00"
  },
  {
    "ticket_id": 123,
    "from_status": "in_progress",
    "to_status": "pending_review",
    "actor_user_id": 9,
    "actor_role": "field_employee",
    "reason": "check-out",
    "created_at": "2026-04-27T16:58:53.85733+00:00"
  },
  {
    "ticket_id": 123,
    "from_status": "pending_review",
    "to_status": "submitted",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "office submitted to partner",
    "created_at": "2026-04-27T23:58:53.85733+00:00"
  },
  {
    "ticket_id": 123,
    "from_status": "submitted",
    "to_status": "kicked_back",
    "actor_user_id": 2,
    "actor_role": "partner",
    "reason": "hours don't match GPS window",
    "created_at": "2026-04-28T17:58:53.85733+00:00"
  },
  {
    "ticket_id": 124,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "office created + assigned",
    "created_at": "2026-04-24T07:58:53.85733+00:00"
  },
  {
    "ticket_id": 124,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 10,
    "actor_role": "field_employee",
    "reason": "check-in",
    "created_at": "2026-04-24T09:58:53.85733+00:00"
  },
  {
    "ticket_id": 124,
    "from_status": "in_progress",
    "to_status": "pending_review",
    "actor_user_id": 10,
    "actor_role": "field_employee",
    "reason": "check-out",
    "created_at": "2026-04-24T15:58:53.85733+00:00"
  },
  {
    "ticket_id": 124,
    "from_status": "pending_review",
    "to_status": "submitted",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "submitted to partner",
    "created_at": "2026-04-25T17:58:53.85733+00:00"
  },
  {
    "ticket_id": 124,
    "from_status": "submitted",
    "to_status": "approved",
    "actor_user_id": 2,
    "actor_role": "partner",
    "reason": "partner approved",
    "created_at": "2026-04-28T17:58:53.85733+00:00"
  },
  {
    "ticket_id": 124,
    "from_status": "approved",
    "to_status": "awaiting_payment",
    "actor_user_id": 2,
    "actor_role": "partner",
    "reason": "queued for AP",
    "created_at": "2026-04-28T17:58:53.85733+00:00"
  },
  {
    "ticket_id": 125,
    "from_status": null,
    "to_status": "awaiting_acceptance",
    "actor_user_id": 2,
    "actor_role": "partner",
    "reason": "partner self-service ticket \u2014 invited Baker Hughes",
    "created_at": "2026-04-29T12:00:02.164786+00:00"
  },
  {
    "ticket_id": 126,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 343,
    "actor_role": "field_employee",
    "reason": "field self-create",
    "created_at": "2026-04-29T15:00:02.164786+00:00"
  },
  {
    "ticket_id": 126,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 343,
    "actor_role": "field_employee",
    "reason": "check-in",
    "created_at": "2026-04-29T16:15:02.164786+00:00"
  },
  {
    "ticket_id": 127,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 341,
    "actor_role": "vendor",
    "reason": "office created + assigned Amy Nguyen",
    "created_at": "2026-04-28T08:00:02.164786+00:00"
  },
  {
    "ticket_id": 127,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 341,
    "actor_role": "vendor",
    "reason": "check-in",
    "created_at": "2026-04-28T10:00:02.164786+00:00"
  },
  {
    "ticket_id": 127,
    "from_status": "in_progress",
    "to_status": "pending_review",
    "actor_user_id": 341,
    "actor_role": "vendor",
    "reason": "check-out",
    "created_at": "2026-04-28T22:00:02.164786+00:00"
  },
  {
    "ticket_id": 127,
    "from_status": "pending_review",
    "to_status": "submitted",
    "actor_user_id": 341,
    "actor_role": "vendor",
    "reason": "office submitted to partner",
    "created_at": "2026-04-29T00:00:02.164786+00:00"
  },
  {
    "ticket_id": 128,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 341,
    "actor_role": "vendor",
    "reason": "office created + assigned Ryan Foster",
    "created_at": "2026-04-26T08:00:02.164786+00:00"
  },
  {
    "ticket_id": 128,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 341,
    "actor_role": "vendor",
    "reason": "check-in",
    "created_at": "2026-04-26T10:00:02.164786+00:00"
  },
  {
    "ticket_id": 128,
    "from_status": "in_progress",
    "to_status": "pending_review",
    "actor_user_id": 341,
    "actor_role": "vendor",
    "reason": "check-out",
    "created_at": "2026-04-26T16:00:02.164786+00:00"
  },
  {
    "ticket_id": 128,
    "from_status": "pending_review",
    "to_status": "submitted",
    "actor_user_id": 341,
    "actor_role": "vendor",
    "reason": "submitted to partner",
    "created_at": "2026-04-27T12:00:02.164786+00:00"
  },
  {
    "ticket_id": 128,
    "from_status": "submitted",
    "to_status": "approved",
    "actor_user_id": 2,
    "actor_role": "partner",
    "reason": "partner approved",
    "created_at": "2026-04-29T14:00:02.164786+00:00"
  },
  {
    "ticket_id": 129,
    "from_status": null,
    "to_status": "awaiting_acceptance",
    "actor_user_id": 327,
    "actor_role": "partner",
    "reason": "Mach office created \u2014 invited Winchester",
    "created_at": "2026-04-29T15:00:02.164786+00:00"
  },
  {
    "ticket_id": 129,
    "from_status": "awaiting_acceptance",
    "to_status": "initiated",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "Winchester accepted",
    "created_at": "2026-04-29T15:30:02.164786+00:00"
  },
  {
    "ticket_id": 130,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "office created + assigned Joe Boggs",
    "created_at": "2026-04-29T14:00:02.164786+00:00"
  },
  {
    "ticket_id": 130,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 10,
    "actor_role": "field_employee",
    "reason": "check-in",
    "created_at": "2026-04-29T15:15:02.164786+00:00"
  },
  {
    "ticket_id": 131,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "office assigned Matt Elerick",
    "created_at": "2026-04-27T08:00:02.164786+00:00"
  },
  {
    "ticket_id": 131,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 9,
    "actor_role": "field_employee",
    "reason": "check-in",
    "created_at": "2026-04-27T10:00:02.164786+00:00"
  },
  {
    "ticket_id": 131,
    "from_status": "in_progress",
    "to_status": "pending_review",
    "actor_user_id": 9,
    "actor_role": "field_employee",
    "reason": "check-out",
    "created_at": "2026-04-27T16:00:02.164786+00:00"
  },
  {
    "ticket_id": 131,
    "from_status": "pending_review",
    "to_status": "submitted",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "submitted to Mach",
    "created_at": "2026-04-28T00:00:02.164786+00:00"
  },
  {
    "ticket_id": 132,
    "from_status": null,
    "to_status": "initiated",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "office created + assigned Joe Boggs",
    "created_at": "2026-04-25T08:00:02.164786+00:00"
  },
  {
    "ticket_id": 132,
    "from_status": "initiated",
    "to_status": "in_progress",
    "actor_user_id": 10,
    "actor_role": "field_employee",
    "reason": "check-in",
    "created_at": "2026-04-25T10:00:02.164786+00:00"
  },
  {
    "ticket_id": 132,
    "from_status": "in_progress",
    "to_status": "pending_review",
    "actor_user_id": 10,
    "actor_role": "field_employee",
    "reason": "check-out",
    "created_at": "2026-04-25T16:00:02.164786+00:00"
  },
  {
    "ticket_id": 132,
    "from_status": "pending_review",
    "to_status": "submitted",
    "actor_user_id": 5,
    "actor_role": "vendor",
    "reason": "submitted to Mach",
    "created_at": "2026-04-26T06:00:02.164786+00:00"
  },
  {
    "ticket_id": 132,
    "from_status": "submitted",
    "to_status": "approved",
    "actor_user_id": 327,
    "actor_role": "partner",
    "reason": "Mach approved",
    "created_at": "2026-04-29T12:00:02.164786+00:00"
  }
];

export const DEMO_CHECK_INS: DemoCheckInRow[] = [
  {
    "ticket_id": 122,
    "employee_id": 5,
    "check_in_at": "2026-04-29T11:28:53.85733+00:00",
    "check_in_latitude": 35.5382,
    "check_in_longitude": -97.2788,
    "check_out_at": "2026-04-29T16:58:53.85733+00:00",
    "check_out_latitude": 35.5382,
    "check_out_longitude": -97.2788,
    "hourly_rate_at_time": 95.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T17:58:53.85733+00:00"
  },
  {
    "ticket_id": 123,
    "employee_id": 5,
    "check_in_at": "2026-04-27T11:58:53.85733+00:00",
    "check_in_latitude": 35.5382,
    "check_in_longitude": -97.2788,
    "check_out_at": "2026-04-27T16:58:53.85733+00:00",
    "check_out_latitude": 35.5382,
    "check_out_longitude": -97.2788,
    "hourly_rate_at_time": 110.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T17:58:53.85733+00:00"
  },
  {
    "ticket_id": 124,
    "employee_id": 4,
    "check_in_at": "2026-04-24T09:58:53.85733+00:00",
    "check_in_latitude": 31.9973,
    "check_in_longitude": -102.0779,
    "check_out_at": "2026-04-24T15:58:53.85733+00:00",
    "check_out_latitude": 31.9973,
    "check_out_longitude": -102.0779,
    "hourly_rate_at_time": 95.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T17:58:53.85733+00:00"
  },
  {
    "ticket_id": 126,
    "employee_id": 11,
    "check_in_at": "2026-04-29T16:15:02.164786+00:00",
    "check_in_latitude": 31.9973,
    "check_in_longitude": -102.0779,
    "check_out_at": null,
    "check_out_latitude": null,
    "check_out_longitude": null,
    "hourly_rate_at_time": 105.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T18:00:02.164786+00:00"
  },
  {
    "ticket_id": 127,
    "employee_id": 3,
    "check_in_at": "2026-04-28T10:00:02.164786+00:00",
    "check_in_latitude": 31.9973,
    "check_in_longitude": -102.0779,
    "check_out_at": "2026-04-28T22:00:02.164786+00:00",
    "check_out_latitude": 31.9973,
    "check_out_longitude": -102.0779,
    "hourly_rate_at_time": 120.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T18:00:02.164786+00:00"
  },
  {
    "ticket_id": 128,
    "employee_id": 12,
    "check_in_at": "2026-04-26T10:00:02.164786+00:00",
    "check_in_latitude": 31.9973,
    "check_in_longitude": -102.0779,
    "check_out_at": "2026-04-26T16:00:02.164786+00:00",
    "check_out_latitude": 31.9973,
    "check_out_longitude": -102.0779,
    "hourly_rate_at_time": 110.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T18:00:02.164786+00:00"
  },
  {
    "ticket_id": 130,
    "employee_id": 4,
    "check_in_at": "2026-04-29T15:15:02.164786+00:00",
    "check_in_latitude": 35.541,
    "check_in_longitude": -97.987,
    "check_out_at": null,
    "check_out_latitude": null,
    "check_out_longitude": null,
    "hourly_rate_at_time": 95.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T18:00:02.164786+00:00"
  },
  {
    "ticket_id": 131,
    "employee_id": 5,
    "check_in_at": "2026-04-27T10:00:02.164786+00:00",
    "check_in_latitude": 34.706,
    "check_in_longitude": -97.31,
    "check_out_at": "2026-04-27T16:00:02.164786+00:00",
    "check_out_latitude": 34.706,
    "check_out_longitude": -97.31,
    "hourly_rate_at_time": 110.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T18:00:02.164786+00:00"
  },
  {
    "ticket_id": 132,
    "employee_id": 4,
    "check_in_at": "2026-04-25T10:00:02.164786+00:00",
    "check_in_latitude": 34.479,
    "check_in_longitude": -97.853,
    "check_out_at": "2026-04-25T16:00:02.164786+00:00",
    "check_out_latitude": 34.479,
    "check_out_longitude": -97.853,
    "hourly_rate_at_time": 95.0,
    "source": "auto",
    "corrected_by_id": null,
    "corrected_reason": null,
    "created_at": "2026-04-29T18:00:02.164786+00:00"
  }
];

export const DEMO_GPS_LOGS: DemoGpsLogRow[] = [
  {
    "ticket_id": 126,
    "latitude": 31.9973,
    "longitude": -102.0779,
    "event_type": "check_in",
    "recorded_at": "2026-04-29T16:15:02.164786+00:00",
    "battery_level": null,
    "speed_mps": null
  },
  {
    "ticket_id": 130,
    "latitude": 35.541,
    "longitude": -97.987,
    "event_type": "check_in",
    "recorded_at": "2026-04-29T15:15:02.164786+00:00",
    "battery_level": null,
    "speed_mps": null
  },
  {
    "ticket_id": 130,
    "latitude": 40,
    "longitude": -90,
    "event_type": "check_out",
    "recorded_at": "2026-04-29T18:00:21.566213+00:00",
    "battery_level": null,
    "speed_mps": null
  }
];

export const DEMO_SWA_ROWS: DemoSwaRow[] = [
  {
    "site_location_id": 1,
    "work_type_id": 4,
    "vendor_id": 2,
    "afe": "AFE-2026-000001"
  },
  {
    "site_location_id": 1,
    "work_type_id": 13,
    "vendor_id": 2,
    "afe": "AFE-2026-000001"
  },
  {
    "site_location_id": 2,
    "work_type_id": 6,
    "vendor_id": 2,
    "afe": "AFE-2026-000002"
  },
  {
    "site_location_id": 1,
    "work_type_id": 9,
    "vendor_id": 3,
    "afe": "AFE-2026-000001"
  },
  {
    "site_location_id": 4,
    "work_type_id": 5,
    "vendor_id": 3,
    "afe": "AFE-2026-000004"
  },
  {
    "site_location_id": 4,
    "work_type_id": 9,
    "vendor_id": 3,
    "afe": "AFE-2026-000004"
  },
  {
    "site_location_id": 4,
    "work_type_id": 41,
    "vendor_id": 3,
    "afe": "AFE-2026-000004"
  },
  {
    "site_location_id": 4,
    "work_type_id": 39,
    "vendor_id": 3,
    "afe": "AFE-2026-000004"
  },
  {
    "site_location_id": 5,
    "work_type_id": 9,
    "vendor_id": 3,
    "afe": null
  },
  {
    "site_location_id": 5,
    "work_type_id": 11,
    "vendor_id": 3,
    "afe": null
  },
  {
    "site_location_id": 6,
    "work_type_id": 5,
    "vendor_id": 3,
    "afe": null
  },
  {
    "site_location_id": 12,
    "work_type_id": 9,
    "vendor_id": 3,
    "afe": null
  },
  {
    "site_location_id": 13,
    "work_type_id": 13,
    "vendor_id": 3,
    "afe": null
  },
  {
    "site_location_id": 14,
    "work_type_id": 4,
    "vendor_id": 3,
    "afe": null
  },
  {
    "site_location_id": 4,
    "work_type_id": 13,
    "vendor_id": 3,
    "afe": null
  },
  {
    "site_location_id": 1,
    "work_type_id": 11,
    "vendor_id": 3,
    "afe": null
  },
  {
    "site_location_id": 1,
    "work_type_id": 19,
    "vendor_id": 2,
    "afe": null
  },
  {
    "site_location_id": 2,
    "work_type_id": 4,
    "vendor_id": 2,
    "afe": null
  }
];
