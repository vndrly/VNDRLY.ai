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
