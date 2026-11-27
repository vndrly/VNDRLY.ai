import { spellPlate } from "@workspace/gate-booth";

// While V is paused she still hears the room, and acts only on the phrases here.
const plain = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
const FILLER = "(?:(?:uh|um|ok|okay|alright|all right|hey|so|and|yeah|yes|now|well|just|please) )*";
const V = "(?:ask ?v(?:ee)?|v(?:ee)?)";
const SPAN = "(?:a|one) (?:sec|second|minute|moment|min)";
const FORM = "(?:the |that |this |our |his |her |their )?(?:check ?in|check ?out|form|entry)";
const PAUSE = new RegExp(`^${FILLER}(?:${V} )?${FILLER}(?:pause|hold (?:on|up|it)|hang on|wait|stand ?by|(?:give me |wait )?${SPAN})(?: (?:please|${V}|there|up|${FORM}|(?:for )?(?:just )?${SPAN}))*$`);
const LEAD = "(?:(?:let's|lets|let us|we can|you can|can we|can you|go ahead and) )*";
// Said on their own, these continue. The looser ones only count after V's name: "V, go ahead".
const CONTINUE = `continue|resume|unpause|un pause|wake up|i'm back|i am back|we're back|we are back|where were we|pick (?:it )?(?:back )?up|(?:finish|finish up|complete|get back to|go back to|back to) ${FORM}`;
const AFTER_NAME = "go ahead|go on|keep going|carry on|proceed|listen|start listening|are you there|you there";
const TAIL = `(?: (?:please|now|${V}|${FORM}|with ${FORM}|where we left off))*`;
const RESUME = new RegExp(`^${FILLER}${LEAD}(?:${CONTINUE})${TAIL}$`);
const RESUME_NAMED = new RegExp(`^${FILLER}${LEAD}(?:${CONTINUE}|${AFTER_NAME})${TAIL}$`);
const CALL = /^(?:(?:uh|um|ok(?:ay)?|alright|all right|hey|so|and|yeah|yes|now|well)[,.!\s]+)*(?:ask[\s-]?v(?:ee)?|v(?:ee)?)(?=[,.!?:;\s]|$)[,.!?:;\s]*/i;

/** "Pause", "hold on", "hold up a sec", "wait", "give me a minute": the whole utterance, nothing else in it. */
export const isAskVPause = (text: string) => PAUSE.test(plain(text));

/**
 * A call that brings V back from a pause. Returns null when the words are not for her,
 * "" when she was only called or told to continue, and otherwise the request that followed her name.
 */
export function askVWake(text: string): string | null {
  const said = text.trim(), call = CALL.exec(said);
  if (!call) return RESUME.test(plain(said)) ? "" : null;
  const rest = said.slice(call[0].length), words = plain(rest);
  return !words || RESUME_NAMED.test(words) ? "" : rest;
}

/** Where an unfinished check-in stands: what is on the form so far, then the next question. */
export function checkInProgress(review: { firstName: string; lastName: string; company: string; vehiclePlate: string; plateState: string } | null, question: string): string {
  const filled = review ? [
    `${review.firstName} ${review.lastName}`.trim(), review.company,
    [review.vehiclePlate && spellPlate(review.vehiclePlate), review.plateState].filter(Boolean).join(", "),
  ].filter(Boolean) : [];
  return filled.length ? `${filled.join(", ")}. ${question}` : question;
}
