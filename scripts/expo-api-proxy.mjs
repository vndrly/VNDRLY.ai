import http from "node:http";

const port = Number(process.env.EXPO_LOCAL_API_PROXY_PORT ?? 8099);
const target = new URL(process.env.EXPO_LOCAL_API_PROXY_TARGET ?? "https://vndrly.ai");

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "origin",
  "referer",
  "transfer-encoding",
  "upgrade",
]);

function setCors(res, origin) {
  res.setHeader("access-control-allow-origin", origin || "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader(
    "access-control-allow-headers",
    "authorization,content-type,accept,x-requested-with",
  );
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("vary", "origin");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function forwardHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const incomingUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!incomingUrl.pathname.startsWith("/api/")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, target);
  try {
    const body =
      req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body,
      redirect: "manual",
    });

    const responseHeaders = {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
    };
    const cacheControl = upstream.headers.get("cache-control");
    if (cacheControl) responseHeaders["cache-control"] = cacheControl;
    res.writeHead(upstream.status, responseHeaders);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.end(bytes);
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "proxy_failed",
        message: error instanceof Error ? error.message : "Upstream request failed",
      }),
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[expo-api-proxy] http://localhost:${port} -> ${target.origin}`);
});

