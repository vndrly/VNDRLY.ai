import { describe, expect, it, vi } from "vitest";
import { readPlateFromImage } from "./plate-ocr";
import { readWithPlateRecognizer } from "./plate-recognizer";
import { recognitionRequest } from "./gate-recognition-transport";

const image = { imageBase64: Buffer.alloc(64, 1).toString("base64"), mimeType: "image/jpeg", apiKey: "test-only" };
const response = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }] }));
describe("gate recognition production boundary", () => {
  it("never turns provider narration into a plate", async () => {
    await expect(readPlateFromImage({ ...image, fetchImpl: vi.fn(async () => response("Vehicle cannot be read")) })).rejects.toThrow("invalid result");
  });
  it("accepts an uploaded photo above the previous 3 MB limit and forces review", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ plate: "ABC123", state: "OK", plateConfidence: .99, stateConfidence: .99 }));
    const result = await readPlateFromImage({ ...image, imageBase64: Buffer.alloc(4 * 1024 * 1024).toString("base64"), fetchImpl: fetcher });
    expect(result).toMatchObject({ plate: "ABC123", reviewRequired: true, provider: "openai" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).response_format).toEqual({ type: "json_object" });
  });
  it("withholds a plate when multiple vehicles are ambiguous", async () => {
    const result = await readPlateFromImage({ ...image, mode: "vehicle", fetchImpl: vi.fn(async () => response({ plate: "ABC123", quality: "multiple_vehicles", appearance: { color: "white" } })) });
    expect(result).toMatchObject({ plate: null, appearance: null, quality: "multiple_vehicles" });
  });
  it("returns bounded vehicle attributes without treating them as an identity", async () => {
    const result = await readPlateFromImage({ ...image, mode: "vehicle", fetchImpl: vi.fn(async () => response({ plate: null, appearance: { color: "white", make: "Ford", model: null, bodyType: "pickup", markings: ["unit 12", 42] } })) });
    expect(result.appearance).toEqual({ color: "white", make: "Ford", model: null, bodyType: "pickup", markings: ["unit 12"] });
    expect(result.reviewRequired).toBe(true);
  });
  it("rejects unsupported image types before calling a provider", async () => {
    const fetcher = vi.fn();
    await expect(readPlateFromImage({ ...image, mimeType: "image/heic", fetchImpl: fetcher })).rejects.toThrow("JPEG");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retries a transient response only once, never authentication errors", async () => {
    const retry = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response("{}"));
    await recognitionRequest(retry, "https://example.invalid", {});
    expect(retry).toHaveBeenCalledTimes(2);
    const denied = vi.fn(async () => new Response(null, { status: 401 }));
    await expect(recognitionRequest(denied, "https://example.invalid", {})).rejects.toThrow("unavailable");
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it("aborts a stalled provider request at the shared deadline", async () => {
    const stalled: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    await expect(recognitionRequest(stalled, "https://example.invalid", {}, 10)).rejects.toThrow("timed out");
  });
  it("normalizes specialist candidates and rejects a multiple-plate identity", async () => {
    const result = await readWithPlateRecognizer({ ...image, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ results: [{ plate: "abc123", score: .9, region: { code: "us-ok", score: .9 }, candidates: [{ plate: "abc123" }, { plate: "abc128" }] }] }))) });
    expect(result).toMatchObject({ plate: "ABC123", state: "OK", alternatives: ["ABC123", "ABC128"], reviewRequired: true });
    const ambiguous = await readWithPlateRecognizer({ ...image, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ results: [{ plate: "abc123" }, { plate: "def456" }] }))) });
    expect(ambiguous).toMatchObject({ plate: null, quality: "multiple_vehicles" });
  });
});
