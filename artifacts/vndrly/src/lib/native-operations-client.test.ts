import { describe, expect, it } from "vitest";
import { nativeRequestEvidence, nativeRequestLabel, nativeOperationsRequest, nativeOperationErrorMessage } from "./native-operations-client";

describe("native operations canonical result presentation", () => {
  it("does not equate photo upload or delivery with a saved ticket result", () => {
    expect(nativeRequestEvidence({ state: "upload_in_progress", result: null })).toEqual([]);
    expect(nativeRequestLabel("upload_in_progress", "en")).toBe("Uploading — not saved yet");
  });
  it("labels cached location separately from a fresh unsuccessful request", () => {
    const evidence = nativeRequestEvidence({ state: "unavailable", result: { lastKnown: { latitude: 35, longitude: -97, capturedAt: "2026-10-07T20:00:00Z", accuracy: 42 } } });
    expect(evidence.join(" ")).toContain("Last known");
    expect(evidence.join(" ")).toContain("42");
  });
  it("retains the operation body exactly and never treats an HTTP error as saved", async () => {
    const body = { kind: "photo", workerUserId: 2, ticketId: 3, idempotencyKey: "original" };
    let sent: RequestInit | undefined;
    const result = await nativeOperationsRequest("/requests", { method: "POST", body: JSON.stringify(body) }, async (_url, init) => {
      sent = init;
      return new Response(JSON.stringify({ id: "canonical", state: "pending" }), { status: 201 });
    });
    expect(sent?.body).toBe(JSON.stringify(body));
    expect(sent?.credentials).toBe("include");
    expect(result).toMatchObject({ state: "pending" });
    await expect(nativeOperationsRequest("/status", {}, async () => new Response("denied", { status: 403 }))).rejects.toThrow();
  });
});

it("shows localized guidance instead of internal operation codes",()=>{expect(nativeOperationErrorMessage(new Error("native.worker_off_duty"),"en")).not.toContain("native.");expect(nativeOperationErrorMessage(new Error("native.worker_off_duty"),"es")).toContain("Consulte");expect(nativeOperationErrorMessage(new Error("Worker ended duty"),"en")).toBe("Worker ended duty");});
