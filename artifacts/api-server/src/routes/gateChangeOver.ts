import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, pool, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getSessionFromRequest, type SessionPayload } from "../lib/session";
import { createRateLimiter } from "../lib/rate-limit-factory";
import { resolveContext, buildSessionCookie } from "./auth";
import {
  issueHandoffProof,
  readHandoffProof,
} from "../services/gate-change-over-auth";
import { summarizeShiftFacts } from "../services/gate-change-over-summary";
import {
  ChangeOverError,
  listChangeOverSites,
  listChangeOverStations,
  addChangeOverStation,
  getChangeOverState,
  startGateShift,
  prepareGateHandoff,
  cancelGateHandoff,
  recoverGateShift,
  actOnShiftItem,
  requireChangeOverAccess,
  transferGateShift,
  getShiftNotes,
} from "../services/gate-change-over";

const router = Router();
const uuid = z.string().uuid();
const siteId = z.coerce.number().int().positive();
const text = z.string().trim().min(1).max(2000);
const reads = createRateLimiter({
  resourcePrefix: "CHANGE_OVER",
  errorCode: "change_over.rate_limited",
  logKind: "change_over.rate_limit",
  defaultMax: 60,
  defaultWindowMs: 60000,
  message: "Please wait before trying again",
});
const authentication = createRateLimiter({
  resourcePrefix: "CHANGE_OVER_AUTH",
  errorCode: "change_over.auth_rate_limited",
  logKind: "change_over.auth_limit",
  defaultMax: 5,
  defaultWindowMs: 300000,
  message: "Too many sign-in attempts. Wait five minutes.",
});

router.use("/gate-change-over", async (req, res, next) => {
  const session = getSessionFromRequest(req);
  res.setHeader("Cache-Control", "private, no-store");
  if (!session?.userId) {
    res.status(401).json({ message: "Sign in required" });
    return;
  }
  if (!(await reads.enforce(req, res, { ...session, userId: session.userId })))
    return;
  next();
});
const sessionFor = (req: Parameters<typeof getSessionFromRequest>[0]) =>
  getSessionFromRequest(req)!;
router.get("/gate-change-over/sites", async (req, res) => {
  res.json({ sites: await listChangeOverSites(sessionFor(req)) });
});
router.get("/gate-change-over/stations", async (req, res) => {
  res.json({
    stations: await listChangeOverStations(
      sessionFor(req),
      siteId.parse(req.query.siteId),
    ),
  });
});
router.post("/gate-change-over/stations", async (req, res) => {
  const b = z.object({ siteId, name: text.max(80) }).parse(req.body);
  res.json(await addChangeOverStation(sessionFor(req), b.siteId, b.name));
});
router.get("/gate-change-over/:stationId/state", async (req, res) => {
  res.json(
    await getChangeOverState(sessionFor(req), uuid.parse(req.params.stationId)),
  );
});
router.get("/gate-change-over/:stationId/notes", async (req, res) => {
  const query = z
    .object({
      days: z.coerce.number().int().min(1).max(3650).optional(),
      before: z.string().datetime().optional(),
      search: z.string().max(200).optional(),
    })
    .parse(req.query);
  res.json(
    await getShiftNotes(sessionFor(req), {
      ...query,
      stationId: uuid.parse(req.params.stationId),
    }),
  );
});
router.post("/gate-change-over/:stationId/start", async (req, res) => {
  res.json(
    await startGateShift(sessionFor(req), uuid.parse(req.params.stationId)),
  );
});
router.post("/gate-change-over/:stationId/prepare", async (req, res) => {
  const b = z
    .object({ notes: z.string().max(8000).default("") })
    .parse(req.body);
  res.json(
    await prepareGateHandoff(
      sessionFor(req),
      uuid.parse(req.params.stationId),
      b.notes,
      summarizeShiftFacts,
    ),
  );
});
router.post("/gate-change-over/:stationId/cancel", async (req, res) => {
  res.json(
    await cancelGateHandoff(
      sessionFor(req),
      uuid.parse(req.params.stationId),
      z.object({ reason: text }).parse(req.body).reason,
    ),
  );
});
router.post("/gate-change-over/:stationId/items", async (req, res) => {
  const b = z
    .object({ itemId: uuid, kind: z.enum(["open", "resolve", "reopen"]), text })
    .parse(req.body);
  res.json(
    await actOnShiftItem(
      sessionFor(req),
      uuid.parse(req.params.stationId),
      b.itemId,
      b.kind,
      b.text,
    ),
  );
});
router.post("/gate-change-over/:stationId/recover", async (req, res) => {
  const b = z
    .object({
      expectedShiftId: uuid,
      reason: text,
      acknowledged: z.literal(true),
    })
    .parse(req.body);
  res.json(
    await recoverGateShift(
      sessionFor(req),
      uuid.parse(req.params.stationId),
      b.expectedShiftId,
      b.reason,
    ),
  );
});

router.post("/gate-change-over/:stationId/authenticate", async (req, res) => {
  const outgoing = sessionFor(req);
  if (
    !(await authentication.enforce(req, res, {
      ...outgoing,
      userId: outgoing.userId!,
    }))
  )
    return;
  const stationId = uuid.parse(req.params.stationId);
  const b = z
    .object({
      username: z.string().trim().min(1).max(254),
      password: z.string().min(1).max(200),
      preparationId: uuid,
      revision: z.string().length(64),
    })
    .parse(req.body);
  const state = await getChangeOverState(outgoing, stationId);
  if (
    !state.preparation ||
    state.shift?.operator_id !== outgoing.userId ||
    state.preparation.id !== b.preparationId ||
    state.stale ||
    state.snapshot?.revision !== b.revision
  )
    throw new ChangeOverError(
      409,
      "change_over.stale",
      "Refresh the handoff before authenticating",
    );
  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      sql`lower(coalesce(${usersTable.email}, ${usersTable.username}))=${b.username.toLowerCase()}`,
    )
    .limit(1);
  const valid =
    user &&
    !user.suspendedAt &&
    (await bcrypt.compare(b.password, user.passwordHash));
  if (!valid) {
    res
      .status(401)
      .json({
        code: "change_over.invalid_credentials",
        message: "Invalid incoming username or password",
      });
    return;
  }
  if (user.id === outgoing.userId || user.mustChangePassword)
    throw new ChangeOverError(
      403,
      "change_over.incoming_unavailable",
      "Use a different gatekeeper with a completed password setup",
    );
  const ctx = await resolveContext(user);
  const incoming: SessionPayload = {
    ...ctx,
    userId: user.id,
    sv: user.sessionVersion,
    displayName: user.displayName,
  };
  await requireChangeOverAccess(pool, incoming, state.station.site_id);
  res.json({
    proof: issueHandoffProof({
      outgoingId: outgoing.userId!,
      outgoingVersion: outgoing.sv!,
      incomingId: user.id,
      incomingVersion: user.sessionVersion,
      membershipId: ctx.activeMembershipId,
      stationId,
      preparationId: b.preparationId,
      revision: b.revision,
    }),
    incoming: { id: user.id, displayName: user.displayName },
    expiresInSeconds: 300,
  });
});
router.post("/gate-change-over/:stationId/transfer", async (req, res) => {
  const outgoing = sessionFor(req);
  const stationId = uuid.parse(req.params.stationId);
  const b = z
    .object({
      proof: z.string().max(4096),
      operationId: uuid,
      acknowledged: z.literal(true),
    })
    .parse(req.body);
  const proof = readHandoffProof(b.proof);
  if (
    !proof ||
    proof.outgoingId !== outgoing.userId ||
    proof.outgoingVersion !== outgoing.sv ||
    proof.stationId !== stationId
  )
    throw new ChangeOverError(
      401,
      "change_over.proof_expired",
      "Authenticate the incoming gatekeeper again",
    );
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, proof.incomingId));
  if (
    !user ||
    user.suspendedAt ||
    user.sessionVersion !== proof.incomingVersion ||
    user.mustChangePassword
  )
    throw new ChangeOverError(
      403,
      "change_over.incoming_changed",
      "Incoming account changed; authenticate again",
    );
  const ctx = await resolveContext({
    ...user,
    activeMembershipId: proof.membershipId,
  });
  if (ctx.activeMembershipId !== proof.membershipId)
    throw new ChangeOverError(
      403,
      "change_over.incoming_changed",
      "Incoming membership changed",
    );
  const incoming: SessionPayload = {
    ...ctx,
    userId: user.id,
    sv: user.sessionVersion,
    displayName: user.displayName,
  };
  const handover = await transferGateShift(outgoing, incoming, {
    stationId,
    preparationId: proof.preparationId,
    revision: proof.revision,
    operationId: b.operationId,
    acknowledged: true,
  });
  const token = buildSessionCookie(user, ctx);
  res.cookie("vndrly_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
    maxAge: 86400000,
  });
  res.json({
    handover,
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      ...ctx,
      preferredLanguage: user.preferredLanguage,
      requiresContextChoice: false,
    },
  });
});
router.use(
  "/gate-change-over",
  (
    error: unknown,
    _req: unknown,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    if (error instanceof ChangeOverError) {
      res
        .status(error.status)
        .json({ code: error.code, message: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({
          code: "change_over.invalid_input",
          message: "Check the requested fields",
        });
      return;
    }
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      ["55P03", "40001", "40P01"].includes(String(error.code))
    ) {
      res
        .status(409)
        .json({
          code: "change_over.busy",
          message:
            "Gate activity is busy. Refresh and try again; no shift was transferred.",
        });
      return;
    }
    next(error);
  },
);
export default router;
