-- Implementation A is additive and idempotent. Existing operational rows are not rewritten.

CREATE TABLE IF NOT EXISTS "capability_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_org_type" text NOT NULL,
  "owner_org_id" integer NOT NULL,
  "site_id" integer REFERENCES "site_locations"("id") ON DELETE CASCADE,
  "flag_name" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "configured_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "capability_flags_owner_lookup_idx" ON "capability_flags" ("owner_org_type", "owner_org_id", "flag_name");
CREATE UNIQUE INDEX IF NOT EXISTS "capability_flags_org_unique" ON "capability_flags" ("owner_org_type", "owner_org_id", "flag_name") WHERE "site_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "capability_flags_site_unique" ON "capability_flags" ("owner_org_type", "owner_org_id", "site_id", "flag_name") WHERE "site_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "managed_subcontractor_organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "canonical_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'managed',
  "created_by_vendor_id" integer NOT NULL REFERENCES "vendors"("id"),
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "claimed_vendor_id" integer REFERENCES "vendors"("id"),
  "claimed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "managed_subcontractor_org_status_check" CHECK ("status" IN ('managed','claimed','archived'))
);
CREATE INDEX IF NOT EXISTS "managed_subcontractor_org_sponsor_name_idx" ON "managed_subcontractor_organizations" ("created_by_vendor_id", "canonical_name");

CREATE TABLE IF NOT EXISTS "managed_subcontractor_sponsors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "managed_organization_id" uuid NOT NULL REFERENCES "managed_subcontractor_organizations"("id"),
  "sponsor_vendor_id" integer NOT NULL REFERENCES "vendors"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "created_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  CONSTRAINT "managed_subcontractor_sponsor_status_check" CHECK ("status" IN ('active','inactive'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_subcontractor_active_sponsor_unique" ON "managed_subcontractor_sponsors" ("managed_organization_id", "sponsor_vendor_id") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "managed_subcontractor_sponsor_vendor_idx" ON "managed_subcontractor_sponsors" ("sponsor_vendor_id", "status");

CREATE TABLE IF NOT EXISTS "managed_subcontractor_worker_sponsorships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "worker_user_id" integer NOT NULL REFERENCES "users"("id"),
  "sponsor_vendor_id" integer NOT NULL REFERENCES "vendors"("id"),
  "managed_organization_id" uuid NOT NULL REFERENCES "managed_subcontractor_organizations"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "invited_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  CONSTRAINT "managed_subcontractor_worker_status_check" CHECK ("status" IN ('active','paused','terminated'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_subcontractor_active_worker_sponsorship_unique" ON "managed_subcontractor_worker_sponsorships" ("worker_user_id", "sponsor_vendor_id", "managed_organization_id") WHERE "status" = 'active';
CREATE INDEX IF NOT EXISTS "managed_subcontractor_worker_lookup_idx" ON "managed_subcontractor_worker_sponsorships" ("worker_user_id", "sponsor_vendor_id", "status");

CREATE TABLE IF NOT EXISTS "managed_subcontractor_role_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sponsorship_id" uuid NOT NULL REFERENCES "managed_subcontractor_worker_sponsorships"("id"),
  "role" text NOT NULL,
  "site_id" integer REFERENCES "site_locations"("id"),
  "crew_id" uuid REFERENCES "work_hub_crews"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "granted_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "ended_at" timestamptz,
  CONSTRAINT "managed_subcontractor_role_grant_scope_check" CHECK ("site_id" IS NOT NULL OR "crew_id" IS NOT NULL),
  CONSTRAINT "managed_subcontractor_role_grant_role_check" CHECK ("role" IN ('managed_company_manager','gatekeeper','gate_supervisor','foreman','asset_manager','safety_manager')),
  CONSTRAINT "managed_subcontractor_role_grant_status_check" CHECK ("status" IN ('active','inactive'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_subcontractor_active_site_role_grant_unique" ON "managed_subcontractor_role_grants" ("sponsorship_id", "role", "site_id") WHERE "status" = 'active' AND "site_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "managed_subcontractor_active_crew_role_grant_unique" ON "managed_subcontractor_role_grants" ("sponsorship_id", "role", "crew_id") WHERE "status" = 'active' AND "crew_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "managed_subcontractor_role_grant_sponsorship_idx" ON "managed_subcontractor_role_grants" ("sponsorship_id", "status");

CREATE TABLE IF NOT EXISTS "managed_subcontractor_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "managed_organization_id" uuid NOT NULL REFERENCES "managed_subcontractor_organizations"("id"),
  "claimed_vendor_id" integer NOT NULL REFERENCES "vendors"("id"),
  "representative_user_id" integer NOT NULL REFERENCES "users"("id"),
  "claimed_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "worker_identity_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "claimed_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "managed_subcontractor_claim_org_unique" ON "managed_subcontractor_claims" ("managed_organization_id");
CREATE INDEX IF NOT EXISTS "managed_subcontractor_claim_vendor_idx" ON "managed_subcontractor_claims" ("claimed_vendor_id");

CREATE TABLE IF NOT EXISTS "account_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sponsor_vendor_id" integer NOT NULL REFERENCES "vendors"("id"),
  "managed_organization_id" uuid NOT NULL REFERENCES "managed_subcontractor_organizations"("id"),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "username" text NOT NULL,
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "state" text NOT NULL DEFAULT 'pending',
  "authorization_version" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "delivered_at" timestamptz,
  "delivery_message_id" text,
  "delivery_error" text,
  "claimed_at" timestamptz,
  "revoked_at" timestamptz,
  "issued_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "account_invitations_state_check" CHECK ("state" IN ('pending','delivered','claimed','expired','revoked','delivery_failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "account_invitations_token_hash_unique" ON "account_invitations" ("token_hash");
CREATE INDEX IF NOT EXISTS "account_invitations_sponsor_idx" ON "account_invitations" ("sponsor_vendor_id", "state");
CREATE INDEX IF NOT EXISTS "account_invitations_user_idx" ON "account_invitations" ("user_id", "state");

CREATE TABLE IF NOT EXISTS "work_participation_authorizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "sponsor_vendor_id" integer NOT NULL REFERENCES "vendors"("id"),
  "managed_organization_id" uuid NOT NULL REFERENCES "managed_subcontractor_organizations"("id"),
  "authorization_version" text NOT NULL,
  "source" text NOT NULL DEFAULT 'account_activation',
  "accepted_at" timestamptz NOT NULL DEFAULT now(),
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_participation_authorization_unique" ON "work_participation_authorizations" ("user_id", "sponsor_vendor_id", "managed_organization_id", "authorization_version");
CREATE INDEX IF NOT EXISTS "work_participation_authorization_scope_idx" ON "work_participation_authorizations" ("sponsor_vendor_id", "managed_organization_id", "user_id");

CREATE TABLE IF NOT EXISTS "workforce_staffing_requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_org_type" text NOT NULL,
  "owner_org_id" integer NOT NULL,
  "site_id" integer NOT NULL,
  "role_code" text NOT NULL,
  "weekday" integer NOT NULL,
  "starts_at_local" text NOT NULL,
  "ends_at_local" text NOT NULL,
  "required_count" integer NOT NULL DEFAULT 1,
  "created_by_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "workforce_staffing_requirement_owner_site_idx" ON "workforce_staffing_requirements" ("owner_org_type", "owner_org_id", "site_id");

CREATE TABLE IF NOT EXISTS "workforce_coverage_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shift_id" uuid NOT NULL REFERENCES "work_hub_shifts"("id") ON DELETE CASCADE,
  "requirement_id" uuid REFERENCES "workforce_staffing_requirements"("id"),
  "vacancy_origin" text NOT NULL,
  "required_count" integer NOT NULL DEFAULT 1,
  "assigned_count" integer NOT NULL DEFAULT 0,
  "state" text NOT NULL DEFAULT 'uncovered',
  "supervisor_user_id" integer REFERENCES "users"("id"),
  "escalation_target_user_id" integer REFERENCES "users"("id"),
  "escalation_due_at" timestamptz,
  "escalated_at" timestamptz,
  "resolved_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_coverage_shift_unique" ON "workforce_coverage_records" ("shift_id");
CREATE INDEX IF NOT EXISTS "workforce_coverage_state_due_idx" ON "workforce_coverage_records" ("state", "escalation_due_at");

CREATE TABLE IF NOT EXISTS "workforce_assignment_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shift_id" uuid NOT NULL REFERENCES "work_hub_shifts"("id") ON DELETE CASCADE,
  "worker_user_id" integer NOT NULL REFERENCES "users"("id"),
  "state" text NOT NULL DEFAULT 'pending',
  "acknowledgement_due_at" timestamptz NOT NULL,
  "acknowledged_at" timestamptz,
  "reminder_schedule" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reminder_receipts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "no_show_at" timestamptz,
  "warning_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "override_reason" text,
  "assigned_by_id" integer NOT NULL REFERENCES "users"("id"),
  "operation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_assignment_state_shift_worker_unique" ON "workforce_assignment_states" ("shift_id", "worker_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_assignment_state_operation_unique" ON "workforce_assignment_states" ("operation_id");
CREATE INDEX IF NOT EXISTS "workforce_assignment_state_pending_due_idx" ON "workforce_assignment_states" ("state", "acknowledgement_due_at");

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "delivery_status" text NOT NULL DEFAULT 'pending';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "delivery_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "next_delivery_attempt_at" timestamptz;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "delivered_at" timestamptz;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "acknowledgement_required" boolean NOT NULL DEFAULT false;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "acknowledgement_due_at" timestamptz;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamptz;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "escalation_policy" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "escalation_id" text;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "escalated_at" timestamptz;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "final_delivery_failure_at" timestamptz;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "final_delivery_failure_reason" text;
CREATE INDEX IF NOT EXISTS "notifications_delivery_retry_idx" ON "notifications" ("delivery_status", "next_delivery_attempt_at");
CREATE INDEX IF NOT EXISTS "notifications_acknowledgement_due_idx" ON "notifications" ("acknowledgement_required", "acknowledgement_due_at");

CREATE TABLE IF NOT EXISTS "assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "category" text NOT NULL,
  "legal_owner_name" text NOT NULL,
  "responsible_org_type" text NOT NULL,
  "responsible_org_id" integer NOT NULL,
  "current_location_type" text,
  "current_location_id" text,
  "current_holder_user_id" integer REFERENCES "users"("id"),
  "expected_return_at" timestamptz,
  "manufacturer" text,
  "model" text,
  "status" text NOT NULL DEFAULT 'available',
  "provisional" boolean NOT NULL DEFAULT false,
  "merged_into_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "assets_responsible_owner_idx" ON "assets" ("responsible_org_type", "responsible_org_id", "status");

CREATE TABLE IF NOT EXISTS "asset_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id"),
  "kind" text NOT NULL,
  "jurisdiction" text NOT NULL DEFAULT '',
  "normalized_value" text NOT NULL,
  "display_value" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "retired_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "asset_alias_lookup_unique" ON "asset_aliases" ("kind", "jurisdiction", "normalized_value");
CREATE INDEX IF NOT EXISTS "asset_alias_asset_idx" ON "asset_aliases" ("asset_id");

CREATE TABLE IF NOT EXISTS "asset_category_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_org_type" text NOT NULL,
  "owner_org_id" integer NOT NULL,
  "category" text NOT NULL,
  "identifier_required" boolean NOT NULL DEFAULT false,
  "photos_required_on_checkout" boolean NOT NULL DEFAULT false,
  "photos_required_on_return" boolean NOT NULL DEFAULT false,
  "supervisor_approval_required" boolean NOT NULL DEFAULT false,
  "expected_return_required" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "asset_category_policy_owner_unique" ON "asset_category_policies" ("owner_org_type", "owner_org_id", "category");

CREATE TABLE IF NOT EXISTS "asset_custody_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id"),
  "event_type" text NOT NULL,
  "from_holder_user_id" integer REFERENCES "users"("id"),
  "to_holder_user_id" integer REFERENCES "users"("id"),
  "condition" text,
  "note" text,
  "actor_user_id" integer REFERENCES "users"("id"),
  "operation_id" uuid NOT NULL,
  "asset_version" integer NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "asset_custody_operation_unique" ON "asset_custody_events" ("operation_id");
CREATE INDEX IF NOT EXISTS "asset_custody_history_idx" ON "asset_custody_events" ("asset_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "asset_condition_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id"),
  "custody_event_id" uuid REFERENCES "asset_custody_events"("id"),
  "condition" text,
  "note" text,
  "photo_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reported_by_user_id" integer REFERENCES "users"("id"),
  "reported_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "asset_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id"),
  "reason" text NOT NULL,
  "placed_by_user_id" integer REFERENCES "users"("id"),
  "placed_at" timestamptz NOT NULL DEFAULT now(),
  "released_by_user_id" integer REFERENCES "users"("id"),
  "released_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "asset_hold_asset_idx" ON "asset_holds" ("asset_id", "released_at");

CREATE TABLE IF NOT EXISTS "asset_merges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "surviving_asset_id" uuid NOT NULL REFERENCES "assets"("id"),
  "merged_asset_id" uuid NOT NULL REFERENCES "assets"("id"),
  "reason" text NOT NULL,
  "merged_by_user_id" integer REFERENCES "users"("id"),
  "merged_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "asset_merge_source_unique" ON "asset_merges" ("merged_asset_id");

CREATE TABLE IF NOT EXISTS "asset_attachment_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "asset_id" uuid NOT NULL REFERENCES "assets"("id"),
  "attachment_type" text NOT NULL,
  "attachment_id" text NOT NULL,
  "linked_by_user_id" integer REFERENCES "users"("id"),
  "linked_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "asset_attachment_unique" ON "asset_attachment_links" ("asset_id", "attachment_type", "attachment_id");

ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "observed_arrival_at" timestamptz;
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "observed_departure_at" timestamptz;
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "observed_direction" text;
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "observation_source" text;
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "provisional_vehicle_asset_id" uuid REFERENCES "assets"("id");
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "reconciliation_state" text NOT NULL DEFAULT 'not_required';
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "reconciliation_facts" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "conflict_reason" text;
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "reconciled_by_user_id" integer REFERENCES "users"("id");
ALTER TABLE "site_visits" ADD COLUMN IF NOT EXISTS "reconciled_at" timestamptz;

CREATE TABLE IF NOT EXISTS "field_trips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "operation_id" uuid NOT NULL,
  "owner_org_type" text NOT NULL,
  "owner_org_id" integer NOT NULL,
  "driver_user_id" integer NOT NULL REFERENCES "users"("id"),
  "vehicle_asset_id" uuid REFERENCES "assets"("id"),
  "assignment_id" text,
  "site_location_id" integer NOT NULL REFERENCES "site_locations"("id"),
  "destination_source" text NOT NULL,
  "active_shift_id" uuid REFERENCES "work_hub_shifts"("id"),
  "tracking_state" text NOT NULL DEFAULT 'active',
  "presence_state" text NOT NULL DEFAULT 'en_route',
  "last_latitude" double precision,
  "last_longitude" double precision,
  "last_accuracy_meters" double precision,
  "last_speed_mps" double precision,
  "last_recorded_at" timestamptz,
  "last_point_reliable" boolean NOT NULL DEFAULT false,
  "crossing_candidate" jsonb,
  "final_visit_id" integer REFERENCES "site_visits"("id"),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "paused_at" timestamptz,
  "completed_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "field_trip_operation_unique" ON "field_trips" ("operation_id");
CREATE INDEX IF NOT EXISTS "field_trip_active_driver_idx" ON "field_trips" ("driver_user_id", "tracking_state");
CREATE INDEX IF NOT EXISTS "field_trip_owner_site_idx" ON "field_trips" ("owner_org_type", "owner_org_id", "site_location_id");

CREATE TABLE IF NOT EXISTS "field_trip_location_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trip_id" uuid NOT NULL REFERENCES "field_trips"("id") ON DELETE CASCADE,
  "latitude" double precision NOT NULL,
  "longitude" double precision NOT NULL,
  "accuracy_meters" double precision NOT NULL,
  "speed_mps" double precision,
  "distance_to_site_meters" double precision,
  "reliable" boolean NOT NULL DEFAULT true,
  "recorded_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "field_trip_point_trip_time_idx" ON "field_trip_location_points" ("trip_id", "recorded_at");

CREATE TABLE IF NOT EXISTS "field_trip_crossings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trip_id" uuid NOT NULL REFERENCES "field_trips"("id") ON DELETE CASCADE,
  "site_location_id" integer NOT NULL REFERENCES "site_locations"("id"),
  "direction" text NOT NULL,
  "crossed_at" timestamptz NOT NULL,
  "confirmed_at" timestamptz NOT NULL,
  "dedupe_key" text NOT NULL,
  "visit_id" integer REFERENCES "site_visits"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "field_trip_crossing_dedupe_unique" ON "field_trip_crossings" ("dedupe_key");

CREATE TABLE IF NOT EXISTS "safety_escalation_chains" (
  "id" serial PRIMARY KEY,
  "owner_type" text NOT NULL,
  "owner_id" integer NOT NULL,
  "name" text NOT NULL DEFAULT 'Primary safety chain',
  "responder_user_ids" integer[] NOT NULL DEFAULT '{}',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "safety_escalation_chains_owner_active_idx" ON "safety_escalation_chains" ("owner_type", "owner_id", "is_active");

CREATE TABLE IF NOT EXISTS "safety_incident_responses" (
  "id" serial PRIMARY KEY,
  "event_id" integer NOT NULL REFERENCES "safety_events"("id") ON DELETE CASCADE,
  "source" text NOT NULL DEFAULT 'manual',
  "severity" text NOT NULL DEFAULT 'medium',
  "response_status" text NOT NULL DEFAULT 'open',
  "original_report" text NOT NULL,
  "response_deadline_at" timestamptz,
  "degraded_capabilities" text[] NOT NULL DEFAULT '{}',
  "safety_chain_snapshot" integer[] NOT NULL DEFAULT '{}',
  "configuration_warning" text,
  "assigned_responder_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "acknowledged_at" timestamptz,
  "acknowledged_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "closed_at" timestamptz,
  "closed_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "safety_incident_responses_event_unique" ON "safety_incident_responses" ("event_id");
CREATE INDEX IF NOT EXISTS "safety_incident_responses_status_idx" ON "safety_incident_responses" ("response_status", "response_deadline_at");

CREATE TABLE IF NOT EXISTS "safety_incident_deliveries" (
  "id" serial PRIMARY KEY,
  "response_id" integer NOT NULL REFERENCES "safety_incident_responses"("id") ON DELETE CASCADE,
  "recipient_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "delivered_at" timestamptz,
  "acknowledged_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "safety_incident_deliveries_response_recipient_idx" ON "safety_incident_deliveries" ("response_id", "recipient_user_id");

CREATE TABLE IF NOT EXISTS "safety_incident_evidence" (
  "id" serial PRIMARY KEY,
  "response_id" integer NOT NULL REFERENCES "safety_incident_responses"("id") ON DELETE CASCADE,
  "actor_user_id" integer NOT NULL REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "value" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "safety_evidence_holds" (
  "id" serial PRIMARY KEY,
  "response_id" integer NOT NULL REFERENCES "safety_incident_responses"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "placed_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "placed_at" timestamptz NOT NULL DEFAULT now(),
  "released_by_user_id" integer REFERENCES "users"("id"),
  "released_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "safety_evidence_holds_active_idx" ON "safety_evidence_holds" ("response_id", "released_at");

CREATE TABLE IF NOT EXISTS "work_hub_meeting_participation_authorizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "policy_version" integer NOT NULL,
  "source" text NOT NULL,
  "accepted_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_meeting_participation_authorization_unique" ON "work_hub_meeting_participation_authorizations" ("user_id", "policy_version");

CREATE TABLE IF NOT EXISTS "work_hub_meeting_recording_retention" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "manifest_id" uuid NOT NULL REFERENCES "work_hub_meeting_replay_manifests"("id") ON DELETE CASCADE,
  "occurrence_id" uuid NOT NULL REFERENCES "work_hub_meeting_occurrences"("id") ON DELETE CASCADE,
  "retention_days" integer NOT NULL DEFAULT 30,
  "raw_media_expires_at" timestamptz NOT NULL,
  "raw_media_deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "work_hub_meeting_recording_retention_manifest_unique" ON "work_hub_meeting_recording_retention" ("manifest_id");
CREATE INDEX IF NOT EXISTS "work_hub_meeting_recording_retention_expiry_idx" ON "work_hub_meeting_recording_retention" ("raw_media_expires_at", "raw_media_deleted_at");

CREATE TABLE IF NOT EXISTS "work_hub_meeting_recording_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "retention_id" uuid NOT NULL REFERENCES "work_hub_meeting_recording_retention"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "reason" text NOT NULL,
  "placed_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "placed_at" timestamptz NOT NULL DEFAULT now(),
  "released_by_user_id" integer REFERENCES "users"("id"),
  "released_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "work_hub_meeting_recording_hold_active_idx" ON "work_hub_meeting_recording_holds" ("retention_id", "released_at");

CREATE TABLE IF NOT EXISTS "worker_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "payor_org_type" text NOT NULL,
  "payor_vendor_id" integer REFERENCES "vendors"("id"),
  "payor_partner_id" integer REFERENCES "partners"("id"),
  "worker_user_id" integer NOT NULL REFERENCES "users"("id"),
  "plan" text NOT NULL,
  "monthly_price_cents" integer NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "renewal_at" timestamptz NOT NULL,
  "state" text NOT NULL DEFAULT 'active',
  "renews" boolean NOT NULL DEFAULT true,
  "access_ends_at" timestamptz,
  "billing_ends_at" timestamptz,
  "founding_site_location_id" integer REFERENCES "site_locations"("id"),
  "preview_access" boolean NOT NULL DEFAULT false,
  "archived_at" timestamptz,
  "audit_actor_user_id" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "worker_subscriptions_payor_check" CHECK (("payor_org_type"='vendor' AND "payor_vendor_id" IS NOT NULL AND "payor_partner_id" IS NULL) OR ("payor_org_type"='partner' AND "payor_partner_id" IS NOT NULL AND "payor_vendor_id" IS NULL)),
  CONSTRAINT "worker_subscriptions_plan_check" CHECK ("plan" IN ('gate_only','full_worker')),
  CONSTRAINT "worker_subscriptions_state_check" CHECK ("state" IN ('active','paused','terminated')),
  CONSTRAINT "worker_subscriptions_currency_check" CHECK ("currency"='USD'),
  CONSTRAINT "worker_subscriptions_price_check" CHECK ("monthly_price_cents">=0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "worker_subscriptions_active_vendor_worker_unique" ON "worker_subscriptions" ("payor_vendor_id", "worker_user_id") WHERE "payor_vendor_id" IS NOT NULL AND "state" <> 'terminated';
CREATE UNIQUE INDEX IF NOT EXISTS "worker_subscriptions_active_partner_worker_unique" ON "worker_subscriptions" ("payor_partner_id", "worker_user_id") WHERE "payor_partner_id" IS NOT NULL AND "state" <> 'terminated';
CREATE INDEX IF NOT EXISTS "worker_subscriptions_payor_idx" ON "worker_subscriptions" ("payor_org_type", "payor_vendor_id", "payor_partner_id", "state");
CREATE INDEX IF NOT EXISTS "worker_subscriptions_worker_idx" ON "worker_subscriptions" ("worker_user_id", "state");

CREATE TABLE IF NOT EXISTS "operations_displays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_org_type" text NOT NULL,
  "owner_org_id" integer NOT NULL,
  "name" text NOT NULL,
  "identity_kind" text NOT NULL DEFAULT 'operations_display',
  "registered_by_user_id" integer NOT NULL REFERENCES "users"("id"),
  "registered_companion_device_id" uuid NOT NULL REFERENCES "work_hub_devices"("id"),
  "site_allowlist" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "view_allowlist" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "privacy_mode" boolean NOT NULL DEFAULT true,
  "token_hash" text NOT NULL,
  "token_expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "revoked_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "operations_displays_owner_idx" ON "operations_displays" ("owner_org_type", "owner_org_id");

CREATE TABLE IF NOT EXISTS "operations_display_outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "display_id" uuid NOT NULL REFERENCES "operations_displays"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "current_view" text,
  "current_site_location_id" integer REFERENCES "site_locations"("id"),
  "current_meeting_occurrence_id" uuid REFERENCES "work_hub_meeting_occurrences"("id"),
  "camera_enabled" boolean NOT NULL DEFAULT false,
  "microphone_enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "operations_display_outputs_display_name_unique" ON "operations_display_outputs" ("display_id", "name");
