import { Router } from "express";
import { publicMapConfig } from "../lib/public-map-config";

const router = Router();
router.get("/public-config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(publicMapConfig(process.env));
});
export default router;
