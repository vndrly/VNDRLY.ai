import { NativeModule, requireOptionalNativeModule } from "expo";
import type {
  WorkCaptureCapabilities,
  WorkCaptureScan,
  WorkCaptureSummary,
  WorkCaptureFile,
  WorkCaptureUpload,
} from "./VndrlyWorkCapture.types";
declare class VndrlyWorkCapture extends NativeModule {
  getCapabilities(): Promise<WorkCaptureCapabilities>;
  /** Current local account fence, never a server permission or consent. null cancels old-context transport. */
  setContext(contextBinding: string | null): Promise<void>;
  scanDocument(contextBinding: string): Promise<WorkCaptureScan>;
  transcribeLocalDraft(input: { contextBinding: string; uri: string; language: "en-US" | "es-ES" }): Promise<{ source: "speech_on_device"; text: string; reviewRequired: true; canonicalSaved: false }>;
  summarizeDraft(input: {
    contextBinding: string;
    text: string;
    language: "en" | "es";
  }): Promise<WorkCaptureSummary>;
  stageFile(input: {
    contextBinding: string;
    uri: string;
  }): Promise<WorkCaptureFile>;
  discardDraft(input: {
    contextBinding: string;
    fileIds: string[];
  }): Promise<void>;
  startUpload(input: {
    contextBinding: string;
    jobId: string;
    fileId: string;
    uploadUrl: string;
    canonicalApiOrigin: string;
    contentType: string;
    wifiOnly?: boolean;
  }): Promise<WorkCaptureUpload>;
  readUpload(input: {
    contextBinding: string;
    jobId: string;
  }): Promise<WorkCaptureUpload | null>;
  cancelUpload(input: { contextBinding: string; jobId: string }): Promise<void>;
}
// Expo Go/Android/older installed binaries keep the existing manual workflow.
export default requireOptionalNativeModule<VndrlyWorkCapture>(
  "VndrlyWorkCapture",
);
