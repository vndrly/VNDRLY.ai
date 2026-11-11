export type AskVToolResultStatus = "success" | "failure" | "requires_confirmation";

export function classifyToolResult(output: string, mutating: boolean): AskVToolResultStatus {
  try {
    const parsed = JSON.parse(output) as {
      error?: unknown;
      requiresConfirmation?: unknown;
      ok?: unknown;
      status?: unknown;
    };
    if (parsed === null || typeof parsed !== "object") return "failure";
    if (Array.isArray(parsed)) return mutating ? "failure" : "success";
    if (mutating && parsed.requiresConfirmation === true) return "requires_confirmation";
    if (parsed.error || parsed.ok === false || ["failed", "failure", "rejected", "unavailable", "unknown", "outcome_unknown"].includes(String(parsed.status))) return "failure";
    if (mutating) {
      const record = parsed as Record<string, unknown>;
      const identity = ["id", "operationId", "taskId", "ticketId", "visitId", "messageId", "resourceId", "shiftId", "eventId", "invoiceId"].some(key => typeof record[key] === "string" || typeof record[key] === "number");
      const resource = ["resource", "task", "ticket", "visit", "asset", "receipt"].some(key => {
        const value = record[key];
        return value && typeof value === "object" && !Array.isArray(value) && ("id" in value || "operationId" in value);
      });
      if (parsed.ok !== true && !identity && !resource) return "failure";
    }
  } catch {
    // An unreadable receipt cannot establish a saved action.
    return "failure";
  }
  return "success";
}
