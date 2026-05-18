import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { eq, and, asc } from "drizzle-orm";
import {
  db,
  partnersTable,
  vendorsTable,
  workTypesTable,
  vendorWorkTypesTable,
  partnerVendorWorkTypeApprovalsTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";

const router: IRouter = Router();

function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = getSessionFromRequest(req);
  if (!session) {
    res
      .status(401)
      .json({ error: "Authentication required", code: "auth.required" });
    return;
  }
  next();
}

// Returns true if the caller is allowed to view/manage this partner's
// catalog approvals: admins always; partner-role users only when their
// session is bound to this partner.
function canSeePartner(req: Request, partnerId: number): boolean {
  const session = getSessionFromRequest(req);
  if (!session) return false;
  if (session.role === "admin") return true;
  if (session.role === "partner" && session.partnerId === partnerId) {
    return true;
  }
  return false;
}

function canManagePartner(req: Request, partnerId: number): boolean {
  // Same gate as canSeePartner today; kept distinct so the rules can
  // diverge later (e.g. allow read for vendor portal but only write
  // for admin / partner-self).
  return canSeePartner(req, partnerId);
}

router.get(
  "/partners/:partnerId/work-types/:workTypeId/vendor-offers",
  requireSession,
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    const workTypeId = parseInt(String(req.params.workTypeId), 10);
    if (isNaN(partnerId) || isNaN(workTypeId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!canSeePartner(req, partnerId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [partner] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.id, partnerId))
      .limit(1);
    if (!partner) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }

    const offers = await db
      .select({
        vendorId: vendorWorkTypesTable.vendorId,
        vendorName: vendorsTable.name,
        unitPrice: vendorWorkTypesTable.unitPrice,
        unit: vendorWorkTypesTable.unit,
        currency: vendorWorkTypesTable.currency,
        notes: vendorWorkTypesTable.notes,
      })
      .from(vendorWorkTypesTable)
      .innerJoin(
        vendorsTable,
        eq(vendorWorkTypesTable.vendorId, vendorsTable.id),
      )
      .where(eq(vendorWorkTypesTable.workTypeId, workTypeId))
      .orderBy(asc(vendorsTable.name));

    const approvals = await db
      .select()
      .from(partnerVendorWorkTypeApprovalsTable)
      .where(
        and(
          eq(partnerVendorWorkTypeApprovalsTable.partnerId, partnerId),
          eq(partnerVendorWorkTypeApprovalsTable.workTypeId, workTypeId),
        ),
      );
    const approvedByVendor = new Map<number, (typeof approvals)[number]>();
    for (const a of approvals) approvedByVendor.set(a.vendorId, a);

    const items = offers.map((o) => {
      const a = approvedByVendor.get(o.vendorId);
      return {
        vendorId: o.vendorId,
        vendorName: o.vendorName,
        unitPrice: o.unitPrice,
        unit: o.unit,
        currency: o.currency,
        notes: o.notes,
        approved: !!a,
        approvedAt: a?.approvedAt ?? null,
        approvedUnitPrice: a?.approvedUnitPrice ?? null,
      };
    });

    res.json({ partnerId, workTypeId, items });
  },
);

// Toggle an approval. Body: { approved: boolean }. When approved, we
// snapshot the vendor's currently-quoted unit price so the partner
// row reflects the price they actually agreed to (vendors can later
// change their catalog without retroactively rewriting approvals).
router.post(
  "/partners/:partnerId/work-types/:workTypeId/vendor-approvals/:vendorId",
  requireSession,
  async (req, res): Promise<void> => {
    const partnerId = parseInt(String(req.params.partnerId), 10);
    const workTypeId = parseInt(String(req.params.workTypeId), 10);
    const vendorId = parseInt(String(req.params.vendorId), 10);
    if (isNaN(partnerId) || isNaN(workTypeId) || isNaN(vendorId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    if (!canManagePartner(req, partnerId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const body = req.body as { approved?: unknown };
    if (typeof body?.approved !== "boolean") {
      res.status(400).json({ error: "approved (boolean) required" });
      return;
    }

    const [partner] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.id, partnerId))
      .limit(1);
    if (!partner) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }

    if (!body.approved) {
      await db
        .delete(partnerVendorWorkTypeApprovalsTable)
        .where(
          and(
            eq(partnerVendorWorkTypeApprovalsTable.partnerId, partnerId),
            eq(partnerVendorWorkTypeApprovalsTable.vendorId, vendorId),
            eq(partnerVendorWorkTypeApprovalsTable.workTypeId, workTypeId),
          ),
        );
      res.json({ partnerId, vendorId, workTypeId, approved: false });
      return;
    }

    // Pull the vendor's current price for this work type so we can
    // capture it on the approval row. If the vendor doesn't actually
    // offer this work type, refuse the approval — the UI should never
    // surface a checkbox for a row that isn't in vendor_work_types,
    // but we belt-and-suspenders the server too.
    const [offer] = await db
      .select({
        unitPrice: vendorWorkTypesTable.unitPrice,
        unit: vendorWorkTypesTable.unit,
        currency: vendorWorkTypesTable.currency,
      })
      .from(vendorWorkTypesTable)
      .where(
        and(
          eq(vendorWorkTypesTable.vendorId, vendorId),
          eq(vendorWorkTypesTable.workTypeId, workTypeId),
        ),
      )
      .limit(1);
    if (!offer) {
      res.status(400).json({
        error: "Vendor does not offer this product/service",
        code: "approval.no_offer",
      });
      return;
    }

    const session = getSessionFromRequest(req);
    const approvedByUserId = session?.userId ?? null;

    await db
      .insert(partnerVendorWorkTypeApprovalsTable)
      .values({
        partnerId,
        vendorId,
        workTypeId,
        approvedUnitPrice: offer.unitPrice,
        approvedUnit: offer.unit,
        approvedCurrency: offer.currency ?? "USD",
        approvedByUserId,
      })
      .onConflictDoUpdate({
        target: [
          partnerVendorWorkTypeApprovalsTable.partnerId,
          partnerVendorWorkTypeApprovalsTable.vendorId,
          partnerVendorWorkTypeApprovalsTable.workTypeId,
        ],
        set: {
          approvedUnitPrice: offer.unitPrice,
          approvedUnit: offer.unit,
          approvedCurrency: offer.currency ?? "USD",
          approvedByUserId,
          approvedAt: new Date(),
        },
      });

    res.json({
      partnerId,
      vendorId,
      workTypeId,
      approved: true,
      approvedUnitPrice: offer.unitPrice,
      approvedUnit: offer.unit,
      approvedCurrency: offer.currency ?? "USD",
    });
  },
);

export default router;
