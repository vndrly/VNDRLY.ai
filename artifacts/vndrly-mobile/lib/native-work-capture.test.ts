import { beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({
  current: true,
  user: {
    id: 1069,
    role: "partner",
    activeMembershipId: 795,
    partnerId: 609,
    requiresContextChoice: false,
  },
  api: vi.fn(),
  setContext: vi.fn(),
  summary: vi.fn(),
  scan: vi.fn(),
  pick: vi.fn(),
  readDocument: vi.fn(),
  discard: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("./api", () => ({ apiFetch: env.api }));
// Context validation is real; its best-effort cache write is not this wrapper's
// subject and must not open the device cache during a picker/scan unit test.
vi.mock("./native-assigned-cache",()=>({cacheAssignedRead:vi.fn(async()=>undefined),readAssignedCache:vi.fn(async()=>null)}));
vi.mock("./auth", () => ({
  captureAuthScope: () => ({ generation: 1 }),
  getUser: async () => env.user,
  isAuthScopeCurrent: () => env.current,
  subscribeToken: vi.fn(),
  subscribeUser: vi.fn(),
}));
vi.mock("../modules/vndrly-work-capture/src/VndrlyWorkCaptureModule", () => ({
  default: {
    setContext: env.setContext,
    summarizeDraft: env.summary,
    scanDocument: env.scan,
    pickDocument: env.pick,
    readDocumentDraft: env.readDocument,
    discardDraft: env.discard,
  },
}));
import {
  scanWorkDocumentDraft,
  scanWorkTextDraft,
  summarizeWorkDraft,
  pickWorkDocumentDraft,
  readWorkDocumentDraft,
} from "./native-work-capture";

describe("current-account native work drafts", () => {
  it("reads source bytes only for the picked account-bound identity and refuses changed bytes without deleting the draft",async()=>{
    const picked={source:"system_document_picker" as const,reviewRequired:true as const,canonicalSaved:false as const,fileId:"70000000-0000-4000-8000-000000000001",uri:"file:///private/source",byteSize:14,sha256:"a".repeat(64),contentType:"application/pdf" as const};
    const body={fileId:picked.fileId,contentType:picked.contentType,byteSize:14,sha256:picked.sha256,bodyBase64:"JVBERi1zeW50aGV0aWM="};
    env.readDocument.mockResolvedValue(body);expect(await readWorkDocumentDraft(picked)).toEqual(body);expect(env.readDocument).toHaveBeenLastCalledWith({contextBinding:'["vndrly-work-capture",1069,795,"partner",609,2]',fileId:picked.fileId});
    env.readDocument.mockResolvedValue({...body,sha256:"b".repeat(64)});await expect(readWorkDocumentDraft(picked)).rejects.toThrow();expect(env.discard).not.toHaveBeenCalled();
  });
  it("imports a bounded private PDF draft with no upload or canonical-save claim",async()=>{
    env.pick.mockResolvedValue({source:"system_document_picker",reviewRequired:true,canonicalSaved:false,fileId:"70000000-0000-4000-8000-000000000001",uri:"file:///private/source",byteSize:12,sha256:"a".repeat(64),contentType:"application/pdf"});
    expect(await pickWorkDocumentDraft()).toMatchObject({contentType:"application/pdf",canonicalSaved:false});expect(env.pick).toHaveBeenCalledWith('["vndrly-work-capture",1069,795,"partner",609,2]');
  });
  it("discards only the just-imported unaccepted document when the account changes or native output exceeds the source limit",async()=>{
    const fileId="70000000-0000-4000-8000-000000000001",value={source:"system_document_picker",reviewRequired:true,canonicalSaved:false,fileId,uri:"file:///private/source",byteSize:12,sha256:"a".repeat(64),contentType:"application/pdf"};
    env.pick.mockImplementation(async()=>{env.current=false;return value;});await expect(pickWorkDocumentDraft()).rejects.toThrow("account_changed");expect(env.discard).toHaveBeenLastCalledWith({contextBinding:'["vndrly-work-capture",1069,795,"partner",609,2]',fileIds:[fileId]});
    env.current=true;env.pick.mockResolvedValue({...value,byteSize:10*1024*1024+1});await expect(pickWorkDocumentDraft()).rejects.toThrow();
    expect(env.discard).toHaveBeenCalledTimes(2);
  });
  beforeEach(() => {
    env.current = true;
    env.user.requiresContextChoice = false;
    vi.clearAllMocks();
    env.api.mockResolvedValue({
      userId: 1069,
      activeMembershipId: 795,
      partnerId: 609,
      vendorId: null,
      sv: 2,
      role: "partner",
      requiresContextChoice: false,
    });
    env.setContext.mockResolvedValue(undefined);
    env.discard.mockResolvedValue(undefined);
  });
  it("returns reviewed local text with no canonical-save claim", async () => {
    env.summary.mockResolvedValue({
      source: "foundation_models_on_device",
      text: "Draft",
      reviewRequired: true,
      canonicalSaved: false,
    });
    expect(await summarizeWorkDraft("Work notes", "en")).toMatchObject({
      text: "Draft",
      canonicalSaved: false,
    });
    expect(env.setContext).toHaveBeenCalledWith(
      '["vndrly-work-capture",1069,795,"partner",609,2]',
    );
  });
  it("rejects output completed after the account changes", async () => {
    env.summary.mockImplementation(async () => {
      env.current = false;
      return {
        source: "foundation_models_on_device",
        text: "Old account draft",
        reviewRequired: true,
        canonicalSaved: false,
      };
    });
    await expect(summarizeWorkDraft("Work notes", "en")).rejects.toThrow(
      "account_changed",
    );
  });
  it("requires an active chosen account before opening the scanner", async () => {
    env.user.requiresContextChoice = true;
    await expect(scanWorkDocumentDraft()).rejects.toThrow("account_changed");
    expect(env.scan).not.toHaveBeenCalled();
  });
  it("does not accept a native claim that a draft has already saved", async () => {
    env.summary.mockResolvedValue({
      source: "foundation_models_on_device",
      text: "Draft",
      reviewRequired: true,
      canonicalSaved: true,
    });
    await expect(summarizeWorkDraft("Work notes", "en")).rejects.toThrow();
  });
  it("keeps scanned text local and disposes images for the text-only workflow", async () => {
    const fileId = "70000000-0000-4000-8000-000000000001";
    env.scan.mockResolvedValue({
      source: "visionkit_document_scan",
      reviewRequired: true,
      canonicalSaved: false,
      pages: [
        {
          fileId,
          uri: "file:///private/scan.jpg",
          contentType: "image/jpeg",
          byteSize: 123,
          sha256: "a".repeat(64),
          ocrText: "Work text",
          ocrTruncated: false,
        },
      ],
    });
    expect(await scanWorkTextDraft()).toMatchObject({
      text: "Work text",
      source: "visionkit_document_scan",
      canonicalSaved: false,
    });
    expect(env.discard).toHaveBeenCalledWith({
      contextBinding: '["vndrly-work-capture",1069,795,"partner",609,2]',
      fileIds: [fileId],
    });
  });
  it("validates malformed scan pages without masking the error and cleans only bounded UUIDs", async () => {
    const fileId = "70000000-0000-4000-8000-000000000001";
    env.scan.mockResolvedValue({
      pages: [null, { fileId }, { fileId: "../../secret" }],
    });
    await expect(scanWorkTextDraft()).rejects.toThrow();
    expect(env.discard).toHaveBeenCalledWith({
      contextBinding: '["vndrly-work-capture",1069,795,"partner",609,2]',
      fileIds: [fileId],
    });
    env.scan.mockResolvedValue(null);
    await expect(scanWorkTextDraft()).rejects.toThrow();
    expect(env.discard).toHaveBeenLastCalledWith({
      contextBinding: '["vndrly-work-capture",1069,795,"partner",609,2]',
      fileIds: [],
    });
  });
  it("does not expose text when cleanup fails or the account changes during cleanup", async () => {
    const fileId = "70000000-0000-4000-8000-000000000001";
    env.scan.mockResolvedValue({
      source: "visionkit_document_scan",
      reviewRequired: true,
      canonicalSaved: false,
      pages: [
        {
          fileId,
          uri: "file:///private/page.jpg",
          contentType: "image/jpeg",
          byteSize: 20,
          sha256: "a".repeat(64),
          ocrText: "Private text",
          ocrTruncated: false,
        },
      ],
    });
    env.discard.mockRejectedValueOnce(new Error("filesystem"));
    await expect(scanWorkTextDraft()).rejects.toThrow("cleanup_failed");
    env.discard.mockImplementationOnce(async () => {
      env.current = false;
    });
    await expect(scanWorkTextDraft()).rejects.toThrow("account_changed");
  });
});
