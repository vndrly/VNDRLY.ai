# Payroll draft boundary

The Payroll page produces a transient, reviewed USD gross-pay estimate and CSV.
Wages are entered explicitly; billing rates are never inferred as wages. Only
hourly workers under the explicitly confirmed common overtime policy are
supported. Taxes, exemptions, deductions, net pay and payments are not calculated.

Periods use local dates with an exclusive end, an explicit IANA timezone and
workweek start. Pre-period hours from the containing workweek contribute to
overtime. Daily overtime is optional; weekly thresholds count regular hours so
daily overtime is not counted twice. Session slices use actual elapsed time,
including daylight saving changes. Gross amounts round to cents per local-day
session slice. Open, overlapping, duplicate, reversed and missing-rate source
records block export. Historical inactive employees remain available for review.

Every CSV request reloads source sessions and recomputes the preview fingerprint.
Changed inputs or source records require a new review. Reviews and wages are not
persisted. Repeated CSV downloads are allowed and DO NOT prevent duplicate manual
imports. CSV is a generic draft, not a guaranteed provider import format.

Before durable payroll use, implement immutable approved runs, effective-dated
wage/policy records, approval audit with actor/time, source coverage constraints
across overlapping periods, correction/reversal workflow, and transfer ledger.
Provider mappings must bind employees to the actual connected company/realm.
Transfer requests need durable idempotency identities, uncertain-outcome recovery,
remote read-back reconciliation, and duplicate prevention across runs.

QuickBooks supports time activities; transferring time is not running payroll.
The adapter remains unavailable until employee/pay-type mapping, current account
capabilities and sandbox reconciliation are verified:
https://developer.intuit.com/app/developer/qbo/docs/workflows/track-time/get-started
https://github.com/IntuitDeveloper/SampleApp-EmployeeCompensation-DotNet

The repository's OpenAccountant .com API/OAuth defaults have no verified provider
contract. Payroll transfer remains unavailable until the actual provider and its
supported operations/import format are verified. Do not infer support from the
unrelated openaccountant.ai local bookkeeping CLI or openaccountants.com tax data.
