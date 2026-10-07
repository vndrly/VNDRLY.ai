export type WorkCaptureCapabilities = {
  scanner: boolean;
  ocr: boolean;
  onDeviceDraft: boolean;
  draftReason:
    | "available"
    | "model_unavailable"
    | "unsupported_os"
    | "sdk_unavailable";
  backgroundUpload: boolean;
};
export type WorkCapturePage = {
  fileId: string;
  uri: string;
  contentType: "image/jpeg";
  byteSize: number;
  sha256: string;
  ocrText: string;
  ocrTruncated: boolean;
};
export type WorkCaptureScan = {
  source: "visionkit_document_scan";
  reviewRequired: true;
  canonicalSaved: false;
  pages: WorkCapturePage[];
};
export type WorkCaptureSummary = {
  source: "foundation_models_on_device";
  reviewRequired: true;
  canonicalSaved: false;
  text: string;
};
export type WorkCaptureFile = {
  fileId: string;
  uri: string;
  byteSize: number;
  sha256: string;
};
export type WorkCaptureUpload = {
  jobId: string;
  fileId: string;
  contextBinding: string;
  status:
    | "queued"
    | "uploading"
    | "transport_complete"
    | "failed"
    | "cancelled";
  httpStatus: number | null;
  byteSize: number;
  sha256: string;
  canonicalSaved: false;
};
