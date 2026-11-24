# UI restoration execution report — November 24, 2026

Presentation restoration is implemented locally. Rendered review covered the affected top-level screens on desktop and the 390 x 844 mobile web preview. The follow-up closed 23 of the 29 local evidence gaps. Six voice-related rows retain physical-device/live-session evidence requirements; this is not physical-iPhone acceptance or a production release.

## Source and preservation

Selected checkpoint: `6a8ab8a7e8fc1d573aa86767e8c772cf2c3dabfb` (November 23, 02:34:37 CST). It is the last saved checkpoint before the November 23 conversion instructions, not the first introduction of React Native: Work Hub was already native there. Its existing Gate WebView integration was reconciled forward with current companion pages.

Starting commit: `97b3ba9c33db2b047db66658da10c38f7104cff2`. Preservation branch: `codex/ui-preservation-20261124-101932`. Working branch: `codex/ui-restoration-20261124`. Preservation inventory is in `.local/ui-restoration-20261124/preservation-20261124-101931/`; all 20 existing stashes were left intact. No history reset, database restore, credential change or backend replacement was performed.

Per-page sources are recorded in `RESTORATION-SOURCE-MAP.md` beside the local packet. Gate, Dashboard, Map, Log and Shift Notes use current web companion pages through the reconciled baseline integration. Work Hub Home, Communications, Calendar, Tasks & Crews, File Library, Inventory and VNDRLY/U use the current corresponding web components. Library, bundle, course, assignment, training and checklist detail routes use their matching web pages. Current native AskV, its voice provider and inline result logic remain.

## Reapplied presentation

- Work Hub disclosure rows, communications groupings, shift summary wording and certificate scrolling.
- Curated mail folders, compact inbox spacing, expandable Inbox children, side-by-side phone panes, message-only scrolling and top-right selection control. Populated live mailbox verification remains open.
- Requested action minicards across calendars, files, inventory and other Work Hub forms; icon-only controls preserved. Inventory registration entry placed below its administration content, with form actions at the bottom.
- Page heading alignment, phone search sizing, hours summary spacing, channel author wrapping and horizontal native footer navigation.
- Gate dashboard heading, centered Log selector and narrow-screen filter spacing; original entry/card switching, map and handoff companion layouts retained.
- VNDRLY/U catalog containment and removal of visible Loading catalog text; working native library detail/Back navigation.
- AskV Stopped label and quick-action minicards, retaining branded avatar and composer.

All 230 source messages were reviewed with their 150 referenced screenshots. Ledger dispositions: 119 Reapply, 71 Conversation context, 26 Superseded by later instruction, 6 Needs evidence, 4 Resolved by restored component, 4 Already present. These are message dispositions, not 230 distinct fixes. The resolved-component requests concern discarded converted layout/scroller behavior; later poll instructions supersede earlier button-flow wording.

## Rendered verification

Evidence under `.local/ui-restoration-20261124/rendered/` includes desktop and phone views of Work Hub, Communications, Calendar, Tasks & Crews, Files, Inventory, library, Gate entry, Dashboard, Map, Log and Shift Notes, plus AskV and navigation. Review used existing demo accounts; no message, call, poll, assignment or shift-note submission was made.

Observed: populated GateGo channels and equipment; channel-list Hide expands the conversation; Home calendar disclosure expands; VNDRLY/U Energy Safety Core opens `/work-hub/bundle/VUC001` and Back returns to catalog; phone navigation remains horizontally accessible; Gate Map loads populated gate/staff markers; Gate Log loads existing demo traffic; Shift Notes groups existing notes. Desktop Gate Log final evidence is `rendered/gate-log-final.jpg`.

Browser viewport emulation is not a physical iPhone. Native WebView performance, swipe/voice interaction and microphone/audio behavior remain unmeasured. No sub-second claim is made. Empty mailbox/call/poll account states cannot prove populated provider workflows.

## Validation and local services

Web and mobile TypeScript checks passed. Focused tests passed for Gate handoff desk, calendars, project timeline, asset registration, connected workspace, curated mail folders, poll review/save/publish logic, Home disclosures, embedded route boundaries, AskV bridge/header/status and adaptive navigation. Home's initial test failures and the navigation wrapper assertion were corrected and their affected suites rerun successfully. Saved logs include web-home-recheck (14 passing), web-final-focused (19), mobile-focused-tests (28), mobile-navigation-test (6), and web-focused-tests (32); overlapping batches must not be summed as unique tests. The earlier web-interactions-tests log also records passing poll and connected-workspace suites alongside the subsequently corrected Home failures.

`git diff --check` passed. Full root/API database-reset suites were not run; this is not merge/release gate certification.

Established recovery command `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ensure-local-dev.ps1 -Recover -Strict` restarted canonical local web :5173, API :8080, iOS preview :8081 and proxy :8099. Expo startup required offline/debug process environment on retry; no startup script/config was changed. Final recovery log: `localhost-restart-debug.log`. Actual web and mobile pages were inspected after restart. No production publication was requested for this restoration.

## Follow-up local verification

Walked forward the remaining source requests. Reproduced expired mail cursors with isolated synthetic responses and added first-page recovery without replaying writes. Corrected phone message-row wrapping, paging controls, and call-log contrast. Moved Prepare turnover above/right of On watch. Changed poll review to the requested read-only popup while preserving draft Save and Publish behavior. Added deliberate header swipe engagement and Close disengagement that persists across navigation.

Rendered actual components with an isolated in-memory API on localhost:5182. No live provider writes, calls, messages, poll publications, assignments or shift-note submissions were made. Verified 50-message selection, folder expansion, right-pane detail, and message-only scrolling (442px while page/folder/header remained stationary); populated away replies and call log; watch placement and equal 104px handoff inputs; read-only poll review, saved inactive item and published active item. Evidence: rendered/followup-*.jpg and fixture-command-evidence.json in the local packet.

Follow-up checks: web and mobile TypeScript passed; connected workspace/handoff/away tests passed; corrected watch assertion and poll suites passed (13); mobile voice/rendering batch passed (39); voice SDK suite passed (37); updated swipe/status suites passed (14); campaign/cache/call suites passed (14). Batches overlap and are not a unique-test total. No destructive database suites were run.

All four canonical services restarted successfully using ensure-local-dev.ps1 -Strict with Expo offline/debug environment. Ports 5173, 8080, 8081 and 8099 were listening. The restarted native web preview rendered the populated Work Hub and Gate Dashboard, with Stopped and Next Steps visible. Browser navigation clicks did not activate while Chrome had a password-manager dialog open. Native browser inspection identified that overlay; Computer Use then stopped because it could not determine the current Windows browser URL confidently enough to enforce policy. Thus final click-through after overlay dismissal remains unverified; temporary navigation instrumentation was removed. No app navigation defect was established.

## Remaining evidence

U096, U103, U132, U155, U159 and U160 retain Needs evidence for physical-iPhone swipe, microphone/audio readback, persistent live conversation and authorized data-result follow-ups. Their locally testable logic passed. Live Outlook/Gmail transport and real call-provider history are not proved by synthetic fixtures. No physical-device performance or production-release claim is made.

The 230-row ledger now records 119 Reapply, 71 Conversation context, 26 Superseded, 6 Needs evidence, 4 Resolved by restored component and 4 Already present. Each follow-up row has local_verification and remaining_external_verification fields. Original work and all 20 stashes remain preserved. Local-only restoration; no push or ship performed.
