import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

test("allows the VNDRLY mobile client header during browser preflight", async () => {
  const port = 18_099;
  const child = spawn(process.execPath, ["./scripts/expo-api-proxy.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, EXPO_LOCAL_API_PROXY_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await Promise.race([
      once(child.stdout, "data"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("proxy did not start")), 5_000),
      ),
    ]);

    const response = await fetch(`http://127.0.0.1:${port}/api/healthz`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:8081",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,x-vndrly-client",
      },
    });

    assert.equal(response.status, 204);
    const allowed = response.headers.get("access-control-allow-headers") ?? "";
    assert.match(allowed, /(?:^|,)\s*x-vndrly-client\s*(?:,|$)/i);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
