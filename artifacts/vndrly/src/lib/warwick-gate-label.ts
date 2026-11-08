/** Preserve explicitly named Warwick posts verbatim; names belong to the database. */
export function warwickGateLabel(_siteId: number, gateName: string): string | undefined {
  return gateName.startsWith("Warwick ") ? gateName : undefined;
}
