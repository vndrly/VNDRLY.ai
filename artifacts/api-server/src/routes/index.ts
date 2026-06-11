import { Router, type IRouter } from "express";
import healthRouter from "./health";
import partnersRouter from "./partners";
import vendorsRouter from "./vendors";
import workTypesRouter from "./workTypes";
import partnerWorkTypeAfesRouter from "./partnerWorkTypeAfes";
import partnerVendorWorkTypeApprovalsRouter from "./partnerVendorWorkTypeApprovals";
import siteLocationsRouter from "./siteLocations";
import directAssignmentsRouter from "./directAssignments";
import fieldEmployeesRouter from "./fieldEmployees";
import ticketsRouter from "./tickets";
import dashboardRouter from "./dashboard";
import analyticsRouter from "./analytics";
import storageRouter from "./storage";
import authRouter from "./auth";
import passwordResetRouter from "./passwordReset";
import hotlistRouter from "./hotlist";
import notificationsRouter from "./notifications";
import vendorRatingsRouter from "./vendorRatings";
import fieldRouter from "./field";
import crewRouter from "./crew";
import ticketScheduleRouter from "./ticketSchedule";
import employeeCertificationsRouter from "./employeeCertifications";
import commentsRouter from "./comments";
import locationsRouter from "./locations";
import visitsRouter from "./visits";
import orgMembersRouter from "./orgMembers";
import partnerVendorRelationshipsRouter from "./partnerVendorRelationships";
import vendorSiteLocationAfesRouter from "./vendorSiteLocationAfes";
import vendorWorkTypesSelfServiceRouter from "./vendorWorkTypesSelfService";
import vendorCatalogRouter from "./vendorCatalog";
import invoicesRouter from "./invoices";
import reportsRouter from "./reports";
import accountingConnectionsRouter from "./accountingConnections";
import accountManagementRouter from "./accountManagement";
import onboardingRouter from "./onboarding";
import assistantRouter from "./assistant";
import demoProdSeedRouter from "./demoProdSeed";
import adminRecoveryRouter from "./adminRecovery";
import platformSettingsRouter from "./platformSettings";
import fireTransmitterSettingsRouter from "./fireTransmitterSettings";
import ticketNudgeRouter from "./ticketNudge";

const router: IRouter = Router();

router.use(authRouter);
// One-shot live-account password recovery, fully gated behind the
// ADMIN_RECOVERY_SECRET prod env var. When the env var is unset (the
// default), the route returns 404 — i.e. the endpoint is inert. Set the
// secret only for the brief window a recovery is needed, then unset.
router.use(adminRecoveryRouter);
// Demo prod-seed route is a one-shot operational tool (additive-only
// seeding of demo accounts/tickets) gated behind a hardcoded one-shot
// token. Even with the token check, leaving the endpoint mounted
// permanently in production is a footgun — a leaked URL or an attacker
// who reads source could mutate auth state. Default OFF; opt in by
// setting ENABLE_DEMO_PROD_SEED=1 only for the brief window the seed
// is being run, then unset it. The token check inside the route still
// applies as defense in depth.
if (process.env.ENABLE_DEMO_PROD_SEED === "1") {
  router.use(demoProdSeedRouter);
}
router.use(passwordResetRouter);
router.use(fieldRouter);
router.use(healthRouter);
router.use(partnersRouter);
router.use(vendorsRouter);
router.use(workTypesRouter);
router.use(partnerWorkTypeAfesRouter);
router.use(partnerVendorWorkTypeApprovalsRouter);
router.use(siteLocationsRouter);
router.use(directAssignmentsRouter);
router.use(fieldEmployeesRouter);
router.use(ticketsRouter);
router.use(ticketNudgeRouter);
router.use(crewRouter);
router.use(ticketScheduleRouter);
router.use(employeeCertificationsRouter);
router.use(dashboardRouter);
router.use(analyticsRouter);
router.use(storageRouter);
router.use(hotlistRouter);
router.use(notificationsRouter);
router.use(vendorRatingsRouter);
router.use(commentsRouter);
router.use(locationsRouter);
router.use(visitsRouter);
router.use(orgMembersRouter);
router.use(partnerVendorRelationshipsRouter);
router.use(vendorSiteLocationAfesRouter);
router.use(vendorWorkTypesSelfServiceRouter);
router.use(vendorCatalogRouter);
router.use(invoicesRouter);
router.use(reportsRouter);
router.use(accountingConnectionsRouter);
router.use(accountManagementRouter);
router.use(platformSettingsRouter);
router.use(fireTransmitterSettingsRouter);
router.use(onboardingRouter);
router.use(assistantRouter);

export default router;
