# List One financial feature visibility

Initial release keeps payroll in scope while tax and unfinished accounting
surfaces are hidden. Data and implementation remain intact.

Set `VITE_ENABLE_TAX_REPORTING=true` and rebuild to restore the 1099 totals
card on partner details, 1099 reports/dashboards, category audit, e-delivery,
FIRE exports, and transmitter settings. Verify all these surfaces together.

Set `VITE_ENABLE_ACCOUNTING=true` and rebuild to restore invoice accounting,
statements, bills, mapping, invoice exports, and accounting audit views.
Payroll has its own workflow and is not an invoice export under another name.

These are interface release controls, not substitutes for server authorization.
The scheduled 1099 monthly email worker is paused by default. Set the API's
`ENABLE_TAX_REPORTING=true` only when restoring the tax surfaces above and after
reviewing saved delivery schedules. Direct API operations retain their existing
authorization; these flags are not a replacement for it. No data deletion or
credential changes are involved.
