// Best-effort heuristic for classifying an assistant turn as a
// refusal — i.e. the model declined a user request because of role,
// scope, or out-of-scope subject matter. Used in two places:
//
//   1. `routes/assistant.ts` writes the result to
//      `assistant_messages.refusal` so the admin metrics card can
//      report a refusal rate over the trailing window.
//   2. `assistant/__evals__/tone.eval.ts` replays a small battery of
//      role-scoped out-of-scope prompts against the live model and
//      asserts the reply both trips this heuristic AND points the
//      user at a real screen — closing a tone-quality gap that the
//      offline catalog tests can't catch.
//
// Pulled into its own module so both call sites use the same regex.
// Without that, the eval would drift the moment somebody tweaked the
// English phrasing in the route file and forgot to update the eval.
//
// Intentional limitations:
//   - English + Spanish only. Other languages won't match. The
//     eval only exercises English refusal prompts (see
//     `docs/assistant-tone-eval.md`), but the metrics card needs
//     to count Spanish refusals so the admin dashboard doesn't
//     understate friction for Spanish-toggled crew members.
//   - First-paragraph (or first ~300 chars) only. We don't want a
//     long correct answer that happens to contain "I don't have"
//     deep in the body to flag as a refusal.

export const REFUSAL_RE =
  /\b(i (?:can'?t|cannot|don'?t have|won'?t)|(?:you|i) don'?t have (?:access|permission)|i'?m (?:not able|unable|sorry)|that'?s (?:outside|not (?:something|in)) my|not (?:permitted|allowed) (?:for|to))\b/i;

// Spanish refusal openings. Mirrors the English regex's intent:
//   - "no puedo" / "no podría" — "I can't" / "I couldn't"
//   - "no tengo (acceso|permiso|la capacidad)" — "I don't have …"
//   - "lo siento" / "lo lamento" — "I'm sorry"
//   - "(eso|esto) (está|queda) fuera de" — "that's outside …"
//   - "no está dentro de" — "it's not within …"
//   - "no me es posible" — "it's not possible for me"
// Spanish doesn't require a leading word boundary the same way
// (the apostrophe contractions don't apply), but we still anchor
// on `\b` to avoid matching mid-word.
export const REFUSAL_RE_ES =
  /\b(no\s+(?:puedo|podr[ií]a|tengo\s+(?:acceso|permiso|la\s+capacidad|forma)|me\s+es\s+posible|est[áa]\s+dentro\s+de)|(?:no\s+)?tienes\s+permiso|lo\s+(?:siento|lamento)|(?:eso|esto)\s+(?:est[áa]|queda)\s+fuera\s+de)\b/i;

export function classifyRefusal(text: string): boolean {
  if (!text) return false;
  // Check both the first paragraph AND the first ~300 characters.
  // The double-window catches the common Claude pattern of opening
  // with a polite greeting paragraph ("I'd be happy to help! \n\n
  // However, I don't have access to ...") while still avoiding
  // false-flags on long correct answers that happen to contain
  // "I don't have" deep in the body.
  const firstPara = text.split(/\n\n+/, 1)[0] ?? "";
  const head = text.slice(0, 300);
  return (
    REFUSAL_RE.test(firstPara) ||
    REFUSAL_RE.test(head) ||
    REFUSAL_RE_ES.test(firstPara) ||
    REFUSAL_RE_ES.test(head)
  );
}
