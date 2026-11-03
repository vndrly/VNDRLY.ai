import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.TRAINING_BENCH_URL ?? "http://localhost:8080";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && base !== "https://vndrly.ai") throw Error("Unsupported profiling target");
const username = process.env.TRAINING_BENCH_USER, password = process.env.TRAINING_BENCH_PASSWORD;
if (!username || !password) throw Error("Supply existing account credentials through benchmark environment variables");
const output = process.env.TRAINING_BENCH_OUTPUT ?? ".local/training-api-profile";
await mkdir(output, { recursive: true });
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(30_000) });
if (!login.ok) throw Error(`Login HTTP ${login.status}`);
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const results = [];
for (let run = 0; run < Number(process.env.TRAINING_BENCH_REPEATS ?? 3); run++) {
  for (const method of run % 2 ? ["server", "baseline"] : ["baseline", "server"]) {
    const rows = await Promise.all(["progress", "safety-summary", "team-progress"].map(async endpoint => {
      const started = performance.now();
      try {
        const response = await fetch(`${base}/api/work-hub/repository/${endpoint}`, { headers: { cookie, "x-vndrly-performance-profile": "1", "x-vndrly-progress-method": method }, signal: AbortSignal.timeout(30_000) });
        const body = await response.text();
        return { run, method, endpoint, status: response.status, ms: Math.round(performance.now() - started), serverTiming: response.headers.get("server-timing"), sha256: createHash("sha256").update(body).digest("hex"), bytes: Buffer.byteLength(body) };
      } catch (error) { return { run, method, endpoint, ms: Math.round(performance.now() - started), error: error.message }; }
    }));
    results.push(...rows);
    for (const row of rows) console.log(JSON.stringify(row));
    await writeFile(`${output}/results.json`, JSON.stringify({ base, measuredAt: new Date().toISOString(), results }, null, 2));
  }
}
