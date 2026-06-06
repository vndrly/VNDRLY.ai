-- Acting foreman: field employee designated to lead a ticket when the
-- assigned foreman cannot be on site. Same vendor crew membership rules as
-- foremanUserId but does not replace the primary foreman assignment.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS acting_foreman_user_id integer;

COMMENT ON COLUMN tickets.acting_foreman_user_id IS
  'User id of crew member acting as foreman for this ticket when primary foremanUserId is off site.';
