// How V keeps her link: the waits between her own reconnects, the check that the far end is still sending,
// and the move to a fresh session before the voice service ends the old one.

/** The wait before each reconnect V makes on her own after the link drops. Past the last one she stops and says so. */
export const VOICE_RETRY_WAITS_MS = [0, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
/** A link that stayed up this long was a good one: the next drop starts the waits over. */
export const VOICE_STEADY_MS = 30_000;

/** Where V is in her reconnects. */
export function createVoiceRetryLadder(waits: readonly number[] = VOICE_RETRY_WAITS_MS, steady = VOICE_STEADY_MS) {
  let rung = 0;
  return {
    /** The wait before the next reconnect, or null when every one has been tried. `upFor` is how long the dropped link had been up. */
    next(upFor: number): number | null {
      if (upFor >= steady) rung = 0;
      if (rung >= waits.length) { rung = 0; return null; }
      return waits[rung++];
    },
    reset() { rung = 0; },
  };
}

/** How often V reads what the far end has sent, and checks whether it is time for a fresh session. */
export const VOICE_PULSE_MS = 3_000;

/** Everything the far end has sent on this link, from one WebRTC statistics report. Null when the report counts none of it. */
export function voiceLinkReceived(stats: Iterable<Record<string, unknown>>): number | null {
  let total: number | null = null;
  const add = (value: unknown) => { if (typeof value === "number" && Number.isFinite(value)) total = (total ?? 0) + value; };
  for (const stat of stats) {
    if (stat.type === "inbound-rtp") add(stat.packetsReceived);
    // Connectivity answers arrive every few seconds on a live link even when nobody is speaking.
    if (stat.type === "candidate-pair") { add(stat.bytesReceived); add(stat.responsesReceived); add(stat.requestsReceived); }
    if (stat.type === "transport") add(stat.bytesReceived);
    if (stat.type === "data-channel") add(stat.messagesReceived);
  }
  return total;
}

/**
 * A link that was receiving and then receives nothing for `limit` readings in a row is dead, whatever its state says.
 * A link never seen receiving is left alone, so a device that reports no statistics cannot be dropped by this.
 */
export function createVoiceLinkPulse(limit = 3) {
  let last: number | null = null, moved = false, still = 0;
  return (received: number | null): boolean => {
    if (received === null) return false;
    if (last !== null) { if (received > last) { moved = true; still = 0; } else still += 1; }
    last = received;
    return moved && still >= limit;
  };
}

/** The voice service ends every session at 60 minutes. From this age V moves to a fresh one at the first quiet moment... */
export const VOICE_REFRESH_AFTER_MS = 50 * 60_000;
/** ...and at this age whether or not it is quiet, while there is still time to do it in order. */
export const VOICE_REFRESH_BY_MS = 57 * 60_000;
export const voiceRefreshDue = (age: number, quiet: boolean) => age >= VOICE_REFRESH_BY_MS || (quiet && age >= VOICE_REFRESH_AFTER_MS);
