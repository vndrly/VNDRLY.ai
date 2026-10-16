# Fleet operations: Oklahoma and Texas scope and research

Research date: October 16, 2026. Status: proposed product scope for review; not an implementation or a compliance certification. The user confirmed Oklahoma and Texas as the initial jurisdictions. Include applicable federal interstate rules and federally applicable hazardous-material rules. Other states, international transport, passenger service and household-goods moving are outside this first rule set.

**User-confirmed operating policy, October 16:** commercial tickets must keep flowing, including offline and through intermittent connections. Compliance initially runs in **warn-only** mode. Truck, rig and driver have green/red compliance dots; expired, revoked, missing or otherwise unsatisfied compliance is recorded and disclosed on the partner's run/ticket detail without automatically preventing run creation, performance, closeout or ticket submission. Later partner enforcement must be explicit, effective-dated and governed by the same requirements. The initial warning mode records commercial activity and exceptions; it does not grant legal permission, reinstate a revoked credential or certify unsafe equipment as fit.

## 1. Operating model

Use the existing Inventory, people, run, evidence, maintenance, ticket and notification records. A **Detail** is a reusable, revisable combination of a truck/power unit, an optional towed rig/package, and a driver whose qualification/compliance status remains visible. Reservations are temporary; the combination can remain available for subsequent work until changed. A **run** is a particular assignment using a versioned snapshot of that Detail, a route, cargo/work instructions, and a mandatory billing ticket.

Keep four identities separate:

- **Asset:** the canonical Inventory record for a truck, trailer, dolly, pump or other durable equipment.
- **Rig/package:** a reusable grouping of towed equipment, retaining each component's identity, condition and maintenance history. A service truck can run without a towed package.
- **Detail:** truck + rig/package + driver, with effective dates, availability and assignment history.
- **Load:** the material/equipment carried on a particular run. Crude oil is cargo, not a new inventory asset or a permanently attached component of the Detail.

An existing inventory asset being transported can be referenced by a load without becoming the hauling rig. Creating a Detail does not transfer Inventory custody or create duplicate assets. Leasing, ownership, custody, physical hookup and dispatch reservation remain distinct facts.

**Preserve the shipped billing contract:** every new run opens a new ticket or joins an eligible open ticket. Shared tickets match the authorized billing site, partner, AFE snapshot and work date, and must permit batching. Drivers close runs; authorized office staff review each run; office explicitly finalizes/submits the ticket. Return-to-base, midnight, GPS arrival and individual run review do not silently submit a ticket.

## 2. Existing work that informs this proposal

Read-only inspection of the current release source found these foundations. Code presence is not proof of physical iPhone or provider delivery.

| Area | Existing foundation | Work to add or refine |
| --- | --- | --- |
| Fleet Inventory | Canonical assets, enrollment, asset detail, history, maintenance references | Regulatory vehicle specifications, rig packages, a true Detail builder |
| Authorization | Company, role, site and legacy `fleetIds` grants; separate safety-release and finance permissions | Preserve this access model while introducing Detail identity; never repurpose a permission group as an assembled vehicle |
| Run lifecycle | Dispatch, acknowledgement, inspection, start/pause/resume, ordered stops, loads/deliveries, driver closeout, office review | Clear stage-oriented driver experience, Detail selection, reservations and route-location references |
| Billing | Required new/shared ticket, canonical charges and explicit office finalization | Keep it; expose review and batching clearly on dispatch/ticket surfaces |
| Qualifications | Verified, unexpired named employee certifications | Structured CDL class/restrictions, medical status, DQ records, testing/Clearinghouse and HOS eligibility |
| Inspections/evidence | Configured inspection responses, photo/document evidence, defects, maintenance holds and equipment replacement | Asset/component-specific damage views, prior-damage comparison and linked pre/post-trip reports |
| Locations | Vendor/partner destination records with address, coordinates, material compatibility, hours and instructions | Dedicated Origins and Destinations page; physical locations separate from billing-site authority |
| Notifications | Canonical run events create scoped in-app notices and use the existing push path | Receipt/acknowledgement monitoring, escalation, production SMS readiness and opted-in delivery |
| Map | Driver-phone location, source/freshness, history, next-stop driving ETA | Speed sample contract, telemetry adapters, truck-route support, trigger management and physical-device acceptance |
| Recovery | Versioned actions, idempotency, encrypted native offline queue and independent result readback | Full offline ticket/run creation and execution, durable attachments, isolated conflict recovery, Detail reservations and compliance snapshots |

Relevant existing files: `lib/api-zod/src/fleet.ts`, `fleet-commercial.ts`, `fleet-inventory.ts`, `fleet-planning.ts`, `fleet-location.ts`; API services `fleet-ops.ts`, `fleet-billing.ts`, `fleet-commercial.ts`, `fleet-notifications.ts`, `fleet-evidence.ts`, `fleet-availability.ts`, `fleet-maintenance.ts`, `fleet-eta.ts`; native `fleet-background-location-native.ts`, `fleet-offline-native.ts`, `fleet-push-notification.ts`. Existing requirements: `docs/vndrly-fleet-approved-scope.md`, `fleet-implementation-acceptance.md`, `fleet-run-billing-workflow.md`, `communications-launch-readiness.md`.

The current UI label “Details” covers configuration that still has legacy fleet-group semantics. This proposal introduces an actual operational Detail without deleting those configuration/access records or historical runs. The current location schema has coordinates, accuracy and timestamps, but no speed field. The current ETA response explicitly states `truckSafeRouting: false`.

The existing native offline queue supports assigned-driver actions against cached, already-created runs; it is not yet full offline dispatch or new-ticket/run creation. Its 64-action limit and strict sequential replay/conflict behavior must be revisited for commercial duty. A refused sequence currently prevents further facts being enqueued for that run; the proposed design must preserve new local observations and isolate reconciliation conflicts instead. Those are actual implementation gaps, not delivered capabilities.

## 3. Vehicle and carrier compliance research

Requirements must be selected from operating facts, not a global “DOT compliant” checkbox. Capture carrier identity/legal name, USDOT and authority identifiers, private versus for-hire operation, interstate character of the freight, operating states, vehicle and combination weights/ratings, axles, dimensions, cargo classification, tank specifications, hazardous-material quantities, and any documented exception.

**Federal applicability.** Interstate cargo operations can trigger USDOT requirements at 10,001 pounds using the relevant actual/rated vehicle or combination weight. Interstate commerce includes some movements wholly within one state when they are part of interstate transportation. Interstate for-hire authority is a separate determination from having a USDOT number. [FMCSA USDOT applicability](https://www.fmcsa.dot.gov/registration/do-i-need-usdot-number), [registration framework](https://www.fmcsa.dot.gov/registration/getting-started).

**Oklahoma.** OCC describes licensing for intrastate for-hire property carriers and a separate private-carrier path, including the applicable heavy-vehicle threshold. Track the actual authority class and required vehicle credentials. The current Chapter 30 compilation is effective August 1, 2026; use its for-hire/private provisions and exceptions rather than an older 2025 copy. The OCC compilation notes that the Secretary of State's official rules control. [For-hire licensing](https://oklahoma.gov/occ/divisions/transportation/trucking/intrastate-licenses-for-hire-motor-carriers.html), [private licensing](https://oklahoma.gov/occ/divisions/transportation/trucking/intrastate-licenses-for-private-motor-carriers.html), [current rules](https://oklahoma.gov/occ/rules/current-rules.html).

**Texas.** TxDMV lists intrastate registration triggers including a vehicle/combination over 26,000 pounds by the listed weight measures and placardable hazardous materials. Track TxDMV authority and the insurance cab card where applicable. Texas's removal of many noncommercial safety inspections does not remove commercial inspection requirements. [TxDMV registration](https://www.txdmv.gov/motor-carriers/txdmv-number), [DPS commercial inspections](https://www.dps.texas.gov/section/vehicle-inspection/inspection-criteria-commercial-inspection).

**Vehicle records.** Store VIN/unit identifiers, plate/state/expiration, title/lease references, GVWR/GCWR/registered and actual weights, axle configuration, dimensions, tow/coupling ratings, cargo capacity, periodic inspection, preventive maintenance and unresolved defects. Part 396 requires systematic inspection/repair/maintenance and applicable periodic inspections; photos supplement rather than replace the required inspection. [49 CFR Part 396](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396), [FMCSA inspection guidance](https://csa.fmcsa.dot.gov/SafetyPlanner/MyFiles/SubSections.aspx?ch=22&eta=97823&sec=65&sub=148).

**Trip-specific credentials.** Include applicability checks for IRP apportioned registration or trip permits, IFTA/fuel-trip permits, UCR, oversize/overweight permits and route restrictions. Form 2290 has a 55,000-pound taxable-gross-weight threshold, with its own rules. Retain fuel purchases, jurisdiction mileage and supporting evidence; a sparse phone trail is not automatically an audit-complete tax record. [TxDMV IRP](https://www.txdmv.gov/motor-carriers/commercial-fleet-registration/apportioned-registration), [Texas IFTA](https://comptroller.texas.gov/taxes/fuels/ifta.php/), [UCR](https://www.ucr.gov/), [IRS 2290 instructions](https://www.irs.gov/instructions/i2290).

**Crude oil and other regulated loads.** The shipper-approved classification and actual packaging/quantity determine applicable shipping papers, placards, endorsements, training, emergency information, permits and insurance. Do not infer all of these from the word “crude.” Include residue/uncleaned-tank return legs in the determination. Specification cargo tanks need their own test/inspection schedule based on specification, service and exceptions, not one universal annual sticker. Oklahoma deleterious-substance and Texas waste-hauling permissions need a separate commodity-specific check when that business is enabled. [PHMSA registration](https://www.phmsa.dot.gov/registration/registration-information), [hazmat communication/training rules](https://www.phmsa.dot.gov/regulations/title49/part/172), [cargo tanks](https://www.phmsa.dot.gov/regulations/title49/section/180.407).

**Current-rule exception example.** FMCSA presently reports temporarily suspended biennial-update enforcement and associated USDOT inactivation for updates due on or after June 1, 2026 during the Motus transition. Preserve the due date, official notice and review date; do not automatically declare a carrier inactive solely from that overdue date. This notice does not waive other obligations. [FMCSA notice, updated September 10, 2026](https://www.fmcsa.dot.gov/registration/temporary-suspension-biennial-update-requirement).

## 4. Insurance: requirements and tracking method

Illustrative liability minimums, subject to exact carrier/cargo applicability and exceptions:

| Operation | Researched example |
| --- | --- |
| Federal interstate for-hire nonhazardous property, GVWR at least 10,001 lb | $750,000 liability in FMCSA's filing chart |
| Certain oil/hazardous-material operations | $1 million category; certain higher-risk materials/quantities have a $5 million category. Classify the actual shipment. |
| Oklahoma intrastate for-hire ordinary property, GVWR at least 10,000 lb | $750,000 under OAC 165:30-3-11; special commodity categories differ |
| Oklahoma covered intrastate private carrier, nonhazardous commodities | $350,000 under OAC 165:30-15-6; deleterious/hazardous categories differ |
| Texas covered private/for-hire nonhazardous heavy carrier | $500,000 “All Others” category over 26,000 lb; listed oil/fuel/hazmat categories can require $1 million or $5 million |

[FMCSA filing chart](https://www.fmcsa.dot.gov/registration/insurance-filing-requirements), [FMCSA Part 387 financial-responsibility explanation](https://csa.fmcsa.dot.gov/SafetyPlanner/MyFiles/SubSections.aspx?ch=21&eta=13894&sec=60&sub=119), [Oklahoma current Chapter 30, §§165:30-3-11 and 165:30-15-6](https://oklahoma.gov/content/dam/ok/en/occ/documents/ajls/jls-courts/rules/2026/chapter%2030%20MCC%20and%20Transportation%20Network%20Companies%20_eff%2008-01-2026.pdf), [Texas insurance table](https://www.txdmv.gov/motor-carriers/txdmv-number).

The product should maintain a **coverage register**, not just upload a COI:

- Insured legal entity, insurer/agent, policy number, effective/end/cancellation dates, coverage type, limits, deductible, territorial/cargo/use restrictions and covered owned/hired/nonowned equipment.
- COI, policy/endorsement references, covered asset schedule and trailer-interchange/leased-equipment treatment as applicable.
- Required regulator filings and their actual acceptance/current status, including applicable BMC forms, MCS-90 and state forms. An uploaded document is not proof that the regulator accepted a filing.
- Separate legal minima, customer-contract requirements and company preferences. Cargo, pollution/spill, general liability, physical damage, workers' compensation and umbrella requirements need separate applicability/contract review; none is a universal substitute for auto liability.
- Match coverage to the actual carrier, truck, towed package, cargo, territory and planned service period. Do not simply add unrelated policy limits together; review excess layers and exclusions.
- Suggested renewal reminders at 60/30/14/7 days, an assigned owner, renewal version history and explicit verified-by/verified-at/source fields. These reminder intervals are product policy, not statutory deadlines.

A certificate is evidence, not an insurance policy and cannot expand coverage. VNDRLY should show “document received,” “reviewed,” and “filing verified” separately. [Texas Department of Insurance COI guidance](https://www.tdi.texas.gov/certificates/faq.html).

## 5. Drivers: qualification, licensing and duty

Build a restricted-access driver qualification record linked to the existing person/user:

- License issuing state, class, number (masked by default), status, expiration, endorsements and restrictions. Class A/B thresholds depend on the actual/rated combination and towed weight; N/H/X and equipment restrictions matter for tanker/hazmat work. Track relevant ELDT and training evidence. [FMCSA CDL classes/endorsements](https://www.fmcsa.dot.gov/registration/commercial-drivers-license/drivers).
- Record applicable age/operating restrictions and the carrier's reviewed general-driver-qualification assessment under Part 391, including required ability to understand English road signs, official inquiries and records. These are documented carrier reviews, not automatic hiring judgments from AI, accent or nationality. [FMCSA general qualifications](https://csa.fmcsa.dot.gov/SafetyPlanner/MyFiles/Sections.aspx?ch=23&eta=50059&sec=66).
- Employment application, required prior-employer safety history, road test or permitted equivalent, initial MVR and annual MVR inquiry/review, and applicable medical qualification/variance and self-certification status. Validate the required current evidence, including state/CDLIS medical status where appropriate, rather than treating an image of a card as conclusive. Some non-CDL CMV drivers still need qualification records. [FMCSA DQ guidance](https://csa.fmcsa.dot.gov/SafetyPlanner/MyFiles/SubSections.aspx?ch=23&eta=39108&sec=66&sub=152), [annual record review](https://www.fmcsa.dot.gov/registration/commercial-drivers-license/what-extent-must-motor-carrier-review-drivers-overall-0), [medical guidance](https://www.fmcsa.dot.gov/registration/commercial-drivers-license/medical).
- For applicable CDL duties: pre-employment drug testing, random-program participation, other required testing events, Clearinghouse pre-employment/annual queries and prohibited/return-to-duty status. Authorized reviewers manage consent and official/provider evidence. Dispatch sees eligibility and reason category, not lab results or medical detail. [FMCSA testing](https://www.fmcsa.dot.gov/regulations/drug-alcohol-testing/who-do-i-test), [Clearinghouse queries](https://clearinghouse.fmcsa.dot.gov/FAQ/Topics/Queries%2Cqueries-and-consent-requests).
- Site-specific orientation, H2S/PPE, tanker/loading procedures and job training according to the actual work/customer policy. Hazmat employee training has its own recurrent requirements, distinct from holding an endorsement. [PHMSA training](https://www.phmsa.dot.gov/about-phmsa/hazardous-materials-training-requirements).
- Schedule availability, actual duty, HOS/ELD status and remaining legal capacity where available. Federal property-carrying HOS generally includes 11 driving hours after 10 off, the 14-hour window, break requirements and 60/70-hour limits; exceptions require their own facts and records. A calendar “available” slot is not proof of legal driving hours. [FMCSA HOS](https://www.fmcsa.dot.gov/regulations/hours-service/summary-hours-service-regulations).

Do not apply an oilfield waiting-time exception to every oilfield truck; FMCSA specifically limits it to qualifying specialized equipment/operators. Do not label VNDRLY's phone tracking an ELD: required engine synchronization is a separate capability. Start with an approved integration to a suitable registered ELD/provider where required; selecting a new provider is a later approval decision. [Oilfield guidance](https://www.fmcsa.dot.gov/regulations/hours-service/what-kinds-oilfield-equipment-may-drivers-operate-while-taking-advantage), [ELD functionality](https://www.fmcsa.dot.gov/hours-service/elds/eld-functions-faqs).

Texas also publishes distinct intrastate HOS provisions under 37 TAC 4.12. Select the legally applicable regime from the carrier/trip and full duty history; never switch to a more permissive clock merely because a truck enters Texas. Validate the current state exceptions before enforcing a calculation. [Texas DPS HOS guidance](https://www.dps.texas.gov/internetforms/forms/mcs-9.pdf).

Medical verification must reflect current state processes: Service Oklahoma states it no longer accepts paper Medical Examiner Certificates as of February 17, 2026. The product should track the authoritative medical-status evidence and appropriate electronic process, not instruct every Oklahoma CDL driver to upload a paper card to the state. [Service Oklahoma](https://oklahoma.gov/service/all-pages/cdl-first-time-applicants.html).

## 6. The compliance method inside VNDRLY

Create effective-dated requirement sets for Federal, Oklahoma, Texas, carrier policy and customer contracts. Each requirement records its source/section, applicability facts, effective dates, evidence type, renewal basis, responsible reviewer, reviewed date and operational consequence. Rules and evidence are versioned; a document parser may propose fields but cannot self-verify legal eligibility.

Show separate **green/red compliance dots for the truck, rig/package and driver**, alongside plain-language reasons and the last evaluation time. Green means the applicable recorded requirements are current and satisfied as of that evaluation. Red means one or more are expired, revoked, missing, failed or unverified. Distinguish “not verified” from a confirmed violation in the reason; never label a stale cached record as freshly verified. An approaching expiration can retain green until due while showing a separate due-soon warning. A Detail is red if any required component/driver is red. Use accessible text/icons with the color and the existing branded pills for supporting actions; do not imply government certification.

Evaluate separately at Detail creation, reservation, dispatch, driver acceptance/start, equipment/driver change, material/route change, closeout and ticket submission. Plan against the entire expected run, including return travel. Save the rules, evidence references, evaluation time, source freshness and exceptions used for each decision. Re-evaluate cached expirations locally even without a network. If evidence expires during a run, record the change and alert the responsible manager when possible without erasing facts or silently terminating the ticket.

**Initial warn-only mode:** red compliance does not remove resources from dropdowns, force a renewal step, or automatically prevent creating/dispatching/starting/closing the run or submitting its reviewed ticket. Show the reason visibly and persist a warning acknowledgement with the ordinary action, without an extra approval round trip. An operator's acknowledgement does not turn the dot green, remove an exception, or claim a legal exemption. An informational warning is not authority to operate contrary to law. Confirmed revocation, an out-of-service order or serious damage remains truthfully labeled and auditable; recording an event never certifies that the operation was lawful or equipment was safe. Explicit operational stop-work/maintenance controls are separate from document-compliance scoring and must be individually reviewed rather than silently disabled by this policy.

**Partner disclosure:** the partner's authorized run detail and ticket review packet show the truck/rig/driver dots and relevant compliance exception categories at dispatch/start, during the run where captured, and closeout/submission. Show current status separately. Later renewal must not rewrite a run's earlier red snapshot. Give partners sufficient reason and timing to evaluate the work, without exposing private medical/testing files, full license numbers or unrelated company records.

**Future partner enforcement:** define explicit modes `warn_only` and `enforced`, scoped to the partner/site/contract and applicable work. `warn_only` is the initial default; enforcement requires an authorized policy change with effective date, requirement version, notice and defined checkpoints such as dispatch, start and/or partner submission. Preview affected Details and upcoming runs before activation. Define treatment for already-dispatched and offline runs before activation; preserve their historical policy snapshot and do not silently backdate enforcement or delete earned activity. Strict submission can route an exception for a partner decision or refuse submission under that explicit policy, while preserving the underlying run and ticket. No ordinary checkbox or acknowledgement can manufacture a legal waiver.

Crucially, GPS loss, failed notifications and unavailable provider lookups must not prevent local ticket/run creation, recording work or damage, starting/pausing safely, reporting an emergency or closing/reporting what actually happened. Preserve manual operational records with source and discrepancy flags. A failed lookup produces an explicit unverified/red reason and never an invented pass or erased event. Company/site authorization, tenant isolation, duplicate prevention and billing integrity remain separate safeguards; warning-only compliance is not a grant to another company's records.

## 7. Inventory and Details page

Rename the requested Fleet Inventory surface to **Inventory and Details**, preserving the canonical general Inventory and existing asset history. Within it, use branded gray cards with light lettering and 2px company-color borders.

**Build a Detail** card:

| Available Trucks | Available Rig Packages | Available Drivers |
| --- | --- | --- |
| Search/unit/type/capacity | Search/trailer/type/capacity | Search/name/license/qualification |
| Availability plus green/red compliance dot | Compatibility, availability and green/red dot | Availability plus qualification/compliance dot |
| Inspect asset/history | Inspect components/history | View permitted readiness summary |

Selection summary: `Detail D-017 · Truck T-104 + Tank Package RP-08 + Driver Jane Doe` with planned window, base, constraints, one dot per member and a **Create Detail** action. Truck-only/service work explicitly permits “No towed package.” Resources remain selectable with red compliance during warn-only mode. Provide an adjacent “Needs attention” view with reasons rather than silently hiding them. Keep schedule conflicts and actual availability distinct from compliance color.

Creating a reusable Detail does not reserve its members indefinitely. Reservation is explicit for a time window or active run and checked atomically across every component and driver. The UI may suggest an existing Detail or assemble one while creating a run. Conflicting reservations are shown before dispatch. Release operational availability when the driver closes the run/returns assets as required; office billing review must not unnecessarily keep the truck reserved. Outstanding defects can keep equipment unavailable.

Changes create a new Detail revision and affect future use. A dispatched run retains its exact assignment snapshot. Swapping a truck, trailer or driver invokes the existing reassignment/replacement workflow, including acknowledgement and a fresh equipment-bound inspection where required. No silent historical rewrites.

## 8. Origins and Destinations page

Add a clearly labeled **Origins and Destinations** navigation item and searchable location page. Reuse and extend existing destination records; do not create a parallel address book.

Location types: partner site, pickup point, terminal/collection point, disposal facility, company base/yard, maintenance facility and other authorized operating location. One location can be both origin and destination.

Each card supports name, owner, permitted users/companies, address, map position, optional geofence, hours/time zone, contact, access/approach instructions, compatible material, capacity/appointment notes, required permits and active/temporary dates. Site-entry point and actual loading/unloading point can differ. Facility acceptance requirements and customer authorization are separate from simply knowing its coordinates.

**Important current gap:** run stops presently require a partner-site ID, while some destination information is an attached snapshot. A vendor yard or third-party collection point must become a first-class physical location without fabricating a partner site or inheriting access to customer billing. Keep `billing site + partner + AFE` explicit and authorized; origin/destination choose where the vehicle goes. Preserve the location revision used on every stop.

Dropdowns search only authorized locations and display type/city to disambiguate names. Permit inline creation by authorized staff. Missing GPS must not hide a named location or stop a truthful manual arrival/closeout record; flag unverified arrival separately. Geofence triggers suggest/record observations, not automatic delivered cargo or billing approval.

## 9. Dispatch, driver and office flow

1. Dispatcher chooses **new ticket** or **eligible open ticket**, authorized billing site/AFE/date/service, and a run-specific description.
2. Choose origin, destination, optional return base, planned times, cargo/quantity/unit and required facility instructions. Support additional hauling cycles and ordered intermediate stops; validate weight, capacity and compatibility against the entire combination.
3. Choose a Detail from a dropdown showing truck/package/driver and readiness. Allow permitted assembly from available resources. Show the reservation and compliance results before dispatch.
4. Save the run/ticket link atomically, locally when offline and on the server after synchronization. An offline new ticket has a durable local reference until the canonical server ticket number is issued; an existing ticket uses its cached reference and reconciliation rules. Dispatch is a distinct, audited action. Explicit **Create and dispatch** may combine the user interaction. Remote notifications wait for a committed server assignment and connectivity; offline capture must not claim they were delivered.
5. Driver receives the assignment in **My Runs**/Work Hub, an app push and opted-in SMS where ready. The notice opens the exact current run and ticket. Driver acknowledges or reports inability; sent/delivered/opened/acknowledged are separate states.
6. Driver views truck/package details and prior unrepaired damage, completes an appropriate inspection, records required photos/notes and reports defects. Inspection belongs to the exact driver/asset combination and capture time. A critical defect opens the maintenance/safety path; the driver does not certify their own repair release.
7. Once ready, **Start Run** begins actual run execution. Driver records arrival, loading, departure, delivery and return as applicable. Load/delivery records hold actual quantities, units, references, seals and evidence.
8. Driver uses **Close Run**, with final condition/notes/photos, undelivered-load exceptions, meter/fuel entries where needed and post-trip defect report. This records operational closure and requests office review; it does not submit to the partner or declare the assets repaired.
9. Office reviews route/stops, manifests, quantity discrepancies, damage, charges and evidence. Accept or return a specific item for correction. Preserve originals and correction history.
10. Office explicitly finalizes/submits the ticket when all linked noncancelled runs and required billing facts are ready. A shared ticket remains open for additional eligible runs until then.

Use one primary action appropriate to the current driver stage. Protect against accidental duplicate starts/closeouts. Support rejection, no-show, cancellation, breakdown, partial delivery, alternate destination, handover and return-to-base exceptions. Do not require interacting with a detailed form while driving.

The requested photo walkaround is a company/VNDRLY evidence requirement, selected by equipment and work type. Do not describe every requested image or per-run checklist as a universal DOT mandate. A competent periodic inspection, driver inspection, damage report and repair-release record serve different purposes and must remain distinguishable.

## 10. Notifications and dependable field operation

Reuse the existing notification path. Add durable delivery/retry receipts and a dispatch attention queue for assignments without acknowledgement after a configured interval. SMS is voluntary, requires the existing consent/opt-out process and a production-ready approved sender. Do not equate a configured API key or provider acceptance with handset delivery. Verify a real iPhone push/open-to-run flow and a real opted-in SMS delivery before promising those channels as dependable.

The present Fleet notification implementation catches delivery failure after a committed run; the proposed delivery view must make such failures visible without reversing or duplicating the run. The current communications-health checks distinguish sender registration, credentials and push endpoint readiness. Current provider approval/delivery has not been reverified by this research task.

### Offline operation is a first-release requirement

The field app must support a full working period without connectivity, plus repeated partial reconnections. Expand the existing encrypted queue into a durable account/company-scoped local work journal and outbox; do not create a parallel competing run system.

- Cache authorized people, asset/Detail identities, locations, service/pricing references, open-ticket summaries and policy/evidence snapshots before duty. An initial verified sign-in/provisioning still needs connectivity. Scope access to the verified account and company; offline mode does not invent new authority.
- Allow local creation of a new ticket and linked run, addition of a run to a cached open ticket, assignment/acknowledgement on the acting device, inspections/photos, start, stop activity, load/delivery, damage, notes and driver closeout. Preserve the mandatory billing choice even when offline. Missing network is never itself a ticket-creation veto.
- Support unplanned work: authorized users can capture a provisional new physical location and work description when the address book/catalog is unavailable. Keep these as unresolved local references and show unpriced work explicitly; do not invent an approved partner, AFE, service rate or usable canonical billing relationship. Office resolves the references and pricing before canonical financial submission while the field work record remains intact.
- Allocate collision-resistant local ticket/run/operation IDs and show a readable **Local ticket — pending sync** reference. Do not fabricate a canonical server ticket number. When connected, atomically create/bind the canonical ticket/run and retain a permanent local-to-server reference map, including attachment and event links.
- Queue commands with their dependencies, base revision, original capture time, device identity and compliance/policy snapshot. Store photo bytes durably and upload resumably; preserve attachment metadata and visible upload status if only the record syncs. GPS and optional photo upload failures must not prevent recording subsequent work. Never falsely label an incomplete upload synced.
- Persist across app restart and OS termination, secure sensitive local data, and recover interrupted writes. Engineer a realistic multi-day event/attachment capacity and visible storage health; the existing 64-action cap is not an adequate commercial-duty target. No silent eviction of unsynced records. Warn early about device storage and provide a recovery path.
- Reconcile automatically after reconnect with idempotent operations and independent canonical readback. Repeated uploads must not create another ticket, run or billable charge. Do not replay a driver action against a changed driver/equipment assignment without resolving the conflict.
- If a cached open ticket closed elsewhere, two devices reserved the same asset, or a Detail changed, retain the complete captured work and flag a specific reconciliation task. Permit authorized office linking/correction or explicit creation of a new correctly billed ticket, preserving the original reference and audit trail. Never silently reassign the work, reopen a closed ticket or lose a charge.
- Isolate an affected operation/run: one reconciliation conflict must not stop other tickets from synchronizing or prevent new local fact capture. Never keep retrying a definite rejection as though it were a network outage. A revoked session cannot post under stale credentials; retain a secure recovery route for an authorized reviewer without leaking data into a different account.
- Display **Offline**, **Saved on device**, **Syncing**, **Synced**, and **Needs reconciliation**, with pending counts and the last successful sync. A local saved result is useful and must be unmistakably different from server/partner acceptance.
- Re-evaluate compliance against capture-time rules and the applicable policy at reconciliation; initial warn-only compliance exceptions attach to the work rather than becoming sync rejections. Preserve original event order and capture times while recording server receipt separately.
- In-app work on the acting offline device remains usable; another offline driver's device cannot receive a newly created assignment, nor can the partner see unsynced work, until a communication path exists. Push/SMS and live map refresh are queued/unavailable as appropriate. Show last-known location instead of fabricated live tracking.
- Office can prepare a review locally if supported, but actual canonical partner submission/payment status requires server acknowledgement. Retry that intent safely after reconciliation; no claim of a submitted/approved/paid ticket without the corresponding server result.

Native iOS is the primary field-offline client. The web surface should support explicitly provisioned offline capture with durable local storage and the same reconciliation rules where the browser environment supports it. ChatGPT/plugin tools require connectivity and must read actual synchronized state; they can explain pending state but cannot claim to perform a device inspection, receive unsynced data or execute an offline mutation.

## 11. Map and remote monitoring

Keep Fleet Dispatch as the main operational board with the existing dedicated map available. Show one current symbol per active Detail/power unit, not a marker for every past sample. The marker opens the driver, assets, ticket, current stop, cargo stage, last report and next required action. History is a separate selected route/playback.

Recommended layers/tools: origin/destination/base symbols; planned versus recorded path; current load stage; filtered active/available/attention resources; next-stop ETA and appointment risk; source/freshness/accuracy; stop dwell; no update; route deviation; assistance requests; permitted geofence and expiry triggers.

Phone location and optional phone-reported speed need sample time, receive time, accuracy, assignment identity and source. Current code does not yet carry speed. Never keep showing stale speed as current. A background cadence of minutes can support approximate visibility but not reliable immediate safety alarms or engine telemetry. Truck hardware can later provide engine speed/odometer/ignition; retain separate provenance.

Current driving ETA is explicitly not truck-safe routing. A future truck-routing integration must use height, weight, axle/load limits, hazmat restrictions and permitted roads. Show unavailable or an explicitly labeled limited estimate until configured. No extrapolated “live truck” when the phone stops reporting. Dispatch can still record operational events manually with discrepancies.

Triggers need editable scope, duration/threshold, recipients, cooldown, acknowledgement, evidence and audit history. Start with dwell, late/no acknowledgement, stale location, projected late arrival and expiring credentials. Speeding/route safety alerts require trustworthy measured data and applicable limits. GPS triggers never finalize tickets, prove delivery, release holds or automatically discipline drivers.

## 12. Gaps worth including now

- **Carrier of record and subcontractors:** which entity operates under the authority, owns/leases each asset, insures the work and employs the driver. Contractor assets need scoped access and their own current documents.
- **Cargo detail:** actual crude grade/classification, tank capacity, product compatibility, gross/net quantities, barrels/gallons/weight, seals and manifests. Avoid silent unit conversions and distinguish operational quantity from billable quantity.
- **Facilities and queues:** appointments, hours, access constraints, queue/detention time, rejected loads and alternate destinations.
- **Safety response:** breakdown, spill, roadside inspection, crash and emergency contacts; preserve evidence and repair/release accountability.
- **Flexible commercial billing:** extend current per-job/lump-sum/hour/day support with the approved vendor-configurable pricing approach in section 15. Include quantity/distance, detention, minimums, surcharges and itemized mixed charges; retain office review and never infer approved pricing from GPS.
- **Return travel and next assignment:** distinguish delivery done, run operationally closed and Detail ready for reuse; configure whether base return is part of the run and how deadhead is billed.
- **Data minimization:** dispatch sees eligibility, drivers see their assigned work, partners see their authorized ticket evidence, and only designated reviewers see medical/testing documents. Do not send private evidence or sensitive location details in notification previews.
- **Audit and retention:** configurable per-record policies, legal holds and export packets; never purge records just because a run closes. Inspection, maintenance, duty and qualification records have different retention rules. For example periodic inspection reports are retained 14 months, applicable maintenance records have their own one-year/six-month rules, and RODS/supporting documents six months. Confirm the exact record class before automating deletion. [Periodic inspections](https://csa.fmcsa.dot.gov/SafetyPlanner/MyFiles/SubSections.aspx?ch=22&eta=97823&sec=65&sub=148), [maintenance records](https://csa.fmcsa.dot.gov/SafetyPlanner/MyFiles/SubSections.aspx?ch=22&eta=118133&sec=65&sub=147), [RODS retention](https://www.fmcsa.dot.gov/hours-service/elds/how-long-must-motor-carriers-retain-records-duty-status-rods-and-supporting).
- **Useful measures:** time to acknowledge, loaded versus empty miles where reliable, dwell/detention, closeout-to-review time, ticket-ready exceptions and true recorded resource utilization. Do not call supplied fuel/mileage measured telematics.

## 13. Options and delivery recommendation

**Recommended: extend the shared VNDRLY workflow.** Reuse canonical Inventory/people/tickets, existing evidence/notification/offline services, and current server authority. Add Details, physical locations and reviewed requirements records. Add selected routing/ELD/telematics integrations behind clear interfaces only after approval. This keeps web/iOS/Ask V/plugin coherent and minimizes duplicate operational systems.

An external fleet/TMS integration could supply mature compliance/telematics features sooner, but introduces subscription cost, field synchronization and another operational interface. Building a proprietary ELD/truck-routing/telematics platform would expand regulatory, hardware and support obligations substantially; it should not be the first release.

Suggested coherent increments, each with web/iOS/plugin parity:

1. **Operational foundation:** Inventory and Details, rig packages, reservation checks, Origins and Destinations, explicit billing versus physical locations, Detail dropdown, stage-driven run form and full offline ticket/run creation through reconciliation. Offline is part of the foundation, not a later enhancement. Keep all working pages and billing behavior.
2. **Readiness:** OK/TX/federal applicability setup, carrier/vehicle/insurance/driver records, evidence review, reminders, green/red member dots and partner-visible exception snapshots. Initial mode is warn-only. Add versioned partner enforcement controls without silently activating them.
3. **Driver execution:** equipment-bound pre/post-trip evidence, acknowledgement and notification receipts/escalation, multi-day offline recovery and complete office review packet. Reuse existing functions rather than wait to surface them until everything is rebuilt.
4. **Monitoring and specialist integrations:** physical iPhone acceptance, sourced speed, useful triggers, truck-specific route estimates and an approved ELD/telematics connection. Continue showing honest availability until each integration works.

For each increment, prove the complete scenario with synthetic records: create Detail, reserve, choose origin/destination/return and billing ticket, dispatch, acknowledge, inspect with a defect/correction, start, load/deliver, lose/recover signal, close, review, and explicitly submit. In warn-only mode prove that expired/revoked/missing compliance produces red dots and partner-visible history while commercial ticket recording/submission continues. Test future enforcement separately against an explicitly activated partner policy; no accidental strict default. Preserve explicit operational safety controls as distinct facts.

Prove airplane-mode new-ticket/run creation, adding to a cached ticket, app/phone restart, many local runs, photo upload interruption, partial reconnection, duplicate replay, cached ticket closed on another device, changed assignment, newly revoked account and conflicting reservations. One conflict must not stall unrelated work or new local observations. Prove no lost events, no duplicate canonical tickets/charges and clear local-versus-server state. Keep cross-company access and dishonest canonical billing/linking refused; route genuine performed-work discrepancies to authorized reconciliation without deleting them.

## 14. Decisions for design review

Confirmed: initial jurisdictions Oklahoma and Texas; truck/rig/driver Detail; required origin/destination; optional return base; mandatory new/shared ticket; driver closeout and office review before partner submission; shared web/iOS/plugin server semantics. Full offline ticket/run capture and later reconciliation are core requirements. Initial compliance is warn-only, with green/red truck/rig/driver dots and partner-visible exception history. Future partner enforcement is explicit, effective-dated and scoped.

Additional user-confirmed decisions: deliberate operational do-not-operate/stop-work holds remain separate from document-compliance warnings; drivers may create their own unplanned runs/new tickets within authorized company/customer scope, flagged for office review; a rig/package may contain multiple Inventory components; dispatch chooses delivery-only or delivery-plus-return per run; a Detail stays together for reuse until explicitly changed while reservations are released when operationally ready. The user delegated selection of flexible billing methods and work-type coverage to the design.

Working assumptions: cargo is per run; each run snapshots its Detail; physical route points do not grant billing access. Compliance warning acknowledgement records an exception and never claims a legal waiver or repairs a revoked credential. GPS/connectivity failures never erase or block truthful local operational reporting. Remote delivery and canonical partner submission wait for actual connectivity and acknowledgement.

The operating decisions above are confirmed. This assembled document is the proposed written scope, including the delegated billing/work-type choices in sections 15–16; the next stage is written design review and a sequenced implementation plan that reuses the existing services. Before production enforcement of a rule pack, a qualified carrier compliance reviewer and insurance professional should validate the company's actual authority, cargo, policy and documented exceptions. This is a targeted activation requirement, not a proposal to make every ordinary run wait for legal review.

## 15. Selected commercial billing design

The user delegated this decision. Choose **vendor-configurable rate cards with itemized run charges**, reusing the vendor's authoritative service catalog and existing partner/site/AFE assignment and approval mechanisms. VNDRLY supplies editable setup templates, not invented market prices. A vendor offers only services it actually provides, subject to the current partner-owned service/approval workflow; no template silently enables work or creates an approved customer relationship. Current legacy catalog publish endpoints return `410 vendor_catalog.partner_owned`; do not restore that retired publishing flow. Preserve existing tickets/rates and the shared-ticket workflow.

### Billing bases and sensible defaults

Support per run/trip, per delivered load/hauling cycle, hour, day, mile, barrel, U.S. gallon, short ton and agreed flat amount. Use explicit labels: a run with three hauling cycles is not automatically one billable load. Existing `per_job` can remain the compatible representation for an agreed per-run charge; do not rename stored historical units just to change UI wording.

Start simple in the UI: **Service -> billing basis -> agreed rate -> included allowances**. Offer advanced options only where needed. A service can have one primary basis plus explicit additional charges. The vendor can select a different basis from the template to reflect its actual customer agreement.

| Work family | Suggested initial billing basis | Available alternatives |
| --- | --- | --- |
| Crude/condensate liquid hauling | Delivered barrels, when this is the agreed commercial unit | Per load/run, hourly, flat |
| Fresh/produced water, brine and flowback transport | Delivered barrels or gallons, explicitly selected | Per load/run, hourly, flat |
| Sand, aggregate and other bulk solids | Delivered short tons when supported by weight evidence | Per load/run, hourly, flat |
| Equipment/heavy transport | Agreed per-run or flat movement price | Hourly, mileage, daily |
| Hotshot/parts/material delivery | Per run | Mileage, hourly, flat |
| Vacuum/pumping and service/support work | Hourly | Daily, per run, separately itemized hauled quantity |
| Recovery/towing and specialty movements | Agreed per run or hourly | Mileage, flat, authorized additional equipment |

These are product starting points, not claims of prevailing prices or legally mandatory billing methods. Rates and customer agreements decide the actual basis.

### Rate authority and historical accuracy

Resolve an explicit customer/site agreement or approved quote when one exists, otherwise use the authorized vendor catalog/assignment rate. Never apply an unapproved override automatically. Save the service/catalog version, customer agreement reference, currency, unit, rate, allowances, rounding, effective dates and approver on the billing snapshot. Catalog edits apply to future work, not accepted historical charges.

Implementation audit: partner service-approval rows already snapshot approved pricing, while current Fleet billing reads live vendor prices and later shared runs inherit the ticket's single rate. The new path must resolve the approved authority and retain each run's own immutable service/rate snapshot. This is a concrete change, not an assumption that the existing billing already supports mixed rate cards.

If a price or authoritative service reference is unavailable offline, retain the ticket/run and measured work as **Unpriced — office review**. It is not zero-priced, and absence of a rate must not stop field capture. Office resolves pricing and financial discrepancies before actual partner financial submission. Drivers can enter operational quantities without acquiring finance permission or changing agreed prices.

### Additional charges

Support optional detention/waiting, mobilization, authorized deadhead/return mileage, additional equipment, after-hours service, tolls/permits, disposal fees, fuel surcharge and documented reimbursable expenses. Each needs an explicit basis, scope, approval requirement and evidence. Percent charges name the exact eligible subtotal; a fuel surcharge is not automatically a percentage of taxes or unrelated expenses. No automatic external fuel index or paid integration is selected by this scope.

Minimums should be a transparent top-up to the agreed minimum where applicable, not an additional full minimum on top of the same base charge. Record whether a minimum applies per run, load, day or whole shared ticket. Detention includes an explicit free allowance, interval/rounding and eligible wait periods. Do not charge the same interval as both hourly service and detention unless the agreement expressly permits both. Empty return, cancelled work, partial/rejected loads and cleaning have explicit agreed treatment rather than guessed charges.

Payroll/driver compensation, vendor internal cost and partner billable charges remain separate. HOS duty time, elapsed GPS time and appointment dwell are not automatically billable labor.

### Quantities and precision

Record planned, picked-up, delivered/accepted and billable quantities separately, with unit and source (meter, scale, manifest, recipient confirmation or reviewed manual entry). For liquid work record the agreed gross/net or adjusted basis; do not silently perform temperature, density or mass-to-volume conversions. Conversions must be explicit and retain the source quantity/factor. A U.S. petroleum barrel-to-U.S.-gallon conversion is a named unit conversion, not a substitute for product measurement or settlement terms.

Use exact decimal arithmetic with configurable quantity/rate precision and a defined currency rounding point. The current vendor/ticket line schemas use two decimal places for unit price and ticket quantity; sub-cent rates and detailed volume quantities therefore need an explicit compatible precision extension across catalog, ticket calculation, invoices, web, native and plugin. Preserve old values and prove totals match; do not squeeze new quantities into a lossy legacy representation or hide the calculation in an unexplained lump sum.

Mileage must identify agreed loaded/empty/total miles and the reviewed source. An estimate may help planning but never silently becomes the invoice quantity. Time, GPS, photos and manifests provide evidence for office review, not automatic financial approval.

### Batch tickets and submission

Each reviewed run contributes itemized, traceable charges to its mandatory ticket exactly once. New shared tickets may accommodate multiple service/charge items only when their explicit agreement, billing site, partner, AFE, work date and currency are compatible. Preserve each run's rate snapshot; do not overwrite a ticket-level rate to price a later run differently. Existing legacy one-service tickets keep their original semantics.

The partner sees run/cycle counts, source quantities, rates where authorized, additional charges, minimum top-ups, adjustments and compliance exceptions, with a reconciled ticket total. Office review and finalization stay explicit. Replaying an offline event or resubmitting a returned review must not create a second charge. Corrections to reviewed charges use auditable revisions/adjustments and the existing approval workflow.

Keep the current explicit new-ticket/add-to-ticket choice. The app may suggest a matching open ticket and explain the match, but should not silently merge all same-site work or invoice unrelated AFEs together.

### Tax treatment

Keep tax treatment per service/charge under the existing accounting rules and reviewed customer exemptions. Do not label every hauling/service/disposal charge taxable or exempt by default. Oklahoma taxes specified services and Texas defines taxable service categories; actual transaction and service facts matter. Preserve configuration/approval rather than invent a universal transport tax rule. [Oklahoma Tax Commission](https://oklahoma.gov/tax/businesses/sales-use-tax.html), [Texas Comptroller](https://comptroller.texas.gov/taxes/publications/96-259.php).

## 16. Selected work-type coverage and rollout boundary

The user approved all suggested work families and delegated sensible extensions. Offer the following **vendor-enabled service templates**, mapped to actual vendor catalog entries, not a second competing work-type list:

- Crude oil and condensate hauling.
- Fresh water, produced water, brine and flowback transport.
- Vacuum truck, pump-transfer, fluid recovery and related service work.
- Equipment transport, lowboy/flatbed, heavy haul and oversize/overweight movement.
- Hotshot, parts, pipe, material and general cargo delivery.
- Bulk sand, aggregate and other compatible dry material transport.
- Service/support vehicles, mobile maintenance, field support and resupply.
- Authorized waste/disposal hauling, including facility acceptance and disposal evidence.
- Towing/recovery and other specialized transport offered by the vendor.
- Vendor-defined additional services using the same configurable workflow.

A work type defines the **operation**; the commodity/material defines **what is carried**. Keep equipment capabilities, route/facility restrictions, hazardous classification, evidence requirements and billing basis as separate configurable dimensions. This avoids creating a different hard-coded workflow for every combination of trailer, fluid and rate. Commodity families are not a legal classification; use the actual shipper-approved classification and applicable documents.

Templates supply proposed inspection/manifest fields, capacity/unit options, equipment capabilities, additional review questions and billing options. The vendor reviews/enables them; partner/site agreement and current authority still apply. Required operating/commodity-specific permits and tank/equipment qualifications attach to the applicable operation. Red document-compliance stays warn-only initially, and explicit operational do-not-operate holds remain distinct.

Repeat hauling supports multiple ordered pickup/delivery cycles, separate manifests/quantities, partial or rejected deliveries, approved alternate facilities, return legs and empty/loaded state. Transporting a durable Inventory asset references that asset as cargo without confusing it with the hauling Detail or transferring custody implicitly.

Keep the first product focused on operating the vendor's own or explicitly authorized subcontracted resources. Freight brokerage/marketplace matching, automatic carrier settlement, autonomous tax filing, proprietary ELD manufacture and unrestricted passenger/household-goods services are not silently included merely because the template system is extensible.

### Added acceptance scenarios

Verify driver-created offline work stays scoped and flagged for office review; a real operational do-not-operate hold remains enforced while document-expiration red flags do not block warn-only activity; multi-component rigs cannot be double-reserved; delivery-only versus return-required closure behaves as selected; and operational reservation release does not dismantle the reusable Detail.

Verify per-run versus per-cycle quantities, precise sub-cent/volume calculations, shared-ticket mixed charge items, one minimum per configured scope, detention free-time/overlap rules, surcharge bases, unpriced offline reconciliation, partial delivery/rejected load adjustments and immutable historical rates. Confirm exact totals and canonical charge references across web, iOS, plugin and partner review. Use synthetic demonstration prices explicitly labeled as such; never fill real vendor prices from an invented market rate.
