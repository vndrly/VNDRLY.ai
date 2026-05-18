# 1099-MISC Box 10 (Attorney) Header-Mask Incident — Decision Memo

**Task:** #810 — Check whether past 1099-MISC attorney payments were filed in the wrong IRS slot
**Date:** May 1, 2026
**Owner:** Replit Agent (Tax Operations)
**Decision:** No corrected ("G") FIRE return is required. No further action needed.

---

## Background

While adding the new A/B drift guard test we found that the 1099-MISC IRS A-record amount-indicator mask in `artifacts/api-server/src/lib/reports/fire.ts` was off by one for Box 10 (gross proceeds to attorney):

- **Renderer (B record):** wrote the attorney dollar amount into amount-code slot **A** (slot index 9) — correct.
- **Header mask (A record, position 29-44):** flagged amount-code slot **B** (slot index 10) — wrong, one position over.

An IRS reader trusting the A-record header would have seen amount code B populated and amount code A blank, even though the underlying B records carried the dollars in the right slot. The bug has since been fixed in `formAmountCode("MISC", …)` and is locked down by the A/B drift guard test in `fire.test.ts`.

The remaining question, per task #810, was whether any *real* FIRE files had already been generated and shipped to the IRS with the buggy mask, in which case affected payees would need a corrected ("G") return re-submitted.

## Investigation

Two prod-side data sources together cover every code path that can have produced a FIRE submission for this app:

1. `report_export_audit_log` — every `/reports/.../1099-fire` download writes one row here via `sendBufferAndAudit` (`format = '1099_fire_txt'`, `report_kind` of the form `partner.1099fire.misc` or `admin.1099fire.misc`). Test downloads (`scope.test = true`) write a row too, so the table catches both real and dry-run files.
2. `tax_1099_filings` — the per-recipient filing-status table the dashboard updates when a 1099 is queued, filed, accepted, rejected, or delivered. Anything that left the building as a real submission would have a row here with `form_type = 'MISC'` and `status` in (`queued`, `filed`, `accepted`, `delivered`).

Production read-only queries (May 1, 2026) returned:

| Check | Result |
|---|---|
| `SELECT count(*) FROM report_export_audit_log` | **0** |
| `SELECT count(*) FROM report_export_audit_log WHERE format = '1099_fire_txt'` | **0** |
| `SELECT count(*) FROM tax_1099_filings` | **0** |
| `SELECT count(*) FROM tax_1099_filings WHERE form_type = 'MISC'` | **0** |
| `SELECT count(*) FROM partners` (sanity check that prod isn't an empty replica) | 59 |
| `SELECT count(*) FROM vendors` | 74 |
| `SELECT count(*) FROM invoices` | 4 |

Both relevant tables are deployed (verified via `information_schema.tables`); they are simply unused. The 1099 reporting pipeline has never been exercised in production — no test files, no real files, no dashboard "mark as filed" actions of any kind.

## Conclusion

No real 1099-MISC FIRE submission has ever been generated, downloaded, or marked as filed in the production environment. The buggy header mask therefore could not have shipped to the IRS for any vendor with attorney payments.

**No corrected ("G") return is required, and no IRS communication is needed.**

The mask is fixed going forward, and the A/B drift guard test in `artifacts/api-server/src/lib/reports/fire.test.ts` will fail any future regression on Box 10 (or any other amount-code slot), so the same drift cannot reappear silently the next time a year-end run is exported.

## Re-checking later (year-end 2026)

If, between now and the first real production FIRE export, anyone wants to re-confirm that no buggy file has been shipped, the same evidence can be re-pulled with:

```sql
-- Any FIRE 1099-MISC files audited at all?
SELECT id, report_kind, scope, row_count, file_bytes,
       downloaded_by_user_id, created_at
FROM report_export_audit_log
WHERE format = '1099_fire_txt'
  AND report_kind LIKE '%1099fire.misc%'
ORDER BY created_at;

-- Any MISC filings ever marked queued/filed/accepted?
SELECT id, tax_year, payer_partner_id, recipient_vendor_id,
       status, filing_method, corrected_status, total_amount,
       external_reference, filed_at
FROM tax_1099_filings
WHERE form_type = 'MISC'
  AND status IN ('queued', 'filed', 'accepted', 'delivered')
ORDER BY filed_at NULLS LAST, id;
```

If both queries continue to return zero rows up to the first real year-end submission, this incident remains fully closed and no corrected return is needed.
