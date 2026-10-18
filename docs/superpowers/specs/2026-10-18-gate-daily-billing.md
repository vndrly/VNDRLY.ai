# Gate post daily billing - approved direction

Approved by the user in chat on 2026-10-18. This extends the existing Gate/ticket/invoice workflow; no new provider, dependency or competing accounting ledger is authorized or needed.

## Contract and user outcome

A vendor bills its partner a daily rate to staff a named post at an authorized site. A day is a calendar day in America/Chicago, including 23/25-hour daylight-saving days. A partly staffed day earns the full daily rate unless that post agreement explicitly specifies another calculation. Employee hourly timecards are independent from post-day charges. Gate Assume starts the common Work Hub clock; an actual acknowledged notes Handoff ends the outgoing clock and starts the incoming clock. Billing never ends a shift or interrupts coverage.

The office has one Invoice Now path. Preview partner/site/post/AFE, agreement/rate, first unbilled day, last completed local day, billable days, coverage gaps and exact total. Continue billing on a new ticket is checked by default; closure includes only completed days and continuation begins at local midnight of the current day, retaining today's existing work in the new period. Never rewrite originals or overlap billed post-days. Empty periods do not create empty invoices. Contract exceptions are explicit saved agreement terms, never model guesses.

Office finalization/submission and partner approval remain the existing canonical workflow. The current invoice generator accepts only approved tickets. Invoice Now must truthfully disclose whether it submits billing for approval or creates an invoice from already approved work; it never silently approves a partner's bill. Reuse the existing invoice, tax, PDF, payable/receivable and delivery surfaces. An unavailable delivery provider is not a sent invoice.

## Assistant and automation

Ask V/ChatGPT can resolve an authorized site and post, report completed unbilled days and execute a conditional instruction such as: if at least 30 completed unbilled days, bill through yesterday and continue on a new ticket. Use the last billed-through day, not invoice creation time. Only genuinely missing/ambiguous site/post/agreement needs a question. Use current office authority, exact preview/fingerprint, durable idempotency and canonical result readback. No new OAuth grants or account change without consent.

Optional every-X-days billing is an explicit saved office direction per post/agreement, with effective date, interval, continue preference, actor and disable control. Do not enable a schedule merely because the feature exists. On retry/outage, account for unbilled completed days without duplicate post-day charges. Missing rate/coverage or changed authority creates a visible office exception, not guessed billing or lost work. Company isolation applies to scheduler and manual/assistant actions alike.

## Implementation batches and verification

1. Inspect/reuse canonical Gate station/coverage, vendor catalog/partner-approved daily terms, tickets and invoice generator. Define a shared local-calendar period/quantity calculation and immutable per-post billing receipts; guard concurrent/manual/scheduled/assistant closure with the same transaction/idempotency boundary. Additive guarded schema only if existing canonical extension fields cannot represent this safely.
2. Complete office preview -> finalize completed period -> continuation -> partner review -> canonical invoice/readback. Test midnight, both DST transitions, partial-day full-rate default/contract override, coverage gaps, rate changes, AFE changes, duplicate/retry/concurrent closure, today's originals retained and independent shift continuity in a new retained loopback database.
3. Add matching branded web/native Invoice Now preview and continuation checkbox; same shared API and authority for Ask V and existing installed ChatGPT plugin. Keep generic daily staffing billing distinct from Fleet run billing. Test actual outgoing commands/results once per completed workflow batch.
4. Add opt-in schedule configuration/worker using the same canonical closure, with due-date/catch-up/idempotency/tenant tests. Do not send unrequested external messages or activate user schedules by default.
5. Review the completed delta once, repair demonstrated failures, run required relevant checks in batches, then publish under standing full-ship authorization. Preserve existing invoice evidence and private documents; never reset data or rotate credentials. Do not claim billing live before deployment/readback.

## Status

Direction and partial-day default approved. This document is scope/evidence, not a claim of implemented or published Gate daily invoicing. Fleet iPhone private acceptance remains an independent outstanding physical-device boundary; do not delay its ready sign-in handoff for this follow-up.
