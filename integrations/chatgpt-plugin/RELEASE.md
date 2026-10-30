# VNDRLY plugin 1.22.14

Parallel linked gates share authorized Site / Spur traffic, totals, task hoppers and handoff notes. Entry and exit gates remain separate evidence on one visit. The compact Site | Gate selector separates booth connectivity from GPS; unlinked gates hide the connection indicator. Existing MCP identity and grants remain unchanged.

Matches compact employee staffing summaries, company-defined reusable staff positions, shared enrollment flows, recurring Gate shift definitions, unassigned task creation, coverage assignment and branded flyouts. VNDRLY operational roles remain separate from editable company staffing positions. Existing MCP tools, embedded views, five service skills, branding, plugin identity and grants are preserved. This full ship includes production web/API, guarded database migrations, OTA and native TestFlight submission. Submission, approval and public availability remain separate states.

# VNDRLY plugin 1.22.12

Matches the shared employee profile, company staff types and functional roles, vendor-managed contracted workforce, and refreshed CompanyGo operational scenarios. Gate staffing includes active site-authorized sponsored workers while qualification and enrollment checks remain enforced. Existing MCP tools, five service skills, app identity, connected accounts and permission grants are preserved. No TestFlight build is part of this release.

# VNDRLY plugin 1.22.11

Matches Gate Map activity flyouts, compact staff locations, role-authorized gate administration, explicit historical gate associations, and 30-day Shift Notes with site-scoped and all-site exports. Saved shift cards retain their recorded activity totals and notes, with separate expandable activity rows and task hopper items. Existing MCP tools, embedded views, five service skills, branding, plugin identity and permission grants remain intact. Submission, approval and public availability remain separate states.

# VNDRLY plugin 1.22.10

Matches persistent Gate entry clearance, final-ten-minute incoming run lists, exact Gate Log record navigation, shared cross-tab notification transport and compact Work Hub home. Clearance is not physical entry; only a recorded arrival moves a visitor On Site. Existing MCP tools and embedded views use the same server projections. All five service skills, branding, existing plugin identity and permission grants remain intact. Submitted, approved and public availability remain distinct states.

# VNDRLY plugin 1.22.9

Matches the Gate record cards, exact Gate Log record links, source-based GPS/duration flags, combined Site | Gate selection and Gate Map staff roster. Map reads group authorized app-enabled employees by On Watch, On Call and Everyone else. Current shared locations can be focused on the map; stale, missing or revoked positions remain unavailable. Tracked incoming vehicle details remain limited to authorized runs and current consented driver-phone observations; missing speed, origin or ETA is never invented. Existing MCP tools, embedded view identities, five service skills, branding and permission grants are retained. Submission is separate from approval or public availability.

# VNDRLY plugin 1.22.8

Gate handoff candidate: shift notes can be appended through the existing authorized Ask V action flow, including dictated incident times. The responsible gatekeeper signs the exact note version in the trusted handoff screen; edits and appended notes require a new signature. The Gate dashboard uses a shared assumption review, per-site watch history and task hopper. Existing plugin/app identity, five service skills, embedded views and grants are retained. Package validation does not establish submission, review approval or public availability.

# VNDRLY plugin 1.22.4

Rollback package restoring the 1.22.2 skills and operation guidance alongside the source rollback of d72b4259. The version advances only to support updating the same installed plugin; it does not retain the 1.22.3 iOS parity guidance. Existing plugin/app identity, all five service labels, branding, linked accounts and grants remain unchanged. No new tools, views or scopes are introduced. Package validation does not establish installation or public review status.

# VNDRLY plugin 1.22.2

Matches the Gate arrivals panel and its read-only operational details. Arrivals use the selected authorized Gate site, current ticketed Fleet run and next stop, fresh consented designated-phone GPS, and a real driving estimate when available. Missing or stale evidence remains unavailable. Detail reads expose only the permitted site stops, load information, timing and explicitly linked Gate visit records; private billing, documents and unrelated destinations remain excluded. A read never records physical arrival, checks anyone in or out, changes a run, assumes watch or starts a paid shift. The permission-scoped query_gate_arrivals tool and gate_arrivals embedded view expose the same restricted projection under the existing gate:read grant. Saved visitor counts and Gate Board retain their separate meanings. Refresh the same authorized selection after an unavailable or interrupted read. Preserve exact action references and canonical readback for any separately requested mutation. The existing plugin/app identity, five service skills, branding, linked accounts and grants are unchanged; no new permission scopes are introduced. Installation, API deployment, live permission-scoped verification and public review remain separate release results.

# VNDRLY plugin 1.22.1

Matches the calendar navigation and compact summary refinements across web and iOS, grey/green shift and on-call sliders, explicit watch-key handover actions, plus origin-wide locking for encrypted browser offline work. The web Workforce card adds current company/site-scoped paid-shift and On Call rosters, employee work profiles and conversation entry, plus persisted Gate shift offers with employee acceptance/decline and exact operation recovery. Offers do not assign anyone until acceptance; assigned counts never prove physical attendance. Existing MCP tools and embedded views retain their current permissions and advertised actions; the five service skills document the Work Hub interface for offers. Branding, account identity and grants are unchanged. This package does not establish physical device or provider acceptance.

# VNDRLY plugin 1.22.0

Matches the shared branded Work Hub and calendar redesign and independent shift/watch controls across web and iOS. Gate watch preparation and explicit own-account assumption preserve paid clocks, device sessions, current grants and durable notes. Sign-in/sign-out never starts or ends a shift or watch. Existing MCP identity, embedded views, five service skills, branding, linked accounts and grants remain intact. Incoming assumption uses the trusted device review screen; no new conversational scope is introduced.

# VNDRLY plugin 1.21.1

Matches the Fleet Readiness release: compact driver, equipment, Yard safety, compliance, and recent-work drilldowns use the same permission-scoped Fleet records and exact deep links as iOS. Existing plugin identity, linked accounts, grants, five service skills, and server-owned action confirmation remain unchanged.

# VNDRLY plugin 1.21.0

Adds exact, permission-scoped `query_fleet_yard_operation` and `query_fleet_custody_operation` recovery reads for the original operation ID. Company, actor, membership, session, and operation identity remain server-bound, and the canonical original receipt is returned only while the underlying record remains in scope. Yard assignment/start/report uses `fleet:yard`; physical custody reporting now requires the distinct `fleet:custody` consent and current Yard or Driver/self-dispatch capability. Dispatch authority alone can assign Yard work but cannot report a physical custody observation. Existing grants are preserved without silent widening. Compliance deductions remain advisory and ticket flow remains available.

# VNDRLY plugin 1.19.0

Adds office-authorized Gate post-day billing across web/native/Ask V/ChatGPT: completed America/Chicago days, explicit approved agreement and first unbilled date, full partial-day rate unless agreement overrides, reviewed coverage gaps, continuation, conditional completed-day requests and opt-in interval. Uses existing financial scopes and exact trusted confirmation. Original receipt plus independent post readback distinguish submitted-for-partner-approval from delivered/paid. Assume/Handoff share the employee workday clock, separate from billing. Existing identity, accounts, grants and five service skills preserved. Installation, live scoped verification and public review are separate release evidence.

# VNDRLY plugin 1.18.0

Ticketed commercial Fleet workflow: real company pool drivers, reusable Details and saved Origin/Destination Runs; original-scope create/action/recovery; exact quantity and office charge review; explicit ticket submission; scoped operational reads. Existing account/grants/identity are preserved. Deployment, installation, scoped live read/action and public review remain separately verified release steps.

# VNDRLY plugin 1.17.0

Every new Fleet run now requires an explicit new-ticket or eligible open-ticket billing choice by authorized origin, AFE and work date. Catalog services supply their real rates and assigned AFE; ordered stops stay intact. Close Run submits one run for office review. Accepting a run leaves its shared ticket open until office staff explicitly finalize and submit it. New `query_fleet_billing_options` and `finalize_fleet_ticket` tools match native/web behavior. Separate `fleet:billing` write consent preserves existing grants. Finalization checks all run reviews, current plan version, authenticated confirmation and exact operation readback; unknown outcomes recover the original action without another write.

Matches Fleet Dispatch, Fleet Inventory and Details terminology and the canonical Fleet Inventory pool. Includes scoped inventory list/detail/history views and exact prepared create, enroll and metadata-edit actions. Separate `fleet:inventory` write consent prevents existing dispatch, driver or administration grants from silently gaining inventory writes. Current Fleet Manager plus Inventory authority remains required. Pool enrollment does not assign a Detail, change custody, release holds or create a run/ticket. Demo stays read-only. Gate operator entry/checkout now match the web workflow: authorized manual site/Gate selection and optional genuine device GPS, with existing confirmation and access checks. Visitor self-check-in and paid-travel/ticket location rules retain their separate requirements.

The approval flow supplies operation identity; completion requires exact receipt plus independent canonical asset readback. Unknown outcomes preserve the original action and recover using read-only lookups. Fleet UI Details are temporary work groups; internal IDs and actual Fleet Ops roles stay intact. Retains existing Work Hub, Gate, Inventory and Field Operations skills, all resources and VNDRLY.ai branding.

Preserve plugin `dev-6ac4f61e0aac8191b7f7b4fbbc5822b0`, app `asdk_app_6ac4f61e0aac8191b7f7b4fbbc5822b0`, connected accounts and existing grants. API deployment, tool-definition refresh and installation verification are release steps, not proven by this package version. Follow `docs/chatgpt-plugin-release.md` to update the existing installed entry and verify an actual scoped read and harmless synthetic approved action with canonical readback. Record installed, submitted, approved and public availability separately; pending review never means publicly available.

Catalog per_job/lump_sum charges use quantity one. For per_hour/per_day services, office acceptance through review_fleet_closeout requires explicit positive billingQuantity representing actual billable hours or days. Preserve the catalog unit; never infer a quantity from GPS, timestamps or elapsed run duration.

The same release simplifies the native driver's assigned-run path to one next step, explicit truck/rig condition choices, optional typed notes/photos, a single required odometer entry and explicit Start Run. Inspection reports bind the saved Detail components on web and iOS. Shared shift controls scroll on portal landing pages only; driver recovery and additional operations remain under More.
