# Vendor repository, VNDRLY/U and Travel implementation

**Authorization:** John approved the combined scope and directed implementation followed by all nine full-ship tracks on 2026-11-02. Preserve credentials, records and unrelated work. Existing three label edits are part of this scope.

**Design:** Reuse private managed file objects and the organization-scoped Work Hub library record store. Logical folders, assignments, trips, expenses and augmentation reference existing IDs; no second blob store and no destructive migration. Authorization comes from current membership and explicit folder grants, not client labels. Admin controls categories, folder ACLs and Assign Travel grants; Office Staff with Assign Travel can manage travel. Every trip has one traveler and original authorization provenance. Money uses integer cents, mileage uses explicit vendor rates (no invented tax/reimbursement rate). Review is separate from payment; no bank transfer is introduced.

**Sources compared:**
- Expensify distance expenses: https://help.expensify.com/articles/new-expensify/reports-and-expenses/Distance-Expenses — manual/odometer distance, dated rates.
- Expensify receipt changes: https://github.com/Expensify/App/blob/main/docs/articles/new-expensify/reports-and-expenses/Attach-and-edit-receipts-on-expenses.md — attribution and immutable change history.
- Zoho trip management: https://www.zoho.com/us/expense/help/trips/managing-trips/ — authorized trip, trip-associated expenses, close after review.
- SAP Concur overview: https://learning.sap.com/courses/concur-expense-learning-journey-for-customer-end-users/introduction-to-concur-expense_ce973f2c-5142-410e-a694-004cf9ab43ea — receipt/manual correction, review states, reporting.

## Execution tasks
- [ ] Shared contracts and pure permission/travel/progress/bonus rules with tests.
- [ ] Organization-scoped repository API: categories/folders, Read/Write/Edit, Assign Travel, attribution, reference associations, idempotency/version checks and audit.
- [ ] File Library theme, sortable metadata and flyout; upload folder selector; training designation and augmentation references.
- [ ] Travel folder working templates, recipient selection using Individuals/Groups/Positions, per-traveler trip instances, mileage/receipts/expenses, submit/return/approve/close, exports and office/person totals.
- [ ] Connect Conversations/meeting file categorization and existing receipt IDs without copying or widening channel privacy.
- [ ] VNDRLY/U tabs, vendor augmentations, shared course completion steppers, profile certifications, source-backed renewal settings and separate 0–10 bonus.
- [ ] Web/iOS parity, current theme, narrow-screen verification, tenant/role/ownership regression checks.
- [ ] Fresh whole-branch review and required validation. Then preserve exact release authorization/state and execute all nine full-ship tracks using existing entry points and finite timeouts.

## Verification focus
Cross-vendor guessed IDs deny; revoked grants deny on command replay; read-only assignments cannot modify originals; channel associations never grant the trip access to a private conversation; repeated commands cannot double-count expenses; currency totals never combine currencies; course/version reuse does not grant answer keys; vendor bonus never changes base100; unreviewed receipts do not become paid expenses.

## Rulings
- Approved scope and interview supersede repeating design approval. Execute inline and obtain one fresh review at the end per executing-plans skill.
- Use existing JSON record store for additive feature records; no broad schema or dependency change is needed.
- Travel examples are templates, not fabricated actual trips or expense history; the vendor explicitly enables/configures them.

## Implementation checkpoint, 2026-11-02
- Shared file references retain original blob IDs and conversation/meeting privacy; reviewed trip receipt snapshots retain exact files.
- Web and iOS expose folder permissions, Travel templates/forms/expenses and VNDRLY/U augmentation/progress.
- Review corrections cover current recipient Read checks, replay authorization, trip upload locking, unique vendor-only bonus requirements and assigned-course deep links. Renewal uses the earlier applicable expiry and prepares current assignments.
- Focused evidence: API repository/certification integration 3 passing; mobile repository/inventory 11 passing; shared contracts 5 passing; web Files/Notes 1 passing; locale parity passing. Broader release validation remains required for the final commit.
- Public and localhost rendered verification remains subject to the saved browser access restriction. Do not claim rendered completion from compilation or HTTP checks.
- User correction: plugin work LAST, preserving the original identity and grants. Finish all other runnable release tracks first.
