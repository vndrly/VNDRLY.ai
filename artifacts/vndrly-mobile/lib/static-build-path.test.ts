import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("static mobile bundle entry", () => {
  it("requests Expo Router through Metro's virtual application entry", () => {
    const source = readFileSync(resolve(__dirname, "../scripts/build.js"), "utf8");
    expect(source).toContain("/.expo/.virtual-metro-entry.bundle");
    expect(source).not.toContain("node_modules/expo-router/entry.bundle");
  });

  it("starts an isolated Metro server instead of reusing another workspace's server", () => {
    const source = readFileSync(resolve(__dirname, "../scripts/build.js"), "utf8");
    expect(source).toContain("metroPort = await reserveMetroPort()");
    expect(source).toContain('"--port"');
    expect(source).not.toContain('console.log("Metro already running")');
  });
});
