import { OperationsDisplayViewSchema, type OperationsDisplayView } from "@workspace/api-zod";
type State = Omit<OperationsDisplayView, "receivedAt" | "records" | "truncated" | "physicalDisplayVerified" | "cameraStarted" | "microphoneStarted">;
type RecordRow = OperationsDisplayView["records"][number];
export type OperationsDisplayViewState = State;
export function createOperationsDisplayViewer(deps: { authorize(displayId: string, monitorId: string): Promise<State | null>; read(state: State): Promise<RecordRow[] | { records: RecordRow[]; truncated: boolean }>; now(): Date }) {
  return { async read(displayId: string, monitorId: string) {
    const current = await deps.authorize(displayId, monitorId);
    if (!current || current.displayId !== displayId || current.monitorId !== monitorId) throw Error("display_view.unavailable");
    const source = await deps.read(current);
    const records = Array.isArray(source) ? source : source.records;
    const fresh = await deps.authorize(displayId, monitorId);
    if (!fresh || JSON.stringify(fresh) !== JSON.stringify(current)) throw Error("display_view.unavailable");
    return OperationsDisplayViewSchema.parse({ ...fresh, records: records.slice(0, 100), truncated: records.length >= 100 || !Array.isArray(source) && source.truncated, receivedAt: deps.now().toISOString(), physicalDisplayVerified: false, cameraStarted: false, microphoneStarted: false });
  } };
}
