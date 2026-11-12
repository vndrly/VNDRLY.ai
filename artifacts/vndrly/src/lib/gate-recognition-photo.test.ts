import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeGatePhoto } from "./gate-recognition-photo";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("gate photo normalization", () => {
  it("normalizes orientation and dimensions while preserving character detail", async () => {
    const bitmap = { width: 4000, height: 2000, close: vi.fn() };
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) { callback(new Blob(["jpeg"], { type: "image/jpeg" })); });
    const file = new File(["original"], "photo.png", { type: "image/png" });
    const result = await normalizeGatePhoto(file);
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2560, 1280);
    expect(result.type).toBe("image/jpeg");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it("rejects tiny photos and releases decoded image resources", async () => {
    const bitmap = { width: 50, height: 30, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    await expect(normalizeGatePhoto(new File(["tiny"], "tiny.jpg", { type: "image/jpeg" }))).rejects.toThrow("clearer");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
