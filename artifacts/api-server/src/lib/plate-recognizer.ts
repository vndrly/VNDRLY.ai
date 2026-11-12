import { normalizePlateState, type GateRecognition } from "@workspace/plate-state";
import { PlateOcrFailedError, PlateOcrUnavailableError } from "./plate-ocr";
import { recognitionRequest } from "./gate-recognition-transport";

/** Opt-in provider adapter. Scores remain uncalibrated and always require review. */
export async function readWithPlateRecognizer(input: {
  imageBase64: string; mimeType: string; apiKey?: string; fetchImpl?: typeof fetch;
}): Promise<GateRecognition> {
  const token = (input.apiKey ?? process.env.PLATE_RECOGNIZER_API_TOKEN ?? "").trim();
  if (!token) throw new PlateOcrUnavailableError("Plate Recognizer is not configured.");
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(input.mimeType))
    throw new PlateOcrFailedError("Use a JPEG, PNG or WebP photo.");
  const bytes = Buffer.from(input.imageBase64, "base64");
  if (bytes.length < 32 || bytes.length > 8 * 1024 * 1024) throw new PlateOcrFailedError("Photo must be smaller than 8 MB.");
  const body = new FormData();
  body.append("upload", new Blob([new Uint8Array(bytes)], { type: input.mimeType }), "gate-photo");
  const started = Date.now();
  const raw = await recognitionRequest(input.fetchImpl ?? fetch, "https://api.platerecognizer.com/v1/plate-reader/", {
    method: "POST", headers: { Authorization: `Token ${token}` }, body,
  }) as { results?: Array<{ plate?: string; score?: number; region?: { code?: string; score?: number }; candidates?: Array<{ plate?: string }> }> };
  if (!Array.isArray(raw?.results)) throw new PlateOcrFailedError("Recognition returned an invalid result.");
  const result = raw.results.length === 1 ? raw.results[0] : null;
  const plate = (v: unknown) => typeof v === "string" && /^[a-z0-9-]{1,12}$/i.test(v) ? v.toUpperCase() : null;
  const score = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
  return {
    plate: plate(result?.plate), state: normalizePlateState(result?.region?.code?.replace(/^us-/i, "")),
    plateConfidence: score(result?.score), stateConfidence: score(result?.region?.score),
    alternatives: [...new Set((result?.candidates ?? []).map(c => plate(c.plate)).filter((v): v is string => v !== null))].slice(0, 5),
    quality: raw.results.length > 1 ? "multiple_vehicles" : result ? "readable" : "unreadable",
    provider: "plate-recognizer", modelVersion: "snapshot-cloud", elapsedMs: Date.now() - started, reviewRequired: true,
  };
}
