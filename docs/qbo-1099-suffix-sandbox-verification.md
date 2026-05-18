# QuickBooks Online — `[1099: <label>]` suffix sandbox verification

## Why this exists

`buildQboInvoiceBody` in
`artifacts/api-server/src/lib/accounting/qbo.ts` tags each
`SalesItemLine.Description` with a `[1099: <label>]` suffix so vendors
who connect via OAuth get the same year-end auditability as the
file-based IIF / QBO CSV exporters. There is a unit test
(`qbo.test.ts → "descriptionWith1099Tag"`) that asserts the suffix is
present in the request body — but it mocks `fetch`. It cannot prove
that QuickBooks Online actually preserves the suffix on the imported
invoice or that the bracketed tag shows up where accountants look for
it (line memo on the customer-facing invoice, and the 1099 Detail
report).

If a future Intuit API change starts truncating or stripping
`Description`, our exporters would silently lose the 1099 box on the
OAuth path and we would not notice until tax season. This runbook is
the manual / scripted check that catches that.

## What it covers

The script
`artifacts/api-server/scripts/verify-qbo-1099-suffix-e2e.ts`:

1. Builds a multi-line invoice with one `misc_attorney` line and one
   `misc_rents` line.
2. Calls `pushBundleToQbo(..., { environment: "sandbox" })` against an
   Intuit sandbox company.
3. Reads the just-created invoice back via the QBO REST API
   (`SELECT Id, DocNumber, Line FROM Invoice WHERE DocNumber = '...'`).
4. Asserts each `SalesItemLine.Description` still contains the
   expected `[1099: <label>]` suffix produced by
   `incomeCategoryLabel(...)`. The check is strict: the read-back must
   contain exactly the expected number of `SalesItemLineDetail` lines,
   each expected description must match exactly one read-back line, and
   any unrecognized, dropped, or renamed line counts as a failure.
5. Exits non-zero on any push warning, line-count mismatch, missing /
   renamed line, unrecognized read-back description, or stripped
   suffix.

The 1099 Detail report check is **manual** because Intuit does not
expose the report rendering through the API. The script prints a
reminder at the end pointing at the report.

## One-time prerequisites

1. An Intuit sandbox company. Every developer account at
   `https://developer.intuit.com` ships with a default sandbox
   ("Sandbox Company_US_1"). Create or open one from
   **Dashboard → API Docs & Tools → Sandboxes**.
2. The Intuit app you use for VNDRLY OAuth (the same `INTUIT_CLIENT_ID`
   used in production) must have the sandbox redirect URI registered.

## Obtain a sandbox access token

Intuit's OAuth Playground is the fastest path; you do **not** need a
local OAuth callback for this check.

1. Open <https://developer.intuit.com/app/developer/playground>.
2. Pick the app whose client id you use.
3. Select scope **`com.intuit.quickbooks.accounting`**.
4. Choose environment **Sandbox** and click **Get authorization code**.
5. Sign in to the Intuit account that owns the sandbox company and
   approve.
6. The Playground returns a one-hour `Access token` and a `Realm Id`.
   Copy both. (Refresh tokens are not needed — the script runs in
   well under an hour.)

## Run the script

```bash
QBO_SANDBOX_ACCESS_TOKEN=<paste from playground> \
QBO_SANDBOX_REALM_ID=<paste from playground> \
tsx artifacts/api-server/scripts/verify-qbo-1099-suffix-e2e.ts
```

Optional overrides:

- `QBO_SANDBOX_PARTNER_NAME` — Customer DisplayName to push under
  (default `VNDRLY E2E Partner`). The script reuses the customer if
  it already exists.
- `QBO_SANDBOX_INVOICE_PREFIX` — DocNumber prefix (default
  `VNDRLY-E2E-`). A timestamp is always appended so repeated runs do
  not collide.

Expected output on success ends with:

```
  ✓ Legal review of MSA: suffix preserved ([1099: Attorney fees – 1099-MISC Box 10])
  ✓ Yard rental — March: suffix preserved ([1099: Rent – 1099-MISC Box 1])

All [1099: ...] suffixes survived the sandbox round-trip for VNDRLY-E2E-<ts>.
Manual step: open QBO sandbox → Reports → 1099 Detail ...
```

The script exits `0` on success, `1` on any warning / missing suffix,
and `2` if the env vars are missing.

## Manual step — 1099 Detail report

The QBO API does not expose the rendered 1099 Detail report. After the
script passes:

1. Sign in to the sandbox company at
   <https://app.sandbox.qbo.intuit.com/>.
2. Open **Reports → Standard → 1099 Contractor Balance Detail** (or
   **1099 Transaction Detail Report** depending on the sandbox's
   plan).
3. Run the report for the current year.
4. Find the invoice the script pushed (DocNumber starts with
   `VNDRLY-E2E-`).
5. Confirm the `[1099: Attorney fees – 1099-MISC Box 10]` and
   `[1099: Rent – 1099-MISC Box 1]` suffixes appear in the line memo
   column.

If the suffixes do **not** appear in the 1099 Detail report — even
though the API read-back saw them — that means QBO truncates the
`Description` for the report, and we should follow up with a task to
move the tag onto a custom field
(`CustomField` on the invoice line) instead of the description.

## When to run

- After any change to `descriptionWith1099Tag`, `buildQboInvoiceBody`,
  or the QBO Item / Account ensure helpers in
  `src/lib/accounting/qbo.ts`.
- Before bumping the QBO `minorversion` query parameter.
- Once per quarter as a regression check that Intuit has not changed
  the underlying behavior.
