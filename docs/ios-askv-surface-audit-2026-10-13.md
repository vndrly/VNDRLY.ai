# iOS changes and assistant coverage — October 12–13

This audit covers the active iOS web-preview working tree, including uncommitted changes. Local implementation and validation do not establish production deployment or installed ChatGPT tool refresh.

| Surface | Assistant coverage | Boundary |
|---|---|---|
| Company Field/Fleet/Gate selection | `query_company_operations`, `set_company_operations`, native `open_screen` | Exact complete selection; company administrator; authenticated confirmation. New ChatGPT `company:settings` consent is required; existing grants remain unchanged. |
| Shift and On Call | Existing `query_native_work_status`, `set_my_shift_status`, `set_my_on_call_status` | Own account, persisted server status; confirmation; never changes tracking consent. |
| Gate locations | Existing get/prepare/confirm Work Hub gate-location tools | Current company administrator; exact saved location; model coordinates are not device GPS. |
| Gate map, coverage and history | `query_gate_coverage_map`, existing Gate history/change-over tools, native map navigation | Authorized company staff only; historical timestamp supported; missing/stale GPS stays explicit; a read never acknowledges or resolves an incident. |
| Fleet board, log, equipment and drivers | Existing Fleet overview/resources/run/detail/site-activity/report tools, native navigation | Current Fleet grants; idle assets without observations do not acquire invented locations. |
| Fleet History & Replay | `query_fleet_location_history` | Recorded points and timestamps, explicit gaps; replay is display, not a domain mutation. |
| Batch/Singles and approved destinations | `query_fleet_ticket_plan`, `query_fleet_commercial_settings`, `recommend_fleet_destinations`; existing run tools | Origin site locked; recommendations are not destination approval; financial fields remain grant-scoped. `save_fleet_ticket_plan` and `save_fleet_destination` use confirmed writes, current revisions and retained operation IDs. |
| Ticket Travel/Arrival/Check In/Check Out/Review | Existing lifecycle and review tools | Same authorization, device GPS and confirmation contracts as the app; arrival is distinct from paid work. |
| Field Proof Packet | Role-projected `query_ticket_proof_packet` | Field workers/foremen end at Submitted to Office; correction/resubmission shown on kickback; no approval/payment fields. Mileage optional. |
| Office Proof-to-Pay | Existing ticket proof and finance reads/actions | Office roles and finance consent; no payment completion inferred from a request. |
| Work Hub Calendar, My Work, Needs Attention, Safety | Existing Work Hub reads/calendar/tasks/shifts/meetings plus ticket schedules, notifications and safety reads; native screen aliases | Company/category and employee permissions; notification read is distinct from acknowledgement/resolution. Calendar sources must be described separately when a read has partial coverage. |
| Safety reporting | Existing draft helper and native form handoff | Draft is not submission; form review and canonical save required. |
| Map zoom/center/style/date/replay | Native controls; assistant opens exact map/visit surface and reads its records | Map presentation does not write a ticket or manufacture location consent. Individual remote control bindings are not claimed where a screen has not registered them. |

## Validation

Focused parity tests exercise canonical read endpoints, invalid IDs, confirmed administrator-only category replacement, native navigation and tool discovery. Existing shift/on-call, registry, tool-pack, ChatGPT scope and proof-packet tests also run. No real shift, company setting, ticket, Gate incident or payment is changed merely to validate the toolbox.

## Release boundary

The installed ChatGPT connector still requires a matching API deployment and tool-definition refresh before these additions can be claimed online. Gate coverage depends on the matching coverage endpoint being deployed. Native UI navigation requires the new app/OTA bundle. No Apple submission is implied by this audit.
