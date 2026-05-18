import { Router, type IRouter } from "express";
import { eq, and, isNull, inArray } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  employeeCertificationsTable,
  fieldEmployeesTable,
  vendorsTable,
} from "@workspace/db";
import {
  CreateEmployeeCertificationBody,
  UpdateEmployeeCertificationBody,
} from "@workspace/api-zod";

import { SESSION_SECRET } from "../lib/session";

import { sendValidationFailed } from "../lib/validation-error";
const COOKIE_NAME = "vndrly_session";

function isSafeDocumentUrl(url: string): boolean {
  return url.startsWith("/api/storage/") || url.startsWith("/objects/");
}
type Session = {
  userId: number;
  role: string;
  vendorId: number | null;
  partnerId: number | null;
};

function getSession(req: any): Session | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie) return null;
  const lastDot = cookie.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = cookie.slice(0, lastDot);
  const sig = cookie.slice(lastDot + 1);
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))
    )
      return null;
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (!obj || typeof obj.exp !== "number" || obj.exp < now) return null;
    return obj;
  } catch {
    return null;
  }
}

const FIELD_ROLES = ["field", "both", "foreman"];

async function loadEmployee(id: number) {
  const [e] = await db
    .select({
      id: fieldEmployeesTable.id,
      vendorId: fieldEmployeesTable.vendorId,
    })
    .from(fieldEmployeesTable)
    .where(
      and(
        eq(fieldEmployeesTable.id, id),
        inArray(fieldEmployeesTable.vendorRole, FIELD_ROLES),
        isNull(fieldEmployeesTable.deletedAt),
      ),
    );
  return e || null;
}

// Read access: admin, vendor of the employee, or the employee themselves.
async function ensureCertRead(req: any, res: any, employeeId: number) {
  const employee = await loadEmployee(employeeId);
  if (!employee) {
    res.status(404).json({ error: "Field employee not found", code: "field_employee.not_found" });
    return null;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return null;
  }
  if (session.role === "admin") return employee;
  if (session.role === "vendor" && session.vendorId === employee.vendorId)
    return employee;
  if (session.role === "field_employee") {
    const [me] = await db
      .select({ id: fieldEmployeesTable.id })
      .from(fieldEmployeesTable)
      .where(
        and(
          eq(fieldEmployeesTable.userId, session.userId),
          isNull(fieldEmployeesTable.deletedAt),
        ),
      );
    if (me && me.id === employee.id) return employee;
  }
  res.status(403).json({ error: "Not allowed", code: "auth.not_allowed" });
  return null;
}

// Mutate: admin or vendor of employee.
async function ensureCertMutate(req: any, res: any, employeeId: number) {
  const employee = await loadEmployee(employeeId);
  if (!employee) {
    res.status(404).json({ error: "Field employee not found", code: "field_employee.not_found" });
    return null;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated", code: "auth.not_authenticated" });
    return null;
  }
  if (session.role === "admin") return { employee, session };
  if (session.role === "vendor" && session.vendorId === employee.vendorId)
    return { employee, session };
  res.status(403).json({ error: "Not allowed", code: "auth.not_allowed" });
  return null;
}

const router: IRouter = Router();

router.get(
  "/field-employees/:employeeId/certifications",
  async (req, res): Promise<void> => {
    const employeeId = Number(req.params.employeeId);
    if (!Number.isFinite(employeeId)) {
      res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
      return;
    }
    const ok = await ensureCertRead(req, res, employeeId);
    if (!ok) return;
    const rows = await db
      .select()
      .from(employeeCertificationsTable)
      .where(
        and(
          eq(employeeCertificationsTable.employeeId, employeeId),
          isNull(employeeCertificationsTable.deletedAt),
        ),
      )
      .orderBy(employeeCertificationsTable.expirationDate);
    res.json(rows);
  },
);

router.post(
  "/field-employees/:employeeId/certifications",
  async (req, res): Promise<void> => {
    const employeeId = Number(req.params.employeeId);
    if (!Number.isFinite(employeeId)) {
      res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
      return;
    }
    const auth = await ensureCertMutate(req, res, employeeId);
    if (!auth) return;
    const parsed = CreateEmployeeCertificationBody.safeParse(req.body);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
      return;
    }
    if (parsed.data.documentUrl != null && !isSafeDocumentUrl(parsed.data.documentUrl)) {
      res.status(400).json({ error: "documentUrl must be an internal storage path", code: "certification.invalid_document_url" });
      return;
    }
    const [row] = await db
      .insert(employeeCertificationsTable)
      .values({ ...parsed.data, employeeId })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/field-employees/:employeeId/certifications/:certId",
  async (req, res): Promise<void> => {
    const employeeId = Number(req.params.employeeId);
    const certId = Number(req.params.certId);
    if (!Number.isFinite(employeeId) || !Number.isFinite(certId)) {
      res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
      return;
    }
    const auth = await ensureCertMutate(req, res, employeeId);
    if (!auth) return;
    const parsed = UpdateEmployeeCertificationBody.safeParse(req.body);
    if (!parsed.success) {
      sendValidationFailed(res, parsed.error, { code: "validation.invalid_input" });
      return;
    }
    if (parsed.data.documentUrl != null && !isSafeDocumentUrl(parsed.data.documentUrl)) {
      res.status(400).json({ error: "documentUrl must be an internal storage path", code: "certification.invalid_document_url" });
      return;
    }
    const [row] = await db
      .update(employeeCertificationsTable)
      .set(parsed.data)
      .where(
        and(
          eq(employeeCertificationsTable.id, certId),
          eq(employeeCertificationsTable.employeeId, employeeId),
          isNull(employeeCertificationsTable.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Certification not found", code: "certification.not_found" });
      return;
    }
    res.json(row);
  },
);

router.delete(
  "/field-employees/:employeeId/certifications/:certId",
  async (req, res): Promise<void> => {
    const employeeId = Number(req.params.employeeId);
    const certId = Number(req.params.certId);
    if (!Number.isFinite(employeeId) || !Number.isFinite(certId)) {
      res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
      return;
    }
    const auth = await ensureCertMutate(req, res, employeeId);
    if (!auth) return;
    const [row] = await db
      .update(employeeCertificationsTable)
      .set({
        deletedAt: new Date(),
        deletedBy: `${auth.session.role}:${auth.session.userId}`,
      })
      .where(
        and(
          eq(employeeCertificationsTable.id, certId),
          eq(employeeCertificationsTable.employeeId, employeeId),
          isNull(employeeCertificationsTable.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "Certification not found", code: "certification.not_found" });
      return;
    }
    res.status(204).send();
  },
);

// ── Compliance verification token ──
//
// Token format: base64(`${employeeId}.${issuedAtSeconds}`).hexHmac
// Tokens are valid for 24h after issuance to allow inspectors to scan even
// when the employee's phone is offline. The signing secret is the same
// SESSION_SECRET used elsewhere — a separate rotating secret is overkill for
// this read-only public summary.
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

function signComplianceToken(employeeId: number): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(`${employeeId}.${issuedAt}`, "utf-8").toString(
    "base64",
  );
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${sig}`;
}

function verifyComplianceToken(token: string): { employeeId: number } | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
  try {
    if (
      !crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))
    )
      return null;
  } catch {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64").toString("utf-8");
  } catch {
    return null;
  }
  const [empStr, issuedStr] = decoded.split(".");
  const employeeId = Number(empStr);
  const issuedAt = Number(issuedStr);
  if (!Number.isFinite(employeeId) || !Number.isFinite(issuedAt)) return null;
  if (Date.now() / 1000 - issuedAt > TOKEN_TTL_SECONDS) return null;
  return { employeeId };
}

router.get(
  "/field-employees/:employeeId/compliance-token",
  async (req, res): Promise<void> => {
    const employeeId = Number(req.params.employeeId);
    if (!Number.isFinite(employeeId)) {
      res.status(400).json({ error: "Invalid id", code: "validation.invalid_id" });
      return;
    }
    const ok = await ensureCertRead(req, res, employeeId);
    if (!ok) return;
    const token = signComplianceToken(employeeId);
    const origin = `${req.protocol}://${req.get("host")}`;
    // The QR encodes the public web page (rendered by the vndrly artifact),
    // not the raw JSON endpoint. Inspectors who scan the QR land on a
    // branded, mobile-friendly verification view that calls the JSON
    // endpoint at /api/verify/employee/:token under the hood.
    res.json({
      token,
      verifyUrl: `${origin}/verify/employee/${token}`,
    });
  },
);

function certStatus(expirationDate: string | null): string {
  if (!expirationDate) return "no_expiration";
  const exp = new Date(expirationDate + "T00:00:00").getTime();
  const now = Date.now();
  const days = (exp - now) / (1000 * 60 * 60 * 24);
  if (days < 0) return "expired";
  if (days <= 60) return "expiring";
  return "valid";
}

// Public verification — no auth. Returns minimal PII.
router.get("/verify/employee/:token", async (req, res): Promise<void> => {
  const decoded = verifyComplianceToken(String(req.params.token));
  if (!decoded) {
    res.status(404).json({ verified: false, error: "Invalid or expired token", code: "auth.invalid_or_expired_token" });
    return;
  }
  const [emp] = await db
    .select({
      id: fieldEmployeesTable.id,
      firstName: fieldEmployeesTable.firstName,
      lastName: fieldEmployeesTable.lastName,
      jobTitle: fieldEmployeesTable.jobTitle,
      isActive: fieldEmployeesTable.isActive,
      photoUrl: fieldEmployeesTable.photoUrl,
      profilePhotoPath: fieldEmployeesTable.profilePhotoPath,
      deletedAt: fieldEmployeesTable.deletedAt,
      employerName: vendorsTable.name,
    })
    .from(fieldEmployeesTable)
    .leftJoin(vendorsTable, eq(fieldEmployeesTable.vendorId, vendorsTable.id))
    .where(eq(fieldEmployeesTable.id, decoded.employeeId));
  if (!emp || emp.deletedAt) {
    res.status(404).json({ verified: false, error: "Employee not found", code: "employee.not_found" });
    return;
  }
  const certs = await db
    .select()
    .from(employeeCertificationsTable)
    .where(
      and(
        eq(employeeCertificationsTable.employeeId, decoded.employeeId),
        isNull(employeeCertificationsTable.deletedAt),
      ),
    );
  const photoUrl =
    emp.photoUrl ||
    (emp.profilePhotoPath
      ? emp.profilePhotoPath.startsWith("http")
        ? emp.profilePhotoPath
        : `/api/storage${emp.profilePhotoPath.startsWith("/") ? emp.profilePhotoPath : `/${emp.profilePhotoPath}`}`
      : null);
  res.json({
    verified: emp.isActive === true,
    employeeId: emp.id,
    firstName: emp.firstName,
    lastName: emp.lastName,
    photoUrl,
    employerName: emp.employerName,
    jobTitle: emp.jobTitle,
    active: emp.isActive,
    certifications: certs.map((c) => ({
      name: c.name,
      issuer: c.issuer,
      expirationDate: c.expirationDate,
      status: certStatus(c.expirationDate),
    })),
    verifiedAt: new Date().toISOString(),
  });
});

export default router;
