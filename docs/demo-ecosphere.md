# Prairie Horizon synthetic demo

The reusable baseline is `prairie-horizon-v1`, covering September 11 through October 10, 2026, plus seven days of upcoming schedules. Its accounts now use a separate demo database through the live VNDRLY app. Apple submission is on hold. After explicit approval, the exact 2,560 old production copies were removed on October 10, 2026; no unreviewed records were removed.

## Organizations and people

- Prairie Horizon Energy — Demo: partner/operator.
- Copper Creek Field Services — Demo: field operations.
- Blue Horizon Logistics — Demo: fleet transport.
- Sentinel Prairie Gate Services — Demo: gatekeeping.
- Twenty accounts, including twelve employees, office staff, a cross-organization review account, and a reserved visitor account.

The review username is `prairie-demo-review@example.invalid`. Its organization selector switches between the partner and all three vendors. The private credential file is `.local/prairie-demo-accounts.json`; it is ignored by Git. Do not put these credentials into public pages. Existing canonical demo passwords were not changed.

## Records

| Feature | Baseline |
|---|---:|
| Sites | 3 |
| Tracking tickets with labor and status history | 90 |
| Fleet vehicles | 4 |
| Fleet trips | 30 |
| Gate visits | 90 |
| Gate shifts | 30 |
| Invoices with linked ticket lines | 47 |
| Hotlist jobs and bids | 34 |
| Work Hub channels | 4 |
| Work Hub messages | 180 |
| Work Hub tasks | 180 |
| Work Hub schedule entries | 222 |
| Safety checklists | 120 |
| Shift handoff forms | 120 |
| Historical form submissions | 116 |
| Shift notes | 120 |
| Crew groups | 3 |
| Briefing occurrences | 24 |
| Announcements | 20 |

Partner and vendor schedules mirror the same work in their respective organizational calendars. Historical Hotlist awards link to existing synthetic tickets; nine unawarded jobs remain private drafts so the production marketplace does not broadcast fictional opportunities. Gate staff have gatekeeper roles; the Gate vendor is designated at all three sites.

All names, contact addresses, plates, services, work, credential claims, and payment records are fictional. Contact destinations use `example.invalid`; paid statuses do not represent real money movement. No provider invitations, calls, payments, or email deliveries were initiated.

## Reuse and verification

`scripts/demo-ecosphere-template.mjs` defines the single deterministic baseline. The additive provisioner uses stable keys and a transaction; it never resets the database or replaces existing credentials. Enrichment and finalization also use stable keys and validate the marked demo owner before writing. Preserve the private credentials and report when reusing these identities.

Provisioning sequence: `provision-demo-ecosphere.mjs --apply`, `enrich-demo-ecosphere.mjs`, then `finalize-demo-ecosphere.mjs`. These administrator scripts now require the isolated demo connection and cannot fall back to production. Preserve the existing credentials; do not re-provision against the production connection.

`verify-demo-ecosphere.mjs` signs into the live API using only synthetic identities and checks tickets, Work Hub, calendars, forms, Hotlist, gate access, fleet trips, and a cross-vendor ticket denial. It saves non-secret verification evidence in `.local/prairie-demo-verification.json`.

The private demo sign-ins are isolated and verified: its directory and dashboard show only three vendors, and real admin sign-in still works. Live email/SMS/push, payments, accounting dispatch, external connectors, shared storage and shared event streams are disabled for these identities. Audited internal Work Hub tasks, messages and notes remain available. Old browser sessions must sign in again with the unchanged password.

The public Demo button opens a four-role flyout: energy producer/partner, field vendor, fleet vendor and gate vendor. Visitors choose free exploration or the guided walkthrough. `POST /api/auth/demo-entry` signs only the four fixed isolated accounts, without returning credentials. Public demo sessions expire after two hours and are read-only; the narrowly scoped gate-report query is a read-only POST exception. Logging out clears only the visitor's cookie, preserving other visitors' sessions and the unchanged account passwords.

The collapsible guide retains per-tab progress, opens matching fictional ticket examples, and explains the separate field lifecycle and office statuses. Field, fleet, gate and partner journeys use their existing app screens. Financial steps are explanatory; no real money or messages are sent. Authentic native iPhone/iPad captures and Apple submission remain on hold. Completed production cleanup is documented in `docs/superpowers/specs/2026-10-10-demo-production-cleanup-review.md`. The old fictional copies are absent from production; the isolated demo retains its accounts and history.
