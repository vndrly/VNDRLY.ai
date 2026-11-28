// The voice service reports a refused request (a cancel that came too late, an item already gone) as an
// error while the link stays up. Ending V for those is what a "drop" usually was.
const ENDS = /session_expired|invalid_api_key|authentication|unauthorized/i;

/** The service's own code for an error, wherever the SDK nested it. */
export function voiceErrorCode(failure: unknown): string {
  let value = failure;
  for (let depth = 0; depth < 4 && value && typeof value === "object"; depth++) {
    const { code, error } = value as { code?: unknown; error?: unknown };
    if (typeof code === "string") return code;
    value = error;
  }
  return "";
}

/** Only a dead link, an expired session or a refused sign-in ends the session; anything else is one refused request. */
export const voiceErrorEndsSession = (failure: unknown, linkUp: boolean) => !linkUp || ENDS.test(voiceErrorCode(failure));
