import fs from "node:fs/promises";
import path from "node:path";
import { readPlateFromImage } from "../src/lib/plate-ocr";
import { readWithPlateRecognizer } from "../src/lib/plate-recognizer";

// Explicit invocation only: sends the manifest's photographs to the chosen provider.
// No database access. Never logs photos, plate values, provider payloads or credentials.
type Sample = { id: string; file: string; plate: string | null; state: string | null; condition: string };
const [manifestPath, provider, predictionsPath] = process.argv.slice(2);
if (!manifestPath || !["openai", "plate-recognizer", "predictions"].includes(provider))
  throw new Error("Usage: tsx scripts/benchmark-gate-recognition.ts manifest.json openai|plate-recognizer|predictions [predictions.json]");
const samples: Sample[] = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (!Array.isArray(samples) || !samples.length || samples.length > 1000 || new Set(samples.map(s => s.id)).size !== samples.length)
  throw new Error("Provide 1–1000 labeled samples with unique IDs.");
const predictions: Record<string, { plate: string | null; state: string | null; elapsedMs?: number }> = provider === "predictions"
  ? JSON.parse(await fs.readFile(predictionsPath, "utf8")) : {};
const normalize = (v: string | null) => v?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
const results: Array<{ condition: string; exact: boolean; wrongRead: boolean; missed: boolean; stateExact: boolean; elapsedMs: number; failed: boolean }> = [];
for (const sample of samples) {
  if (!sample.id || !sample.condition || !(sample.plate === null || typeof sample.plate === "string") || !(sample.state === null || typeof sample.state === "string")) throw new Error("Invalid benchmark label.");
  const started = Date.now();
  try {
    let result = predictions[sample.id];
    if (provider !== "predictions") {
      const file = path.resolve(path.dirname(manifestPath), sample.file);
      const mimeType = ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" } as Record<string, string>)[path.extname(file).toLowerCase()];
      if (!mimeType) throw new Error("Unsupported image format");
      const input = { imageBase64: (await fs.readFile(file)).toString("base64"), mimeType };
      result = provider === "openai" ? await readPlateFromImage(input) : await readWithPlateRecognizer(input);
    }
    if (!result) throw new Error("Missing prediction");
    results.push({ condition: sample.condition, exact: normalize(result.plate) === normalize(sample.plate),
      wrongRead: Boolean(result.plate && normalize(result.plate) !== normalize(sample.plate)),
      missed: Boolean(sample.plate && !result.plate), stateExact: normalize(result.state) === normalize(sample.state),
      elapsedMs: result.elapsedMs ?? Date.now() - started, failed: false });
  } catch { results.push({ condition: sample.condition, exact: false, wrongRead: false, missed: Boolean(sample.plate), stateExact: false, elapsedMs: Date.now() - started, failed: true }); }
}
const summarize = (rows: typeof results) => {
  const times = rows.map(r => r.elapsedMs).sort((a, b) => a - b);
  return { samples: rows.length, exactPlateRate: rows.filter(r => r.exact).length / rows.length,
    wrongReads: rows.filter(r => r.wrongRead).length, unreadable: rows.filter(r => r.missed).length,
    failures: rows.filter(r => r.failed).length, exactStateRate: rows.filter(r => r.stateExact).length / rows.length,
    p95Ms: times[Math.max(0, Math.ceil(times.length * .95) - 1)] };
};
console.log(JSON.stringify({ provider, observedAt: new Date().toISOString(), overall: summarize(results),
  conditions: Object.fromEntries([...new Set(results.map(r => r.condition))].map(c => [c, summarize(results.filter(r => r.condition === c))])) }, null, 2));
