import { Router } from "express";
import { z } from "zod/v4";
import { getSessionFromRequest } from "../lib/session";
import { createWorkHubAvailabilityService } from "../services/work-hub-availability";
import { FleetError } from "../services/fleet-repository";
const router = Router(),
  service = createWorkHubAvailabilityService();
for (const [method, path, action] of [
  ["get", "/work-hub/availability", "read"],
  ["post", "/work-hub/availability", "save"],
  ["get", "/work-hub/availability/operations/:operationId", "operation"],
] as const)
  router[method](path, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const session = getSessionFromRequest(req);
    if (!session)
      return res.status(401).json({ code: "auth.not_authenticated" });
    try {
      return res.json(
        action === "read"
          ? await service.read(session)
          : action === "save"
            ? await service.save(session, req.body)
            : await service.readOperation(
                session,
                z
                  .uuid()
                  .parse((req.params as Record<string, string>).operationId),
              ),
      );
    } catch (error) {
      if (error instanceof z.ZodError)
        return res.status(400).json({ code: "work_hub.invalid_operation" });
      if (error instanceof FleetError)
        return res
          .status(error.status)
          .json({
            code: error.code.startsWith("work_hub.")
              ? error.code
              : error.status === 403
                ? "work_hub.forbidden"
                : "work_hub.version_conflict",
          });
      req.log?.error({ err: error }, "Own availability operation failed");
      return res.status(503).json({ code: "work_hub.invalid_operation" });
    }
  });
export default router;
