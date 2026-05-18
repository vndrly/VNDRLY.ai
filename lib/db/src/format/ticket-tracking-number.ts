/**
 * Canonical user-visible tracking number for a ticket.
 *
 * - Pads numeric ids to 8 digits, matching the new "VNDRLY-00000009" format
 *   we expose in the redesigned 6-step stepper.
 * - For ids that already exceed 8 digits we let the number grow naturally so
 *   we never silently truncate. (This keeps the formatter total — every
 *   positive integer maps to a unique, comparable string.)
 *
 * This is a pure formatter shared by web + mobile + the API. It must never
 * read from the database; the caller passes the id in.
 */
export function formatTicketTrackingNumber(id: number): string {
  if (!Number.isFinite(id) || id < 1 || !Number.isInteger(id)) {
    throw new Error(
      `formatTicketTrackingNumber: id must be a positive integer, got ${id}`,
    );
  }
  const padded = String(id).padStart(8, "0");
  return `VNDRLY-${padded}`;
}
