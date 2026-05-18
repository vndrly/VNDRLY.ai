-- Idempotent backfill for vendor_people.preferred_language.
--
-- Background: Task #477 added the nullable `vendor_people.preferred_language`
-- column so the token-mode onboarding assistant can pick a language before a
-- `users` row exists. Crews who finished onboarding before that change have a
-- populated `users.preferred_language` but a NULL `vendor_people.preferred_language`,
-- which makes the post-auth assistant default to English on their first reply.
--
-- This script copies `users.preferred_language` onto the matching
-- `vendor_people` row whenever:
--   * vendor_people.user_id IS NOT NULL (the invitee finished the wizard)
--   * vendor_people.preferred_language IS NULL (not already set)
--   * users.preferred_language IS NOT NULL (we have something to copy)
--
-- Soft-deleted vendor_people rows are intentionally skipped — they no longer
-- participate in the assistant flow and there is no value in mutating tombstones.
--
-- Idempotent: only fills NULL targets, so re-running is a no-op once complete.
--
-- Production run log:
--   - <YYYY-MM-DD>: not yet run in production. Update this header with the
--     UTC timestamp, the row count returned by the UPDATE, and a one-line note
--     about anything skipped (e.g. rows where users.preferred_language was also NULL).

UPDATE vendor_people vp
SET preferred_language = u.preferred_language
FROM users u
WHERE vp.user_id = u.id
  AND vp.preferred_language IS NULL
  AND u.preferred_language IS NOT NULL
  AND vp.deleted_at IS NULL;
