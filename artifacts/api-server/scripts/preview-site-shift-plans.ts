/** Local coverage API. Read-only by default; explicit write mode has an origin/path allowlist. No app startup workers. */
import "../../../scripts/load-env-local.mjs";

import { createHmac, randomBytes } from "node:crypto";
import express from "express";
import {z} from "zod/v4";

// Ephemeral request-adapter key; never persisted or used for browser authentication.
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const writesEnabled=process.env.VNDRLY_COVERAGE_WRITES === "1";
process.env.LOCAL_COVERAGE_READ_ONLY = writesEnabled ? "0" : "1";
const databaseUrl = new URL(process.env.DATABASE_URL!);
if(!writesEnabled) databaseUrl.searchParams.set("options", "-c default_transaction_read_only=on");
process.env.DATABASE_URL = databaseUrl.toString();
const { default: routes } = await import("../src/routes/workHubSiteShiftPlans");
const { default: nativeRoutes } = await import("../src/routes/nativeOperations");
const { default: channelRoutes } = await import("../src/routes/workHubChannels");
const { default: fileRoutes } = await import("../src/routes/workHubFileLibrary");
const { default: receiptRoutes } = await import("../src/routes/workHubReceipts");
const { default: storageRoutes } = await import("../src/routes/storage");
// Local reservations must use this process's signed-upload validator and storage.
process.env.PUBLIC_API_BASE = "http://127.0.0.1:5173";
const { pool } = await import("@workspace/db");
// Transaction poolers may ignore connection startup options. Enforce read-only
// on every actual query/connection, rather than trusting the URL option.
if(!writesEnabled) pool.query = (async (...args: any[]) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    return await (client.query as any)(...args);
  } catch (error) { console.log("Coverage query error", (error as { code?: string }).code ?? "unknown"); throw error;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}) as typeof pool.query;
const mode = await pool.query("show transaction_read_only");
if (!writesEnabled && mode.rows[0].transaction_read_only !== "on") throw Error("Read-only database mode required");

const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true, readOnly: !writesEnabled }));
app.use("/api", (req, res, next) => {
  if (writesEnabled && req.method === "PUT" && /^\/storage\/upload\/[\da-f-]+$/.test(req.path)) return storageRoutes(req, res, next);
  next();
});
app.use(express.json({limit:"2mb"}));
app.use(async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.on("finish", () => console.log("Coverage request", req.path, res.statusCode));
  if(req.method !== "GET") {
    const coverageWrite = req.method === "POST" && /^\/api\/work-hub\/site-shift-plans\/(?:coverage-resolution|request-coverage|acknowledge-coverage|decide-shift-off)$/.test(req.path);
    const pickupWrite = req.method === "PUT" && req.path === "/api/native-operations/pickup-shifts";
    const messageRead = req.method === "PUT" && /^\/api\/work-hub\/channels\/[\da-f-]+\/messages\/[\da-f-]+\/read$/.test(req.path);
    const participantWrite = req.method === "PATCH" && /^\/api\/work-hub\/channels\/[\da-f-]+\/chat-participants$/.test(req.path);
    const channelWrite = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) && /^\/api\/work-hub\/channels(?:\/[\da-f-]+(?:\/(?:members|read-cursor|notes|messages)(?:\/[\da-f-]+(?:\/reactions)?)?)?)?$/.test(req.path);
    const fileWrite = req.method === "POST" && /^\/api\/work-hub\/file-library\/[a-z-]+$/.test(req.path);
    const receiptWrite = ["POST", "PATCH"].includes(req.method) && /^\/api\/work-hub\/channels\/[\da-f-]+\/receipts(?:\/(?:ocr|[\da-f-]+))?$/.test(req.path);
    if(!writesEnabled || !(coverageWrite || pickupWrite || messageRead || participantWrite || channelWrite || (req.method === "POST" && req.path === "/api/work-hub/channels/start-chat") || fileWrite || receiptWrite)) return res.status(405).json({message:"This local operation is not enabled"});
    if(!["http://127.0.0.1:5173","http://localhost:5173"].includes(req.headers.origin??"") || !req.is("application/json")) return res.sendStatus(403);
  } else if (req.path !== "/api/native-operations/pickup-shifts" && !/^\/api\/work-hub\/(?:channels|file-library)(?:\/.*)?$/.test(req.path) && !/^\/api\/work-hub\/site-shift-plans(?:\/(?:coverage-facts|coverage-candidates|my-coverage|my-coverage-acknowledgments|\d+(?:\/schedule)?))?$/.test(req.path)) return res.sendStatus(404);
  if (!req.headers.cookie) return res.sendStatus(401);
  try {
    // Validate the existing session with its issuer, including revocation/context.
    // Never trust caller-provided user IDs or unsigned session payloads.
    const auth = await fetch("https://vndrly.ai/api/auth/me", { headers: { cookie: req.headers.cookie }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!auth.ok) return res.sendStatus(401);
    const session = z.object({userId:z.number().int().positive(),publicDemo:z.boolean().optional(),realm:z.string().optional()}).passthrough().parse(await auth.json());
    if (!session.userId || session.publicDemo || (session.realm && session.realm !== "production")) return res.sendStatus(403);
    // Adapt the verified identity to the unchanged route's local session decoder.
    // This token remains inside this request; it is never returned or stored.
    const payload = Buffer.from(JSON.stringify({ ...session, exp: Math.floor(Date.now() / 1000) + 30 })).toString("base64");
    const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("hex");
    (req as typeof req & { cookies: Record<string, string> }).cookies = { vndrly_session: `${payload}.${signature}` };
    return next();
  } catch { return res.status(503).json({ message: "Session verification is temporarily unavailable" }); }
});
app.use("/api", routes);
app.use("/api", nativeRoutes);
app.use("/api", channelRoutes);
app.use("/api", fileRoutes);
app.use("/api", receiptRoutes);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ message: "Local coverage preview unavailable" }));
app.listen(8098, "127.0.0.1", () => console.log(`Coverage API listening on 127.0.0.1:8098 (${writesEnabled?"reviewed coverage saves enabled":"read-only"})`));


