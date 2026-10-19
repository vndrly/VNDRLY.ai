import express, {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { decodeSession } from "./session";
const router = Router();
const MAX_COMPLIANCE_JSON_BYTES = 14 * 1024 * 1024;
function refuseBeforeParsing(
  req: Request,
  res: Response,
  status: number,
  code: string,
) {
  let sent = false,
    bytes = 0;
  const send = () => {
    if (sent) return;
    sent = true;
    clearTimeout(timer);
    if (!res.destroyed) res.status(status).json({ code });
  };
  const timer = setTimeout(() => {
    if (!sent) {
      res.setHeader("Connection", "close");
      send();
    }
  }, 15000);
  timer.unref();
  req.on("data", (chunk: Buffer) => {
    if (sent) return;
    bytes += chunk.length;
    if (bytes > MAX_COMPLIANCE_JSON_BYTES) {
      res.setHeader("Connection", "close");
      send();
      req.destroy();
    }
  });
  req.once("end", send);
  req.once("aborted", () => clearTimeout(timer));
  req.once("error", () => clearTimeout(timer));
  // Discard bounded incoming bytes without buffering/parsing private content.
  // Finish the response after the upload stream so clients receive the auth
  // result instead of a reset while their request is still being transmitted.
  if (req.readableEnded) send();
  else req.resume();
}
// Ten MiB of source bytes expands to approximately 13.34 MiB in base64.
// This allowance belongs only to the private compliance upload endpoint.
router.post(
  "/api/fleet/compliance/documents",
  (req, res, next) => {
    const bearer = req.headers.authorization
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim();
    const session = decodeSession(req.cookies?.vndrly_session ?? bearer);
    if (!session?.userId) {
      refuseBeforeParsing(req, res, 401, "auth.unauthenticated");
      return;
    }
    if (
      !["admin", "vendor", "partner", "field_employee"].includes(
        session.role ?? "",
      ) ||
      session.publicDemo ||
      session.realm === "demo"
    ) {
      refuseBeforeParsing(req, res, 403, "fleet.compliance_write_required");
      return;
    }
    // Current session-version, membership and subject permissions are rechecked
    // by the normal API boundary/service after this bounded parser completes.
    next();
  },
  express.json({ limit: MAX_COMPLIANCE_JSON_BYTES }),
);
router.use(
  (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const type = (error as { type?: unknown } | null)?.type;
    if (type === "entity.too.large")
      return res.status(413).json({ code: "fleet.document_too_large" });
    if (type === "entity.parse.failed")
      return res.status(400).json({ code: "fleet.invalid_request" });
    return next(error);
  },
);
export default router;
