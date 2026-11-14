import type { NativeOperationsStatus } from "./native-operations-policy";
/** Preserve the saved duty/consent state while limiting this release's work surfaces. */
export function gateNativeStatus(
  status: NativeOperationsStatus,
): NativeOperationsStatus {
  return {
    ...status,
    tasks: status.tasks?.filter((t) => t.kind === "gate"),
    selectedTask:
      status.selectedTask?.kind === "gate" ? status.selectedTask : null,
    requests: status.requests.filter((r) => r.ticketId == null),
  };
}
