export type TrainingProgressMethod = "baseline" | "server" | "render" | "cache";

/** Ghost comparisons are available only to local dev or an explicit benchmark build. */
export const trainingProgressExperimentsEnabled = import.meta.env.DEV || import.meta.env.MODE === "benchmark";

export function trainingProgressMethod(search?: string): TrainingProgressMethod | null {
  const query = search ?? (typeof window !== "undefined" ? window.location.search : "");
  const parameters = new URLSearchParams(query);
  // Explicit production ghost links affect only this page. API comparison reads
  // are independently restricted to authenticated company administrators.
  if (!trainingProgressExperimentsEnabled && parameters.get("progressBenchmark") !== "1") return null;
  const method = parameters.get("progressMethod");
  return method === "baseline" || method === "server" || method === "render" || method === "cache" ? method : null;
}

/** Normal startup uses the measured prefetch strategy; local comparisons can
 * explicitly select the unchanged baseline or another isolated strategy.
 * Request headers must continue to use trainingProgressMethod, not this default.
 */
export function effectiveTrainingProgressMethod(search?: string): TrainingProgressMethod {
  return trainingProgressMethod(search) ?? "cache";
}
