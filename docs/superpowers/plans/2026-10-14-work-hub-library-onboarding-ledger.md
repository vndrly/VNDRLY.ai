# Execution ledger
- User approved base written spec, Training addition and direct implementation plan. Execute all tasks here; one fresh final reviewer.
- Preserve preview worktree and unrelated pending changes. No shared DB reset/migration, real notifications, invented company policy/training, or credentials changes.
- Task 1 started: library/bundle/assignment contracts, pure field/grading/deadline rules, guarded nullable metadata columns.

- Task 1 RED/GREEN: library-policy suite 4 passed (exact multiple-answer scoring, private answer keys, date/choice validation, new-hire deadline versus expired poll). DB/API-Zod declarations built. Additive-only migration/runner prepared, not applied.
- Ruling: store immutable library/bundle versions as separate existing template rows with nullable metadata; serialize series revision numbering with a transaction advisory lock. Avoid creating a duplicate form store or destructive schema work.
- Ruling: group IDs include existing Work Hub channel UUIDs and crew:<preset ID>; crew presets reference vendorPeople IDs, resolved through current memberships rather than treating them as user IDs.
- Task 2 started: current-session/company command guards, draft authoring, safe published previews, revisions, archive, pinned bundle validation and immutable verified file snapshots. Legacy lists/exports exclude private library records.
- User suggested easier quiz imports. Quiz builder is already in approved plan; CSV import recommendation given, not added as an unapproved feature.
