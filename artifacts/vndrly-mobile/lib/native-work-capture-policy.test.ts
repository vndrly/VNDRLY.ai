import { describe, it, expect } from "vitest";
import {Buffer} from "node:buffer";
import {
  validateNativeUploadDestination,
  readNativeTransport,
  NativeScanDraftSchema,
  NativeSummaryDraftSchema,
  NativeDocumentBytesSchema,
} from "./native-work-capture-policy";
const id = "10000000-0000-4000-8000-000000000001",
  fileId = "10000000-0000-4000-8000-000000000002",
  digest = "a".repeat(64);
const signed = `https://vndrly.ai/api/storage/upload/${id}?expires=2000&signature=${digest}`;
describe("native private work capture boundaries", () => {
  it("accepts the full ten-MiB selected source without truncating or exhausting the byte-receipt validator",()=>{
    const bytes=Buffer.alloc(10*1024*1024);bytes.write("%PDF-");
    const receipt=NativeDocumentBytesSchema.parse({fileId,contentType:"application/pdf",byteSize:bytes.length,sha256:digest,bodyBase64:bytes.toString("base64")});
    expect(receipt.byteSize).toBe(10*1024*1024);expect(receipt.bodyBase64.length).toBe(13981016);
  });
  it("refuses interior padding, invalid source alphabet and contradictory byte length",()=>{
    const value={fileId,contentType:"application/pdf",byteSize:14,sha256:digest,bodyBase64:"JVBERi1zeW50aGV0aWM="};
    for(const bodyBase64 of ["JVBERi=zeW50aGV0aWM=","JVBERi-zeW50aGV0aWM=","JVBERi1zeW50aGV0aWM==="]){expect(NativeDocumentBytesSchema.safeParse({...value,bodyBase64}).success).toBe(false);}
    expect(NativeDocumentBytesSchema.safeParse({...value,byteSize:15}).success).toBe(false);
  });
  it("accepts only the current canonical signed upload transport", () => {
    expect(
      validateNativeUploadDestination(signed, "https://vndrly.ai", 1000),
    ).toBe(signed);
  });
  it.each([
    signed.replace("vndrly.ai", "vndrly.ai.evil"),
    signed.replace("https:", "http:"),
    signed + "&target=elsewhere",
    signed + "#secret",
    signed.replace("expires=2000", "expires=999"),
    signed.replace("signature=", "signature=x"),
    signed.replace("/storage/upload/", "/tickets/"),
  ])("refuses hostile, expired or nonupload URL %s", (url) => {
    expect(() =>
      validateNativeUploadDestination(url, "https://vndrly.ai", 1000),
    ).toThrow();
  });
  it("rejects duplicate signature parameters and foreign configured origin paths", () => {
    expect(() =>
      validateNativeUploadDestination(
        signed + `&signature=${digest}`,
        "https://vndrly.ai",
        1000,
      ),
    ).toThrow();
    expect(() =>
      validateNativeUploadDestination(signed, "https://vndrly.ai/other", 1000),
    ).toThrow();
  });
  it("binds transport readback to exact job, file, digest and account while refusing canonical proof", () => {
    const expected = {
      jobId: id,
      fileId,
      contextBinding: "user:7:membership:2:version:3",
      sha256: digest,
    };
    const row = {
      ...expected,
      status: "transport_complete",
      httpStatus: 204,
      byteSize: 1024,
      canonicalSaved: false,
    };
    expect(readNativeTransport(row, expected).canonicalSaved).toBe(false);
    expect(() =>
      readNativeTransport({ ...row, httpStatus: 500 }, expected),
    ).toThrow();
    expect(() =>
      readNativeTransport({ ...row, contextBinding: "other" }, expected),
    ).toThrow();
    expect(() =>
      readNativeTransport({ ...row, canonicalSaved: true }, expected),
    ).toThrow();
  });
  it("bounds aggregate staged pages and rejects page authority fields", () => {
    const page = {
      fileId,
      uri: "file:///private/page.jpg",
      contentType: "image/jpeg",
      byteSize: 20 * 1024 * 1024,
      sha256: digest,
      ocrText: "Saved text",
      ocrTruncated: false,
    };
    const scan = {
      source: "visionkit_document_scan",
      reviewRequired: true,
      canonicalSaved: false,
      pages: [page],
    };
    expect(NativeScanDraftSchema.parse(scan).pages).toHaveLength(1);
    expect(() =>
      NativeScanDraftSchema.parse({ ...scan, pages: [page, page] }),
    ).toThrow();
    expect(() =>
      NativeScanDraftSchema.parse({
        ...scan,
        pages: [{ ...page, ownerId: 9 }],
      }),
    ).toThrow();
  });
  it("refuses fabricated scan and AI provenance or saved flags", () => {
    expect(() =>
      NativeScanDraftSchema.parse({
        source: "camera",
        pages: [],
        reviewRequired: false,
        canonicalSaved: true,
      }),
    ).toThrow();
    expect(() =>
      NativeSummaryDraftSchema.parse({
        source: "cloud",
        text: "Invented",
        reviewRequired: true,
        canonicalSaved: false,
      }),
    ).toThrow();
  });
});
