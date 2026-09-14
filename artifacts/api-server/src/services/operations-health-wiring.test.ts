import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("operations health lifecycle wiring", () => {
  it("mounts the company-admin health endpoint", () => {
    const routes = source("src/routes/index.ts");
    expect(routes).toContain('import implementationAHealthRouter from "./implementationAHealth"');
    expect(routes).toContain("router.use(implementationAHealthRouter)");
  });

  it("starts and stops the raw-media retention worker with the API", () => {
    const server = source("src/index.ts");
    expect(server).toContain("startImplementationARetentionWorker()");
    expect(server).toContain("stopImplementationARetentionWorker()");
  });

  it("keeps transcript replay available after raw audio expires", () => {
    const replay = source("src/routes/workHubMeetingReplay.ts");
    expect(replay).toContain("rawMediaAvailable: !retention?.rawMediaDeletedAt");
    expect(replay).toContain("Replay audio expired; the transcript and summary remain available");
  });
});
