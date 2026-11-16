/** Only same-service uploaded objects become authenticated photo previews. */
export function askVPhotoPaths(content: string): string[] {
  return [...new Set([...content.matchAll(/\[[^\]]*\]\((\/objects\/[A-Za-z0-9/_-]+)\)/g)].map(match => match[1]))].slice(0, 10);
}
