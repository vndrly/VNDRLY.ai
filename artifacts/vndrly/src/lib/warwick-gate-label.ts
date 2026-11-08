/** Customer-facing labels for the four Warwick gate posts. */
export function warwickGateLabel(siteId: number, gateName: string): string | undefined {
  if (siteId === 411 && gateName === "San Roman Completions 1") {
    return "Warwick Completions 1 - San Roman Completions 2";
  }
  if (siteId === 411 && gateName === "San Roman Completions 2") {
    return "Warwick San Roman Completions 2 - San Roman Completions 1";
  }
  if (siteId === 412 && gateName === "Cactus 152") return "Warwick Cactus 152";
  if (siteId === 413 && gateName === "Precision 550") return "Warwick Precision 550";
}
