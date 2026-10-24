/** Willingness is not an assignment. Recheck this evidence when offering/assigning. */
export function pickupShiftEligible(input: {
  optedIn: boolean; startsAt: Date; endsAt: Date; available: boolean;
  allowed: boolean; overrideRequired: boolean;
  commitments: { start: Date; end: Date | null }[];
}) {
  const { startsAt: start, endsAt: end } = input;
  if (!input.optedIn || !input.available || !input.allowed || input.overrideRequired || !Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) return false;
  // Match the existing staffing policy's eight-hour rest window, across employers.
  return !input.commitments.some(row => !Number.isFinite(+row.start) || !row.end || !Number.isFinite(+row.end)
    || (+row.start < +end + 8 * 3600000 && +row.end > +start - 8 * 3600000));
}
