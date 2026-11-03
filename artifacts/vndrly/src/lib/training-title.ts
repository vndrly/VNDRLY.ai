/** Consistent labels for current and future course/certificate assignments. */
export function formatTrainingTitle(title: string): string {
  const parts = title.split(/\s+—\s+|\s+\|\s+/).map((part) => part.trim());
  if (parts.length < 2) return title;
  // Company-prefixed certificate names include both company and category.
  const [category, ...name] = parts.length > 2 && title.includes(" — ") ? parts.slice(1) : parts;
  return `${category} | ${name.join(" | ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())}`;
}
