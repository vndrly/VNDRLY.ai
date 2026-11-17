/** Eligible for pickup contact priority means opted in, never permission to assign. */
export function pickupShiftEligible(input: { optedIn: boolean }) {
  return input.optedIn;
}
