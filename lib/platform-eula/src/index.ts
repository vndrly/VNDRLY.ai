/** VNDRLY Platform End User License Agreement (web + iOS). Counsel review recommended. */
export const PLATFORM_EULA_VERSION = "2026-10-29";

export const PLATFORM_EULA_TITLE = "VNDRLY Platform End User License Agreement";

export const PLATFORM_EULA_LAST_UPDATED = "October 29, 2026";

export const PLATFORM_EULA_PRIVACY_URL = "https://vndrly.ai/legal/privacy";

export const PLATFORM_EULA_TEXT = `VNDRLY Platform End User License Agreement

Last updated: ${PLATFORM_EULA_LAST_UPDATED}
Operator: VNDRLY ("VNDRLY," "we," "us," or "our")
Contact: legal@vndrly.ai | https://vndrly.ai
Effective for: Web application at https://vndrly.ai and the VNDRLY Field Mobile application (iOS)

1. Agreement

This End User License Agreement ("Agreement") is a binding contract between you and VNDRLY. By creating an account, logging in, clicking "I agree," installing or using the mobile app, or otherwise accessing the VNDRLY platform (the "Service"), you agree to this Agreement.

If you accept on behalf of a company, partner organization, or vendor organization, you represent that you have authority to bind that organization. In that case, "you" means that organization and its authorized users.

If you do not agree, do not use the Service.

2. Definitions

"Partner" means an organization that owns, operates, or manages field sites (wells, pads, facilities, or similar locations) and uses VNDRLY to post work, approve vendors, track jobs, and manage site operations.

"Vendor" means a contractor organization that performs field services for Partners and uses VNDRLY to bid on work, dispatch crews, submit tickets, and manage compliance.

"Field Employee" means an individual authorized by a Vendor (or, where applicable, a Partner) to use the mobile field portal to check in, track location, upload photos, communicate on jobs, and perform other field actions.

"Foreman" means a Field Employee with elevated permissions to initiate or manage jobs, assign crew, check crew in/out, schedule work, and perform related field leadership functions.

"Platform Admin" means VNDRLY personnel who operate, support, and administer the Service.

"Organization" or "Org" means a Partner org or Vendor org provisioned in the Service.

"Ticket" (also called a tracking number) means a work record in the Service representing a scoped job at a site, including status, crew, GPS events, photos, parts/labor, and payment lifecycle.

"Site" means a geolocated field location (often tied to an AFE or cost-center code) where work is performed or visitors check in.

"Hotlist" means Partner-posted time-sensitive work opportunities visible to Vendors for bidding and award.

"Vendor Catalog EULA" means commercial terms published by a Vendor as part of a catalog version that a Partner must accept before approving that Vendor—separate from this Agreement.

"User Content" means data you or your users submit: photos, comments, voice messages, documents, GPS coordinates, mileage, certifications, invoices, and similar materials.

"Authorized User" means an individual account tied to your Organization with a role such as admin, member, accounts payable ("AP"), field employee, or foreman.

3. What the Service Is (and Is Not)

VNDRLY is a software platform that helps Partners, Vendors, and field crews coordinate field operations: site locations, job tracking, crew assignment, GPS-verified check-in, visitor logs, compliance document storage, hotlist bidding, invoicing workflows, notifications, and related reporting.

The Service is not:

- A substitute for your organization's site safety program, HSE policies, or regulatory compliance program
- An insurance broker, legal advisor, or accounting firm
- A guarantee that any Vendor, Partner, Field Employee, or visitor is qualified, insured, or safe to perform work
- A real-time emergency response or 911 service
- A payroll, tax withholding, or workers' compensation administrator (unless explicitly stated in a separate written agreement)

You remain solely responsible for workplace safety, hiring, supervision, licensing, insurance, and compliance with applicable laws on your sites and jobs.

4. License Grant

Subject to this Agreement, VNDRLY grants you a limited, non-exclusive, non-transferable, revocable license to access and use the Service for your Organization's internal business purposes during your subscription or authorized use period.

For the iOS app: This license is for use on Apple-branded devices you own or control, as permitted by the Apple App Store Terms of Service. Apple is not a party to this Agreement and has no obligation to provide maintenance or support for the app.

Restrictions. You may not (and may not permit others to):

- Copy, modify, reverse engineer, decompile, or create derivative works of the Service (except as law allows)
- Resell, sublicense, or make the Service available to third parties except as intended (e.g., your Org's users)
- Circumvent access controls, rate limits, geofences, or audit trails
- Use the Service to build a competing product
- Upload malware, scrape the Service, or interfere with its operation
- Misrepresent identity, site access rights, certifications, insurance, or job status
- Use another user's credentials or share accounts except through authorized org administration

5. Accounts, Roles & Authority

5.1 Registration
You must provide accurate registration information and keep it current. You are responsible for all activity under your accounts.

5.2 Roles
The Service supports role-based access, including Partner admin/member/AP, Vendor admin/member, Field Employee, and Foreman roles. You are responsible for assigning roles correctly and revoking access when employment ends.

5.3 Organization context
Users with membership in multiple Organizations must use the Service only within the active Organization context. Cross-organization data access is prohibited except where VNDRLY explicitly enables platform administration.

5.4 Authority representations
By publishing a Vendor catalog, approving a Vendor, dispersing funds, accepting a Hotlist award, or binding your Organization to commercial terms, you represent that you have authority to act for that Organization.

6. Partner–Vendor Relationships & Separate EULAs

VNDRLY facilitates commercial relationships between Partners and Vendors but is not a party to your field services contracts.

When a Vendor publishes a catalog version with Vendor Catalog EULA text:

- Partners may be required to accept that EULA before approving the Vendor
- Acceptance may be logged with user identity, catalog version, hash, timestamp, IP address, and browser/device information
- New catalog versions may require re-acceptance

Vendor Catalog EULAs govern the commercial terms between that Vendor and Partner. This Agreement governs use of the VNDRLY platform itself. If there is a conflict between this Agreement and a Vendor Catalog EULA as between Partner and Vendor, the Vendor Catalog EULA controls that bilateral relationship—not VNDRLY's obligations to you as platform operator, unless VNDRLY is explicitly named as a party (it is not, under this Agreement).

7. Field Operations, Tickets & Site Access

7.1 Tickets and workflow
Tickets move through statuses such as initiated, in progress, pending review, submitted, approved, completed, funds dispersed, cancelled, or denied—depending on your Organization's workflow configuration. Status changes may require specific roles (foreman, office, partner AP/admin).

7.2 Geofencing and check-in
Check-in, check-out, en-route, and on-location events may be validated against site geofences. GPS and device signals can be inaccurate. VNDRLY does not warrant that geofence verification is error-free or sufficient for safety or payroll decisions.

7.3 Photos, notes, and audit trail
Users may attach photos, comments, and operational notes to tickets. These become part of the job record and may be visible to authorized users in the Partner/Vendor chain and Platform Admins supporting the Service.

7.4 Mileage and labor
Odometer readings, hourly/day rates, parts, and labor lines may be captured for billing and reporting. You are responsible for accuracy and for compliance with wage, tax, and contract requirements.

7.5 Safety
Field Employees and Foremen must follow site-specific safety rules, Partner requirements, and applicable law. Visitor and guest flows may require explicit safety acknowledgements; those acknowledgements do not replace your Organization's safety program.

7.6 Gate, Fleet, and Work Hub records

Enabled services may include gate admission and departure records, watch assignments, shift notes and handoffs, task hoppers, fleet dispatch and vehicle records, and Work Hub schedules, files, messages, and collaboration. Availability and permitted actions depend on your Organization's configuration and your access rights. Administrators are responsible for reviewing permissions and removing access when it is no longer appropriate.

Recorded counts, acknowledgements, presence, vehicle positions, and workflow statuses reflect available reports and may be delayed, incomplete, or corrected. They are not independent proof of physical presence, fitness for duty, payment, employment status, or site clearance. Your Organization remains responsible for approving access and resolving outstanding operational issues. Do not use communications or tracking as a substitute for emergency procedures.

8. Location Data & Background Tracking

The mobile app may request foreground and background location permission to:

- Record check-in/check-out at sites
- Share live location with authorized dispatchers while en route or on site
- Support crew maps and operational visibility

By enabling location sharing and using field features, you consent to collection and use of location data as described in our Privacy Policy (${PLATFORM_EULA_PRIVACY_URL}). Location sharing may be controlled through in-app consent settings and can be revoked, though some features may not work without location.

Location reports may include latitude, longitude, speed, battery level, and timestamps. Enabled tracking may support active jobs, gate watches, on-call availability, and other authorized duties, subject to device permissions and available sharing controls. Your Organization is responsible for lawful workforce monitoring and required notices and consents. Turning off one duty state does not necessarily end a separate active tracking session. Device restrictions, connectivity, and permissions may interrupt reporting; continuous tracking is not guaranteed. A displayed location may be last reported rather than current. Check its timestamp before relying on it.

Retention and deletion are governed by the Privacy Policy, applicable law, and any applicable written customer agreement. A reporting or map-history window is not a promise that all underlying records are deleted when that window ends.

VNDRLY may use location data to provide the Service, improve reliability, investigate disputes, and support audit/compliance features—not for unrelated advertising.

9. Mobile Application Terms (iOS)

9.1 Device permissions
The app may request access to:

- Camera — QR scanning, site photos
- Photo library — attach images to tickets
- Microphone — enabled voice messages, calls, transcription, and assistant voice interactions
- Location — as described in Section 8
- Face ID / Touch ID — optional convenience login that unlocks credentials stored locally on your device; VNDRLY does not receive biometric templates
- Push notifications — job assignments, mentions, schedule reminders, alerts

You may deny permissions; features depending on them may be unavailable.

9.2 Audio and communications
Enabled communications may process audio, messages, and transcripts to deliver the selected feature. Voice clips recorded through PTT may be uploaded and attached to ticket communication threads. Stored communications may be visible to authorized participants and administrators under the applicable access rules. You are responsible for having authority to share the content and for obtaining notices and consents required to record or transcribe communications. Calls and messages may fail or be delayed and are not an emergency service.

9.3 App updates
We may deliver updates via the App Store and/or over-the-air (Expo Updates) for bug fixes and features. Continued use after updates constitutes acceptance of the updated app as part of the Service.

9.4 Apple-specific terms
You acknowledge:

- This Agreement is between you and VNDRLY, not Apple
- Apple has no warranty or support obligation for the app
- Apple is not responsible for product claims, IP infringement claims, or regulatory compliance related to the app
- Apple and its subsidiaries are third-party beneficiaries of this Agreement and may enforce it against you
- VNDRLY, not Apple, is responsible for required maintenance and support and for applicable warranties not lawfully disclaimed
- If the app fails to conform to an applicable warranty, you may notify Apple for a refund of its purchase price, if any. To the extent permitted by law, Apple has no further warranty obligation, and remaining warranty-related claims are VNDRLY's responsibility
- VNDRLY, not Apple, is responsible for addressing product liability, consumer protection, and regulatory claims concerning the app, and for investigation, defense, settlement, and discharge of third-party intellectual property claims concerning the app
- You must comply with applicable Apple usage rules and third-party agreements, including your wireless service agreement. Permitted Family Sharing and volume-purchase use remain subject to Apple's applicable rules
- Nothing in this Agreement excludes rights or remedies that cannot lawfully be excluded

10. Hotlist, Bidding & Payments

10.1 Hotlist
Partners may post Hotlist jobs; approved Vendors may bid subject to eligibility rules (e.g., operating radius, geocoded site, insurance/compliance status). Awards may convert Hotlist posts into live Tickets.

10.2 No guarantee of work
Listing, bidding, or using VNDRLY does not guarantee awards, payment, or continued approval status.

10.3 Funds dispersal
Partner AP users may record payment dispersal against approved tickets (method, reference, notes, receipt photos). VNDRLY records workflow state; actual money movement occurs outside the Service through your banking/payment processes unless a separate integrated payment feature is explicitly offered and agreed.

10.4 Accounting integrations
Optional integrations (e.g., QuickBooks Online, OpenAccountant) connect third-party systems under their terms. You authorize data sync necessary to operate those integrations.

10.5 Tax reporting
Vendor onboarding may include 1099 electronic delivery consent and collection of tax identifiers. You are responsible for tax reporting obligations; VNDRLY tools assist recordkeeping but do not replace professional tax advice.

11. Compliance Documents & Certifications

Vendors may upload certificates of insurance (COI), workers' compensation, general liability, auto liability, W-9, and related documents. Field Employees may upload certifications (e.g., safety training) with expiration dates.

VNDRLY may display compliance status, send expiration alerts, and automatically change approval status when documents expire or fail validation rules configured in the Service.

VNDRLY does not independently verify insurance coverage unless explicitly stated in a separate service. Display of "valid" or "approved" status reflects information you provided and system rules—not an underwriting decision.

12. Visitors & Guest Access

Partners and Vendors may operate visitor check-in flows (web portal, QR codes, mobile guest login). Visitors may provide name, contact information, company, vehicle plate, purpose of visit, and safety acknowledgement, along with GPS at check-in.

Hosts are responsible for authorizing visitors, enforcing site access rules, and emergency procedures. VNDRLY is not responsible for physical security at sites.

13. AI Assistant ("askV")

The Service may include AskV, an AI assistant that answers questions, generates summaries, and, where enabled and authorized, performs actions using connected tools. Access depends on the signed-in user's permissions and authorized Organization context. Review proposed actions and confirmations carefully. Instructions to the assistant do not grant rights you do not otherwise hold.

Prompts, attachments, voice inputs, retrieved records, and responses may be processed by service providers to deliver these features as described in the Privacy Policy. Do not submit information you are not authorized to share. AI-generated material may omit context or misstate records; verify the underlying source. Assistant features and integrations are not guaranteed to complete an action, deliver a communication, or contact emergency personnel.

AI output may be inaccurate or incomplete. It is not legal, safety, engineering, medical, or financial advice. Verify critical decisions through official records, qualified personnel, and your Organization's policies. Do not rely on AI output for emergency actions.

14. User Content & License to VNDRLY

You retain ownership of User Content. You grant VNDRLY a worldwide, non-exclusive license to host, store, reproduce, process, display, and transmit User Content solely to operate, secure, improve, and support the Service, including backups, audit logs, and compliance with law.

You represent that you have all rights necessary to submit User Content and that it does not violate law or third-party rights.

15. Confidentiality

Non-public information about another Organization's jobs, pricing, sites, crew locations, or commercial terms accessed through the Service is confidential. You may use it only as needed for authorized work under this Agreement and must not disclose it to unauthorized parties.

16. Third-Party Services

The Service relies on third-party infrastructure and services, which may include cloud hosting/database (Supabase), email delivery providers (when enabled for paid tiers), mobile distribution (Apple, Expo), error reporting (Sentry, if enabled), maps (e.g., ArcGIS, Google Maps links), and AI providers (Anthropic). Your use may be subject to those providers' terms and privacy policies.

VNDRLY is not responsible for third-party outages beyond our reasonable control.

17. Privacy

Our Privacy Policy at ${PLATFORM_EULA_PRIVACY_URL} explains what personal data we collect (account data, GPS, photos, audio, device tokens, audit logs, etc.) and how we use it. This Agreement incorporates the Privacy Policy by reference.

18. Service Availability & Changes

We strive for reliable operation but do not guarantee uninterrupted or error-free Service. We may modify features, impose rate limits, perform maintenance, or discontinue features with reasonable notice where practicable.

Beta or TestFlight builds may contain bugs; you accept heightened risk when using pre-release builds.

18.1 Commercial terms

Pricing, subscription duration, renewal, cancellation, and any refund rights are governed by the applicable order form, subscription offer, written customer agreement, or app-store purchase terms. This Agreement does not create a new subscription, automatic-renewal arrangement, or payment obligation by itself. Mandatory rights under applicable law remain unaffected.

18.2 Changes to this Agreement

Material changes will be communicated through the Service or the account contact information before they take effect, except where an earlier change is required by law or an urgent security issue. The revised version and effective date will be identified. Where affirmative acceptance is required, we will request it. Changes do not retroactively alter accrued rights. If you disagree, stop using the affected Service and follow the applicable cancellation terms.

19. Suspension & Termination

We may suspend or terminate access if you breach this Agreement, pose a security risk, or if required by law. You may stop using the Service at any time.

Upon termination, your license ends. Provisions that by nature should survive (confidentiality, disclaimers, liability limits, dispute resolution) survive.

Before closing an account, use available export tools or contact support regarding retrieval of Organization records. Post-termination access, retention, and deletion are subject to the Privacy Policy, applicable legal obligations, and any written customer agreement; this Agreement does not promise an unspecified recovery period. Records shared with another authorized Organization may remain in its records, subject to applicable law.

20. Disclaimers

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE." TO THE MAXIMUM EXTENT PERMITTED BY LAW, VNDRLY DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ACCURACY OF GPS, GEOFENCING, COMPLIANCE STATUS, OR AI OUTPUT.

21. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW:

- VNDRLY WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOST PROFITS, LOST DATA, BUSINESS INTERRUPTION, OR SITE INCIDENTS, EVEN IF ADVISED OF THE POSSIBILITY
- VNDRLY'S TOTAL LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THE SERVICE IN ANY 12-MONTH PERIOD WILL NOT EXCEED THE GREATER OF (A) AMOUNTS YOU PAID VNDRLY FOR THE SERVICE IN THAT PERIOD OR (B) US $100

Some jurisdictions do not allow certain limitations; in those cases, limits apply to the fullest extent allowed.

22. Indemnification

You will defend, indemnify, and hold harmless VNDRLY and its officers, directors, employees, and agents from claims arising out of:

- Your User Content
- Your Organization's field operations, site access, safety incidents, or employment practices
- Misrepresentation of insurance, certifications, or authority
- Violation of law or this Agreement
- Disputes between Partners and Vendors (except to the extent caused by VNDRLY's gross negligence or willful misconduct)

23. Dispute Resolution & Governing Law

This Agreement is governed by the laws of the State of Texas, excluding conflict-of-law rules. Exclusive venue for disputes shall be state or federal courts located in Harris County, Texas, and each party consents to personal jurisdiction there.

24. Export & Sanctions

You may not use the Service in violation of U.S. export laws or sanctions programs. You represent that you are not located in a country subject to a U.S. government embargo or designated as supporting terrorism, are not on a U.S. government prohibited or restricted-party list, and are not otherwise barred from receiving the Service.

25. General

- Entire agreement (with Privacy Policy and any order form)
- Assignment — you may not assign without consent; VNDRLY may assign in connection with merger/acquisition
- Severability
- No waiver
- Force majeure
- Notices — email to account admin and/or posting at vndrly.ai`;

/** Use stored catalog EULA when present; otherwise show the platform EULA. */
export function resolveEulaDisplayText(text: string | null | undefined): string {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed.length > 0 ? trimmed : PLATFORM_EULA_TEXT;
}
