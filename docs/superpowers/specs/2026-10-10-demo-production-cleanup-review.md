# Remove old Prairie Horizon synthetic copies from production

Status: completed after the user's explicit "Approve exact synthetic cleanup" approval. The guarded transaction committed at 2026-10-10T09:06:41.624Z: 2,560 reviewed rows removed across 54 tables, zero unreviewed rows removed. Private evidence: `.local/prairie-demo-production-cleanup-result.json`. Post-cleanup live demo and real administrator checks passed.

The isolated demo is live and verified. This cleanup removes only its old production copies: **2560 rows in 54 tables**, including one marked partner, three marked vendors and twenty registered fictional accounts. Existing canonical demo accounts and all real companies are excluded. Passwords and history remain in the separate demo database.

A fresh read-only dependency scan found no references to real organizations or identities. Commands contain exact saved primary keys; legacy tables without keys use full null-safe row matches. The transaction clears only nullable synthetic links needed to break dependency cycles, then removes child records before their parents. No cascading deletion, schema reset or constraint disabling is used. Any changed counts or new reference aborts execution.

Exact proposed commands: [production cleanup SQL](../../../.local/prairie-demo-production-removal.sql). Private key manifest: [manifest](../../../.local/prairie-demo-production-removal-manifest.json). SQL SHA-256: 0b59421a3238a1a84ad0f88916c74c77fe36dac0d83bbeb857684f8be1833cfa.

| Table | Old synthetic rows |
|---|---:|
| partners | 1 |
| vendors | 3 |
| users | 20 |
| ap_payment_digest_log | 1 |
| field_trips | 30 |
| hotlist_bids | 34 |
| hotlist_jobs | 34 |
| invoices | 47 |
| partner_contacts | 3 |
| partner_vendor_approval_events | 3 |
| partner_vendor_relationships | 3 |
| site_locations | 3 |
| site_visits | 90 |
| site_work_assignments | 9 |
| tickets | 90 |
| user_org_memberships | 26 |
| vendor_people | 12 |
| vendor_work_types | 3 |
| work_hub_announcements | 20 |
| work_hub_audit_log | 3 |
| work_hub_channels | 4 |
| work_hub_checklist_templates | 4 |
| work_hub_crews | 3 |
| work_hub_devices | 1 |
| work_hub_form_templates | 4 |
| work_hub_meetings | 4 |
| work_hub_shifts | 222 |
| work_hub_tasks | 180 |
| work_types | 3 |
| gps_logs | 88 |
| ticket_check_ins | 88 |
| ticket_crew | 90 |
| ticket_status_history | 90 |
| ticket_line_items | 90 |
| notifications | 17 |
| invoice_lines | 47 |
| invoice_ticket_links | 47 |
| work_hub_channel_members | 26 |
| work_hub_messages | 180 |
| work_hub_notes | 120 |
| work_hub_checklist_instances | 120 |
| work_hub_form_instances | 120 |
| work_hub_form_submissions | 116 |
| work_hub_announcement_recipients | 20 |
| work_hub_shift_assignments | 222 |
| work_hub_meeting_occurrences | 24 |
| work_hub_meeting_participants | 48 |
| work_hub_crew_members | 12 |
| work_hub_device_connections | 1 |
| assets | 4 |
| asset_aliases | 4 |
| field_trip_location_points | 90 |
| gate_stations | 6 |
| gate_shifts | 30 |

Nullable cycle links to clear, only within those exact synthetic keys: users.active_membership_id.

Approval required by AGENTS.md: "Under no circumstances may the agent destroy, blank, truncate, drop, or reset the user's database — dev or prod — unless the user explicitly and unambiguously instructs it in that same message." The approved isolation design also requires this exact removal list to be shown separately before execution.
