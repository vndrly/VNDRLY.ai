const STRUCTURED_ASKV_RESULT_PATTERN =
  /\|.+\||```|\b(total|quarter|report|results?|meetings?|agendas?|messages?|files?|tasks?|forms?|employees?|certifications?|schedules?|tables?|summaries?)\b/i;

/** Keep short answers conversational and offer dense/structured answers in a larger result surface. */
export function shouldOfferAskVVisualResult(content: string): boolean {
  const normalized = content.trim();
  return normalized.length >= 240 || STRUCTURED_ASKV_RESULT_PATTERN.test(normalized);
}
