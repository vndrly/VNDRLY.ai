import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { AssetServiceError } from "../services/assets";
import { createEquipmentService } from "../services/equipment";

const router = Router(), service = createEquipmentService();
function session(req: Request): SessionPayload {
  const current = getSessionFromRequest(req);
  if (!current?.userId) throw new AssetServiceError("equipment.unauthenticated", 401);
  return current;
}
function error(res: Response, value: unknown) {
  if (value instanceof z.ZodError) return res.status(400).json({ code: "equipment.invalid_request", details: value.issues });
  if (value instanceof AssetServiceError) return res.status(value.status).json({ code: value.code });
  console.error("Equipment request failed", value);
  return res.status(500).json({ code: "equipment.internal_error" });
}
const id = (req: Request) => z.uuid().parse(req.params.id);
router.get("/equipment/options", async (req, res) => { try { res.json(await service.options(session(req))); } catch (e) { error(res, e); } });
router.get("/equipment", async (req, res) => { try { res.json(await service.list(session(req))); } catch (e) { error(res, e); } });
router.post("/equipment", async (req, res) => { try { res.status(201).json(await service.create(session(req), req.body)); } catch (e) { error(res, e); } });
router.get("/equipment/:id", async (req, res) => { try { res.json(await service.detail(session(req), id(req))); } catch (e) { error(res, e); } });
router.patch("/equipment/:id", async (req, res) => { try { res.json(await service.update(session(req), id(req), req.body)); } catch (e) { error(res, e); } });
router.post("/equipment/:id/operations", async (req, res) => { try { res.json(await service.operate(session(req), id(req), req.body)); } catch (e) { error(res, e); } });
export default router;
