export function isAskVWakePhrase(text: string, confidence = 1): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
  if (["askv", "ask v", "hey v", "heyv"].includes(normalized)) return confidence >= 0.65;
  if (normalized === "v") return confidence >= 0.9;
  return false;
}
