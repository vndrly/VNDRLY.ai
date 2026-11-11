# Ask V comprehensive functional and performance review

Review date: November 11, 2026. Source baseline: `b2a18f0e2760ca43a615c3f3c98cb3fac6593a7e`.

## Decision

Ask V has useful, working execution paths, but the current evidence does not justify treating every advertised capability as mission-critical ready. The next investment should be execution reliability, capability reachability, consistent web/iOS behavior and outcome-based acceptance. Retain the requested GPT-6.1 Sol reasoning engine while repairing the surrounding system. Fine-tuning cannot make an unavailable tool callable, retain a missing cursor, or repair an invalid confirmation binding.

This review inventories every registered tool and examines the major execution boundaries. It does **not** certify that every tool has been executed against every role, organization, device and failure condition. That certification requires the acceptance matrix below. Static exposure, a named test reference, model tool selection, successful execution and saved readback are different evidence levels.

No application source, credentials, customer assignments, notification policies or production configuration were changed during this review. The report and inventory are new review artifacts. In-memory probes and an authenticated read of aggregate production metrics were performed. The preceding completed release remains a separate event.

## Evidence gathered

The companion `askv-tool-inventory-2026-11-11.csv` contains all 365 tools, their roles, mutation classification, confirmation requirement, execution surface, company-admin restriction, global text-list membership, enumerated focused-page/workflow availability, opaque object schema fields and literal test references.

| Measurement | Observed result | Interpretation |
|---|---:|---|
| Registered tools | 365 | Inventory denominator, not number of accepted workflows |
| Mutating / read-only tools | 159 / 206 | Metadata classification |
| Duplicate registered names | 0 | Registry names are unique |
| Broad text tool list | 236 tools; 164,303 serialized characters | Used outside the route's focused-page condition, including ordinary Gate chat |
| Vendor-admin Gate focused pack | 41 tools; 32,957 serialized characters | Different from what ordinary Gate text chat receives |
| Vendor-admin dedicated Ask V pack | 184 tools; 138,016 serialized characters | Still a large context burden |
| Vendor-admin Tasks / Calendar / Files packs | 34 / 32 / 28 tools | Useful starting point for focused selection |
| Tools with an object lacking declared fields | 45 | Some payloads require the model to infer shape from descriptions or errors |
| Tools absent from enumerated focused packs | 33 | Some remain available through the broad legacy list |
| Tools absent from both broad list and enumerated focused packs | 27 | Reachability findings; plugin/direct API availability does not prove in-app availability |
| Tools with no literal name in scanned tracked test sources | 94 | A coverage-review queue, **not** proof of zero tests; parameterized and indirect coverage can exist |
| Seven-day retained first-text metric | average 8,007 ms; p95 18,778 ms; 80 samples | Mixed historical models and synthetic activity; not a latest-release benchmark |
| Recorded helpful/unhelpful feedback in that window | 0 / 0 | No user-rating evidence of task success |

Schema sizes are JavaScript string lengths, not measured tokenizer counts. Reachability enumeration covers 396 page/role combinations (including native-prefixed paths), 44 workflow/role combinations, four signed-in roles and company-admin membership. The native dedicated command pack contains the same 184 tools as the equivalent vendor-admin web command pack; its spoken execution path still differs. Native route normalization and alternate entry points must also be exercised end to end. This enumeration does not establish granular grants for actual company members.

Local reproduction evidence: `.local/askv-exhaustive-inventory.json`, `.local/askv-review-probes.json`, `.local/askv-review-metrics.json`. Those files contain no credentials. Test-count evidence from the preceding release is reusable for unchanged source, but is not a substitute for the new failure cases.

## Confirmed defects and material gaps

### P1-01: Confirmation can disappear when location context changes

Evidence: `routes/assistant.ts:1483` uses `JSON.stringify(pageContext)` as the approval context. `askv-pending-confirmation.ts:134` clears the pending action when that value changes. The web location helper attaches location for words such as ticket, site and map; a plain "Confirm" does not request location.

Reproduced without a database write: prepare an in-memory action with `/work-hub/calendar` plus location, then synchronize the same page with "Confirm" and no location. The prepared action exists before and is gone afterward. A captured timestamp or updated accuracy can also change the serialized context.

Repair: bind approval to stable actor, organization, conversation, surface/entity and exact action fingerprint. Treat changing observational GPS separately. For a location-sensitive mutation, revalidate geofence/current position at execution and request a new preview only when the action's material meaning changes. Do not simply remove context checks.

Acceptance: location absent/present, changed capture timestamp, harmless accuracy drift, changed site, switched organization, edited payload, expiry and cancellation. Only the unchanged authorized action may execute, once.

### P1-02: The text tool selector does not actually install the selected pack

Evidence: `routes/assistant.ts:962` returns workflow and tool names from `select_tool_pack`. The text turn's `assistantTools` list is assembled before the loop and is not replaced in response to this result. In contrast, the realtime route returns full selected tool definitions and context at `assistantRealtime.ts:875`.

Repair: implement a single server-owned, permission-filtered selection contract and update subsequent model rounds. Include Work Hub families, which are not all represented by the current voice workflow enum. Preserve any deliberate read-only page restrictions.

Acceptance: request a supported operation from an unrelated page, select its pack, execute the real tool, verify the result, and deny the same request under an unauthorized role. No requirement to manually navigate to make the assistant capable.

### P1-03: Registered operations are unreachable through the inspected in-app tool assembly

The 27 tools absent from both exposure paths are:

`prepare_fleet_cargo_transfer`, `acknowledge_fleet_cargo_source`, `acknowledge_fleet_cargo_recipient`, `complete_fleet_cargo_transfer`, `cancel_fleet_cargo_transfer`, `prepare_fleet_equipment_replacement`, `accept_fleet_equipment_replacement`, `cancel_fleet_equipment_replacement`, `edit_fleet_draft`, `reconcile_fleet_gate_visit`, `manage_fleet_saved_view`, `report_fleet_defect`, `manage_fleet_maintenance`, `manage_fleet_settings`, `manage_fleet_yard_order`, `record_fleet_custody`, `record_fleet_driver_availability`, `manage_fleet_run`, `acknowledge_fleet_assignment`, `transition_fleet_run`, `review_fleet_closeout`, `set_fleet_preferences`, `acknowledge_ticket_assignment`, `manage_ticket_record`, `record_ticket_payment`, `reverse_ticket_payment_record`, `manage_gate_shift`.

The Gate prompt specifically instructs shift-note creation through `manage_gate_shift`. A prompt naming a registered tool cannot make it available to the model.

Repair: give each intended in-app operation an explicit discoverable entry point and role/surface contract. Reconcile registry, legacy list, focused packs, dispatcher and user-facing workflow inventory. Do not expose all financial/Fleet writes indiscriminately to solve this.

Acceptance: every registered tool is classified as reachable in-app, intentionally plugin-only, intentionally device/UI-only, or deprecated with a supported replacement. No unexplained missing tool remains.

### P1-04: Web voice and native iOS voice use different reasoning paths

Evidence: web `askv-realtime-client.ts` requests `brain=shared` when `onUserText` is supplied; web voice sends transcripts through `useAssistant`. Native `askv-realtime-client.ts:271` requests realtime calling without that flag and its voice session dispatches realtime tool calls. The realtime default is `gpt-realtime-2.1`; the text adapter defaults to `gpt-6.1-sol`.

Repair: decide and enforce one operational reasoning contract across typed web, spoken web, typed native and spoken native. Native speech transport can remain native; it should not silently imply that spoken requests use the same reasoning engine when they do not. This is a coordinated integration change requiring design review, not a one-line model rename.

Acceptance: identical commands and saved context produce equivalent authorized results on all four paths. Test physical microphone, interruptions, app backgrounding, Bluetooth route changes and connection loss separately from synthetic transcripts.

### P1-05: Continuation depends on prose because prior tool results are not replayed

Evidence: `routes/assistant.ts:1396` retains the latest 24 messages, then maps only plain text into the next request. Tool traces are saved separately but not replayed into this history. The pending-action fix restores one exact prepared mutation; it does not restore general list/query state.

Repair: persist bounded structured continuation state: tool, query/filter/sort, returned cursor, result references, selected entity and freshness. Authorize it again on resume. Summarize older work without turning retrieved text into instructions.

Acceptance: "next page", "previous page", "the second one", "same filters", "continue after refresh", and switching lists without borrowing the wrong cursor. Verify no duplicates, omissions or cross-company results.

### P1-06: Invalid mutation results can be classified as success

Evidence: `tool-result.ts` defaults to success unless JSON contains `error`, `ok:false`, or a recognized confirmation flag. Pure probes classified non-JSON failure text, JSON null and `{status:"failed"}` as success. `askv-idempotency.ts` uses this classifier in its persisted result audit. This reproduces a classification defect; it does not prove an actual customer mutation falsely succeeded.

Repair: explicit per-operation result contracts with success, prepared, rejected, unavailable and outcome-unknown states. Require canonical IDs/versions/readback for saved-action claims. Preserve legitimate empty read arrays and existing documented mutation responses.

Acceptance: malformed/empty results, 204 responses, validation errors, permission errors, timeout after commit, duplicate replay, partial success and unreadable receipts. Unknown must remain unknown until reconciled.

### P1-07: The final tool round can execute without a concluding model/readback turn

Evidence: the six-round loop emits a limit error when its last model response requests tools, then still proceeds to execute those tools. It subsequently emits done with accumulated text. This is especially confusing if the last action changes data.

Repair: budget execution and reporting separately. Reserve space for final verification, or save an explicit continuation checkpoint with truthful partial state. Do not ask users to invent a more specific question after work may already have happened.

Acceptance: workflows requiring five, six and seven model rounds; a final mutation; a final confirmation preview; cancellation; resumable readback. Never repeat completed writes or mislabel a partial result.

## P2 refinements with concrete implementation targets

| ID | Finding and source | Recommended change and acceptance |
|---|---|---|
| P2-01 | Broad Gate text list is 236 tools versus 41 in focused Gate evaluations (`assistant.ts`, `workflow-selection.eval.ts`). | Test the exact production assembler. Use discoverable focused packs. Measure request size, selection accuracy and latency before/after; retain all authorized workflows. |
| P2-02 | 45 tool schemas contain objects without declared fields; generic capability schemas also accept additional properties (`work-hub-tools.ts`, `capabilities/types.ts`). | Derive action-specific schemas from canonical validators; describe required IDs, dates, versions and preparation semantics. Verify every action variant, missing fields and invalid extra fields. Strict schema conversion should be gradual and compatibility-tested. |
| P2-03 | The Responses adapter waits for a full response JSON before text emission; usage/audit work is also awaited before visible text (`cooperative-v-providers.ts`, `assistant.ts:1588`). | Give immediate truthful stage feedback; measure provider, tool, audit and playback timing separately. Consider streaming only with explicit fallback rules that prevent duplicate prose and duplicate writes. |
| P2-04 | Provider timeout is 90 seconds per round, six rounds are allowed, and client abort is not forwarded to the adapter even though it accepts a signal. | Propagate abort through the request lifecycle, set an overall turn budget, and reconcile in-flight writes. Stopping generation must not be presented as rolling back a committed action. Test disconnect at every boundary. |
| P2-05 | Pending previews use a process-local Map with five-minute expiry (`askv-pending-confirmation.ts`). | Persist or explicitly invalidate/reprepare previews across restart and replica changes. Never broaden approval lifetime silently. Test deploy during confirmation and retries on different workers. |
| P2-06 | Whole-reply confirmation matching accepts "Confirm" and "yes please", but rejects "Yes, confirm that exact task" (`action-classifier.ts`, reproduced). | Prefer visible Confirm/Cancel controls bound to the server preview; expand only carefully reviewed language variants. Corrections such as "yes, but use gate 2" must trigger a new preview. |
| P2-07 | Gate resolver supports English number words one through five and English filler words. In probes, "six" and a full Spanish command failed while numeric 6 and Sand Roman two worked (`gate-navigation.ts`). | Scoped alias/vocabulary support, Spanish number/filler handling and confidence margins. Preserve exact numbers and identifiers; ambiguity returns choices. Never fuzzily authorize a write. |
| P2-08 | Gate lookup fetches stations for every authorized site in batches of six (`gate-navigation.ts`). | Use a permission-scoped joined lookup or bounded cache with invalidation. Benchmark realistic site counts. Recheck current access before use; no company-crossing global cache. |
| P2-09 | Voice capability HTTP failure is cached as a resolved promise; only thrown network failure clears it (`use-askv-voice-session.tsx:60`). | Expire failures and permit a bounded retry after reconnect/sign-in/server recovery. Test 401, 503, network rejection, capability change and recovery without page reload. |
| P2-10 | Web speech is generated after the whole answer, and stop invalidates playback but does not cancel the outstanding TTS fetch (`askv-speech.ts`). | Separate short spoken acknowledgment from detailed visual result; abort obsolete requests; evaluate sentence streaming without speaking an action as complete prematurely. Test barge-in and late audio. |
| P2-11 | Tone/refusal and language evaluations still call Claude (`__evals__/tone.eval.ts`, `language.eval.ts`). Current OpenAI selection checks are mostly single-turn. | Migrate to the actual production adapter and add multi-turn execution/readback, correction, denial, pagination, failure and Spanish cases. Report skips separately from passes. |
| P2-12 | Knowledge selection is keyword substring overlap; short words are discarded and zero-score documents can still be selected (`knowledge/index.ts`). | Curated workflow vocabulary, English/Spanish synonyms, score thresholds and versioned procedural docs. Evaluate retrieval quality before adding an external search dependency. Saved business facts must come from tools. |
| P2-13 | GPT-6.1 rounds return null cost estimates in the current estimator, which knows GPT-4.1 and Claude only (`cooperative-v-usage.ts`). | Add verified current pricing metadata or clearly label unpriced usage. Preserve actual token counts. Never treat missing cost as zero or lower model quality merely to conceal cost. |
| P2-14 | First-text telemetry begins after part of context/DB preparation, has no per-workflow breakdown, and contains no user ratings in the inspected window. | Capture request arrival, first progress, first text/audio, tool duration, confirmed success, verification, repair rate and abandonment. Separate synthetic traffic, model version, surface and role; define latency targets from real field trials. |
| P2-15 | Navigation is verified on the web client, but those client results replace local display text rather than being fed back into this server model turn (`use-assistant.tsx:455`). | Persist an authenticated client receipt and reconcile server/user-visible history. Verify page + selected entity for every navigation capability, not just route dispatch. Never let a forged client receipt authorize business mutations. |
| P2-16 | Text conversations retain a bounded 24-message model window, 200-message stored history and 25 conversations (`assistant.ts`). | Make retention explicit; provide saved workflow checkpoints and user-controlled archive/export. Do not alter or delete existing history as part of tuning. Test long work sessions and reopened conversations. |

## Controls worth preserving

- Canonical domain APIs perform business authorization; model-supplied tool names and page context must not grant access.
- Durable mutation reservations, exact argument fingerprints and recorded uncertain outcomes protect against duplicate writes after timeout/restart. Improve reconciliation rather than weakening these controls.
- Confirmation is bound to actor, organization and conversation. Repair unstable observational context while retaining exact action binding.
- The gate resolver scopes candidates to current authorized records, keeps numbers exact and asks on ties. The San/Sand and ambiguous-name probes confirm these useful behaviors.
- Personal connection selection is explicit and separately scoped; private results have special persistence handling. The API integration does not inherit ChatGPT apps or personal conversations.
- Raw audio object fields are excluded from audit storage. Free-text content still requires an intentional retention/redaction policy; removing audio fields is not a general sensitive-data guarantee.
- Anonymous product Ask V exposes no operational tools. Keep public/signup behavior distinct from authenticated operational capabilities.
- MidCon's notification hold remains in force. Acceptance must not send customer notifications or alter real staffing/assignments.

The two metadata exceptions with `mutating:true` and confirmation not required are `start_onboarding` and `set_ticket_lifecycle`. These require explicit intent/authorization contract review, not an automatic conclusion that permission is bypassed. Canonical endpoint protections and product-approved direct commands must be examined together.

## Workflow-by-workflow acceptance obligation

For each tool, record an evidence level: declared; exposed; valid arguments; executed in isolated fixture; canonical readback verified; browser/device outcome verified; failure/recovery verified. The CSV currently establishes metadata/exposure and test-reference evidence, not the later levels.

| Area | Required user-level scenarios | Proof required |
|---|---|---|
| Gate navigation and discovery | partial/misheard names, multiple gates, missing access, changed selection | Correct rendered page/site/station; no invented absence |
| Visitor/vehicle entry and exit | returning plate, changed driver, company match, correction, duplicate submission | Saved visit ID/status, correct plate/state/company, one mutation |
| Watch/shift operations | notes, schedule, travel, coverage, handoff, stale watch | Saved correct watch/shift; signatures remain user actions |
| Tickets and crew | create/edit/accept, assignment, GPS lifecycle, comments, completion | Coherent office/lifecycle state; correct crew; canonical versions |
| Tasks, forms and checklists | create/edit/complete/cancel, due date/timezone, recurrence, page continuation | Exact task/form IDs, status and persisted response; version conflict behavior |
| Calendar and staffing | find people, create/reschedule/cancel, opening/claims, conflicts | Correct UTC/local time, participants and saved shift/event; no phantom invitations |
| Channels, messages and calls | scoped search, send/edit, acknowledgement, call/voicemail | Saved message/call record and delivery state distinguished |
| Meetings and recordings | admission, attendee change, recording consent, replay availability | Authorized occurrence, actual state and required consent; no invented recording |
| Files, photos and notes | list/search/upload/version/share; camera permission | Actual bytes/object/version/access; device handoff truthful |
| Inventory and custody | find asset, checkout/return/transfer, replacement | Correct asset and custody chain; exact version and current authority |
| Fleet | runs, destinations, cargo, maintenance, defects, compliance, closeout | Each of the currently missing tool paths accounted for; saved operational state |
| Finance and billing | reads, rates, approvals, gate billing, payment recording/reversal | Isolated financial fixtures, exact totals/currency and authority; never live trial payments |
| Marketplace and catalog | service/pricing search, capability changes, offer/bid workflow | Vendor catalog remains authoritative; scopes and exact saved records |
| Accounts and administration | invites, profile, preferences, company switching | Correct actor/org, no password exposure, revoked grants take effect |
| Safety and incident response | report, severity, attachments, correction, escalation | Saved report and escalation state; no fabricated safety completion |
| Reports, analytics and exports | filters, time windows, all pages, export generation | Totals reconcile to source; artifact exists and is accessible |
| Next Steps and helperflows | applicable unfinished work, ordering, saved completion | No more than five; actual prerequisites and completion; training exclusions preserved |
| External connections | selected account, scope, freshness, revocation | Real authorized connection; saved sync versus live retrieval distinguished |
| Public/signup assistance | login help, onboarding guidance, private-data requests | No private tools or disclosure; bounded resource use |

Every area must include allowed and denied cases for applicable vendor, partner, employee and admin roles, at least two organizations, and relevant web/iOS text/voice surfaces. Use isolated fixtures for writes. A role that lacks access should receive a precise denial without hidden fallback to a broader account.

## Cross-cutting failure and recovery matrix

1. Model timeout, 429, 5xx, malformed tool JSON, empty response and token exhaustion.
2. Database/domain timeout before save, after save and before receipt; retry with the same operation identity.
3. Stop, cancel, interruption, app background, lost network and browser refresh at each action boundary.
4. Pending preview expiry, API restart, multiple replicas, changed page, GPS timestamp change and organization switch.
5. Two tabs or devices replying to the same pending action; concurrent edits and stale expected versions.
6. Unsupported action versus unavailable integration versus denied permission versus zero matching records.
7. Fuzzy names, homophones, accents, number words, Spanish, short replies and corrections; exact IDs and plates stay exact.
8. Pagination with filter/sort changes, empty middle/final pages, concurrent new records, refresh and long conversations.
9. Client action accepted but rendering failed; upload prepared but bytes missing; delivery queued but not delivered.
10. Tool output or retrieved document containing instructions; cross-company IDs; personal result leakage into company history.
11. Long responses, long tool results, repeated failed reads, loops, excessive discovery and cost/latency outliers.
12. Dependency unavailable during release; verify previous saved results and notification holds survive.

## Recommended implementation order

1. **Correctness first:** stable confirmation context, truthful result contracts, final-round completion and recovery. Add failing reproductions before changes.
2. **Capability completeness:** reconcile all 365 inventory entries; repair pack switching and the 27 missing in-app entries; replace vague mutation schemas. Test real route assembly, not a convenient subset.
3. **Continuity and parity:** persist query/action checkpoints, client receipts and restart-safe previews; align native voice with the chosen reasoning path.
4. **Measured performance:** reduce tool context through functioning discovery; fix capability retry; propagate cancellation; profile model/DB/tool/audio time. Benchmark GPT-6.1 settings against the same acceptance tasks before changing reasoning effort.
5. **Operational acceptance:** run the workflow matrix with synthetic data and exact readback; physical-device speech trials; clearly label each supported, blocked, UI-required or unverified workflow.
6. **Release:** use the established optimized validation and release process for implementation changes; preserve holds, credentials, permissions and approved UI branding.

No new external dependency, credential transfer, fine-tuning job or architectural rewrite is required to start steps 1 and 2. Major integration changes should be reviewed explicitly. The optional cloud evaluation credential transfer previously rejected by automatic approval review remains blocked; local evaluation can use the existing authorized credential.

## Completion standard for mission-critical acceptance

Use observed behavior as the gate: the requested authorized action reaches its correct saved state, appears correctly on the intended device, reports uncertainty accurately, survives recoverable failures and never repeats a committed mutation. Each required workflow needs its own evidence. Aggregate test totals, successful deployment, a model label and a registered tool are necessary context but cannot substitute for that evidence.
