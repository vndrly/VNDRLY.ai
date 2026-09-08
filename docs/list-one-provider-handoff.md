# Payroll provider handoff

QuickBooks and OpenAccountant live transfers are deliberately disabled pending
the account/API details the owner will obtain. Existing credentials must not be
rotated or pasted into source files, screenshots, or public task messages.

## QuickBooks

Provide the developer application client ID and secret through the existing
private secrets configuration, sandbox company/realm, approved callback URL,
and the account's intended operation: time entries versus payroll execution.
Confirm supported employee and compensation APIs for that subscription before
mapping wages or submitting anything. Billing rates are not employee wages.

## OpenAccountant

Provide the exact vendor/product URL, official API documentation, sandbox access,
authentication method, company ID, and documented payroll/time import format.
The existing connector defaults are not evidence that a payroll endpoint exists.

## Acceptance before enabling transfers

- Bind every employee mapping to the connected company and provider.
- Persist approved runs and effective-dated wages/policies before repeatable exports.
- Use durable transfer identities and reconcile uncertain responses by read-back.
- Verify duplicate prevention, corrections, rejected rows and rounding in sandbox.
- Keep 1099/FIRE and unrelated unfinished accounting hidden until separately ready.

The current Payroll page is a reviewed gross-pay estimate with a generic CSV,
not tax withholding, net payroll, payment processing, or a guaranteed provider
import. It explicitly reports this boundary and blocks inconsistent source hours.
