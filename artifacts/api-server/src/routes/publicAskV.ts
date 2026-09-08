import { Router } from "express";
import { z } from "zod";
import { answerPublicAskV } from "../assistant/public-askv";
const router = Router();
const buckets = new Map<string, { count: number; resetAt: number }>();
router.post("/public/askv", (req, res) => { const now = Date.now(); const key = req.ip || "unknown"; const current = buckets.get(key); const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current; bucket.count += 1; buckets.set(key, bucket); res.setHeader("Cache-Control", "no-store"); if (bucket.count > 12) return res.status(429).json({ code: "public_askv.rate_limited", message: "AskV is receiving too many requests. Please try again shortly." }); const parsed = z.object({ message: z.string().trim().min(1).max(800), locale: z.enum(["en", "es"]).default("en") }).safeParse(req.body); if (!parsed.success) return res.status(400).json({ code: "public_askv.invalid_input", message: "Enter a shorter question about VNDRLY." }); return res.json(answerPublicAskV(parsed.data.message, parsed.data.locale)); });
export default router;
