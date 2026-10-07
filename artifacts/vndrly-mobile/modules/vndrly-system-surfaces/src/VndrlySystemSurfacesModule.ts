import { NativeModule, requireOptionalNativeModule } from "expo";
export type WorkActivitySnapshot = {
  /** Hashable exact validated server session/user/membership binding, never a token. */
  contextBinding: string;
  subjectKind: "ticket" | "shift" | "fleet";
  subjectId: string;
  phase: "assigned" | "en_route" | "on_location" | "on_site" | "on_duty" | "paused" | "in_progress";
  /** Unix seconds from the actual accepted canonical read, expires <= recordedAt + 300. */
  recordedAt: number;
  expiresAt: number;
};
declare class VndrlySystemSurfaces extends NativeModule {
  getCapabilities(): Promise<{ liveActivities: boolean; remoteUpdates: false; appIntents: boolean }>;
  setContext(contextBinding: string | null): Promise<void>;
  updateWorkActivity(snapshot: WorkActivitySnapshot): Promise<string>;
  endWorkActivities(): Promise<void>;
}
export default requireOptionalNativeModule<VndrlySystemSurfaces>("VndrlySystemSurfaces");