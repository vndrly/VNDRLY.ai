/** Shared drizzle table tag proxies for `@workspace/db` vitest mocks. */
export function tableTag(name: string) {
  return new Proxy(
    { __name: name },
    { get: (_t, k: string) => ({ __table: name, __col: k }) },
  );
}

export const ticketCrewTable = tableTag("ticketCrew");
