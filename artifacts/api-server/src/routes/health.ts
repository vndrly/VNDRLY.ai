import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sendResponse } from "../lib/typed-response";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  sendResponse(res, HealthCheckResponse, { status: "ok" });
});

export default router;
