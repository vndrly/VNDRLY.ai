# Gate cards: iOS readiness and selection continuity

This review prepares the later iOS page composition. It does not claim that React DOM cards can be pasted into React Native or that the web and native screens already have full visual/functional parity. Server authorization and saved records remain authoritative on both platforms. No new external dependency was introduced.

## Card inventory

| Card/function | Reusable function/contract | Native rendering / integration status |
| --- | --- | --- |
| Workday, Shift, On Call | Existing workday endpoints | WorkdayControls and WorkdayStatusSwitch exist. |
| Site/gate selector and GPS | gate-booth GPS evaluation; authorized sites/stations | GateSiteGateSelect exists; native scoped selection now shared by Dashboard, Map, Gate entry and History. Native location permission stays in the device adapter. |
| Assume/release watch, handoff | gate-booth ChangeOverState and change-over API | GateChangeOver, GateDutyCard, GateAssumeWatchFlyout and WatchPassControl exist. Keep explicit review and server concurrency checks. |
| Watch Radar, My Watch, On Watch, Previous/Next Watch | Change-over watches/schedule/coverage and shared watch timeline | Duty/staffing primitives exist; exact web card composition and all radar controls still need native UI mapping. |
| Shift notes, recent notes, acknowledgment | Shared ShiftNotesResponse/change-over API | Native GateChangeOver history exists. Browser IntersectionObserver must become native visible-item tracking before copying automatic viewed acknowledgments. |
| Activity totals, on-site summary, exceptions | Shared change-over snapshots/report facts | Native snapshot view exists. DOM row animations/details need native presentation; no separate counting rules. |
| Tasks and unassigned hopper | Work Hub task/hopper API, expectedVersion and operationId | Native TaskAssignment exists; dedicated hopper layout and web DashboardTasks arrangement still need native mapping. |
| Billing, profitability, recent tickets | Existing api-zod gate billing workflow and ticket APIs | GateDailyBillingPanel exists with native file/action controls. Web billing label correction must be preserved when composing recent-ticket rows. |
| Gate entry, company/driver recall, plate/vehicle recognition | Visits APIs, plate-state recognition, gate-booth speech | Native gate screen and gatekeeper adapter exist; evidence and destination fields supported. Camera remains native, original photo retained. |
| Arrivals, review, run detail, visit/run links | api-zod GateArrivalsResponse/GateArrivalDetail | Added typed native read adapter gate-arrivals-api.ts. Review/prefill card rendering remains a native UI integration task; reading a candidate never admits it. |
| On Site, departures, visitor detail, evidence | Visits API and gateCapture evidence | Native gate screen exists. Multi-image gallery/original-link presentation still needs native UI mapping. |
| Internal area traffic, destination selection | Pure gate topology/default helpers extracted to gate-booth; typed GateAreaTrafficResponse | Added native gate-traffic adapter. Gate movement card rendering still needs native mapping. Check movementGateIds, freshness and connectivity; use stable operationId on retry. Site exit uses full gatekeeper checkout with GPS evidence. |
| Gate Map, staff/equipment, history clock | Coverage-map/equipment APIs | Native Mapbox map exists. Web Mapbox DOM popups, hover, fullscreen and pin controls need native equivalents; keep tap access and device navigation/sharing. |
| Gate creation and location/profile editing | Existing gate/location endpoints | Native profile GateLocationsCard exists. Map placement gestures and creation-card composition still need mapping. |
| Gate Log, filters, pages, exports | Same gate-report query/export/recipient APIs | Native GateHistory exists. Native export uses filesystem/sharing; browser download code stays behind Platform.OS. Pagination clamped after result shrink. |
| Voice/AskV/helperflows | gate-booth speech, draft and guided-workflow modules | Native voice and AskV controls exist. Web SpeechRecognition, DOM focus/scroll and browser client intents cannot be copied literally; retain native adapters. |

## Selection behavior implemented

- Web Dashboard saves the scoped site/gate; Map reads it, focuses it and saves a new authorized selection. Returning Dashboard restores it.
- GPS supplies a first-use default; it no longer overrides a remembered gate.
- Explicit deep links take precedence. Historical inspection does not persist map selection over the live operational choice.
- Native selection uses existing AsyncStorage plus subscribed in-memory state. A user or membership has a separate key. Slow hydration cannot overwrite a newer manual selection.
- Native Dashboard, Map, Gate entry and History consume the same selection. Store IDs, not mutable names. Server-authorized site/gate lists remain the source of availability.
- Selection is per device/session account. This is not cloud synchronization of a user's selected gate across independent devices.

## Pagination checks

- Web arrivals: all loaded results remain reachable; negative limits clamp; page bounds follow result count. Server truncation remains explicitly disclosed, not presented as the full queue.
- Web Gate Log: 25-row pages preserve site/gate filters; filter changes reset page; a shrinking result set clamps to its last page.
- Native Gate Log: 50-row pages preserve scope; filter changes reset page; a shrinking result set now clamps instead of showing an empty out-of-range page.
- Gate selection/navigation and record pagination are separate state. Advancing a page does not choose another gate.

## Release limits

Code-level tests and typechecking are recorded in the task's validation logs. No deployment or physical iPhone validation was performed in this follow-up. The native card integration items above must be completed when mapping web panels to iOS pages; they are not hidden behind a claim of paste-ready JSX. Camera feeds, vehicle fingerprint matching and ticket proof-sheet exports remain the previously deferred work.

## Verified in this follow-up

Web: Dashboard/Map/Arrivals/History batch 80 passing tests; refreshed History suite 16 passing; shared traffic consumers 26 passing. Native: Dashboard/Map/History/selection batch 30 passing; gate entry/submit batch 28 passing; typed-adapter/submit batch 9 passing; final destination serialization suite 7 passing. These batches overlap and are not additive totals. Web and native TypeScript checks passed; git diff whitespace check passed. Tests cover remembered gate versus GPS, map selection/remount, membership separation, slow storage hydration, record pagination and shrink, explicit arrival review, and native request scope/operation identity.
