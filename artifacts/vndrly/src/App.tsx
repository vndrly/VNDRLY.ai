import { Switch, Route, Router as WouterRouter, useLocation, useRoute } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { BrandProvider } from "@/hooks/use-brand";
import { ThemeProvider } from "@/hooks/use-theme";
import { NotificationsModalProvider } from "@/components/notifications-modal-context";
import Layout from "@/components/layout";
import { AssistantLauncher } from "@/components/assistant-panel";
import ContextPickerModal from "@/components/context-picker-modal";
import ChangePasswordModal from "@/components/change-password-modal";
import Login from "@/pages/login";
import Partners from "@/pages/partners";
import PartnerDetail from "@/pages/partner-detail";
import Vendors from "@/pages/vendors";
import VendorDetail from "@/pages/vendor-detail";
import FieldEmployees from "@/pages/field-employees";
import FieldEmployeeDetail from "@/pages/field-employee-detail";
import SiteLocations from "@/pages/site-locations";
import SiteLocationDetail from "@/pages/site-location-detail";
import Tickets from "@/pages/tickets";
import TicketDetail from "@/pages/ticket-detail";
import FieldSchedule from "@/pages/field-schedule";
import FieldProfile from "@/pages/field-profile";
import FieldEditProfile from "@/pages/field-edit-profile";
import FieldCompliance from "@/pages/field-compliance";
import FieldCrew from "@/pages/field-crew";
import { FieldPortalLayout } from "@/components/field-portal-layout";
import { ForemanPortalLayout } from "@/components/foreman-portal-layout";
import { isForemanPersona } from "@/lib/portal-base";
import Catalog from "@/pages/catalog";
import CatalogHealth from "@/pages/catalog-health";
import PartnerCatalog from "@/pages/partner-catalog";
import VendorCatalog from "@/pages/vendor-catalog";
import NotificationPreferencesPage from "@/pages/notification-preferences";
import NotificationsInboxPage from "@/pages/notifications-inbox";
import InvoicesPage from "@/pages/invoices";
import InvoiceDetailPage from "@/pages/invoice-detail";
import BillingSettingsPage from "@/pages/billing-settings";
import BillsToPayPage from "@/pages/bills-to-pay";
import StatementPage from "@/pages/statement";
import FlaggedTicketsPage from "@/pages/flagged-tickets";
import SafetyInboxPage from "@/pages/safety-inbox";
import SafetyEventDetailPage from "@/pages/safety-event-detail";
import SafetyReportPage from "@/pages/safety-report";
import SafetyTrainingPage from "@/pages/safety-training";
import Portal from "@/pages/portal";
import VisitPublicPage from "@/pages/visit-public";
import VerifyEmployeePage from "@/pages/verify-employee";
import VisitorEntryPage from "@/pages/visitor-entry";
import VisitorsPage from "@/pages/visitors";
import FieldHome from "@/pages/field-home";
import ForemanHome from "@/pages/foreman-home";
import ForemanCrews from "@/pages/foreman-crews";
import FieldNewTicket from "@/pages/field-new-ticket";
import AccountLocation from "@/pages/account-location";
import Signup from "@/pages/signup";
import OnboardingPartner from "@/pages/onboarding-partner";
import OnboardingVendor from "@/pages/onboarding-vendor";
import OnboardingField from "@/pages/onboarding-field";
import ForgotPassword from "@/pages/forgot-password";
import PlatformEulaPage from "@/pages/platform-eula";
import ResetPassword from "@/pages/reset-password";
import SignupVendor from "@/pages/signup-vendor";
import SignupPartner from "@/pages/signup-partner";
import NotFound from "@/pages/not-found";
import AdminVndrly from "@/pages/admin-vndrly";
import AdminRateLimits from "@/pages/admin-rate-limits";
import AdminRemovedComments from "@/pages/admin-removed-comments";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const VendorAnalytics = lazy(() => import("@/pages/vendor-analytics"));
const PartnerAnalytics = lazy(() => import("@/pages/partner-analytics"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const CrewMapPage = lazy(() => import("@/pages/crew-map"));
const CrewReplayPage = lazy(() => import("@/pages/crew-replay"));
const SiteMapPage = lazy(() => import("@/pages/site-map"));
const VisitDetailPage = lazy(() => import("@/pages/visit-detail"));
const PrintVisitorQrPage = lazy(() => import("@/pages/print-visitor-qr"));
const PrintVisitorQrsPage = lazy(() => import("@/pages/print-visitor-qrs"));
const PrintTicketPage = lazy(() => import("@/pages/print-ticket"));
const PrintHotlistPage = lazy(() => import("@/pages/print-hotlist"));
const ForemanCrewMapPage = lazy(() => import("@/pages/foreman-crew-map"));
const ForemanAnalytics = lazy(() => import("@/pages/foreman-analytics"));
const Admin1099Transmitter = lazy(() => import("@/pages/admin-1099-transmitter"));

function RouteFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
    </div>
  );
}

const queryClient =
  (import.meta.hot?.data.queryClient as QueryClient | undefined) ??
  new QueryClient();

if (import.meta.hot) {
  import.meta.hot.data.queryClient = queryClient;
}

function ForemanRootRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/foreman", { replace: true });
  }, [navigate]);
  return null;
}

function LoginRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);
  return null;
}

function AdminRoutes() {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/partners" component={Partners} />
        <Route path="/partners/:id">{(params) => <PartnerDetail id={parseInt(params.id)} />}</Route>
        <Route path="/vendors" component={Vendors} />
        <Route path="/vendors/:id">{(params) => <VendorDetail id={parseInt(params.id)} />}</Route>
        <Route path="/field-employees" component={FieldEmployees} />
        <Route path="/field-employees/:id">{(params) => <FieldEmployeeDetail id={parseInt(params.id)} />}</Route>
        <Route path="/site-locations" component={SiteLocations} />
        <Route path="/site-locations/:id">{(params) => <SiteLocationDetail id={parseInt(params.id)} />}</Route>
        <Route path="/tickets" component={Tickets} />
        <Route path="/flagged" component={FlaggedTicketsPage} />
        <Route path="/safety" component={SafetyInboxPage} />
        <Route path="/safety-report" component={SafetyReportPage} />
        <Route path="/safety-training" component={SafetyTrainingPage} />
        <Route path="/safety/:id" component={SafetyEventDetailPage} />
        <Route path="/tickets/:id">{(params) => <TicketDetail id={parseInt(params.id)} />}</Route>
        <Route path="/crew-map">{() => <CrewMapPage />}</Route>
        <Route path="/crew-map/:id">{(params) => <CrewReplayPage employeeId={parseInt(params.id)} />}</Route>
        <Route path="/site-map" component={SiteMapPage} />
        <Route path="/catalog" component={Catalog} />
        <Route path="/catalog-health" component={CatalogHealth} />
        <Route path="/partner-catalog" component={PartnerCatalog} />
        <Route path="/vendor-catalog" component={VendorCatalog} />
        <Route path="/analytics/vendor/:id">{(params) => <VendorAnalytics vendorId={parseInt(params.id)} />}</Route>
        <Route path="/analytics/partner/:id">{(params) => <PartnerAnalytics partnerId={parseInt(params.id)} />}</Route>
        <Route path="/notifications/preferences" component={NotificationPreferencesPage} />
        <Route path="/notifications" component={NotificationsInboxPage} />
        <Route path="/invoices" component={InvoicesPage} />
        <Route path="/invoices/:id">{(params) => <InvoiceDetailPage id={parseInt(params.id)} />}</Route>
        <Route path="/billing-settings/:vendorId/:partnerId">{(params) => <BillingSettingsPage vendorId={parseInt(params.vendorId)} partnerId={parseInt(params.partnerId)} />}</Route>
        <Route path="/bills-to-pay" component={BillsToPayPage} />
        <Route path="/statement" component={StatementPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/visitors" component={VisitorsPage} />
        <Route path="/visits/:id">{(params) => <VisitDetailPage id={params.id} />}</Route>
        <Route path="/admin/vndrly" component={AdminVndrly} />
        <Route path="/admin/rate-limits" component={AdminRateLimits} />
        <Route path="/admin/removed-comments" component={AdminRemovedComments} />
        <Route path="/admin/1099-transmitter" component={Admin1099Transmitter} />
        <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function AuthenticatedRouter() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
        <Route path="/portal/:siteCode">{(params) => <Portal siteCode={params.siteCode} />}</Route>
        <Route path="/visit/:siteCode">{(params) => <VisitPublicPage siteCode={params.siteCode} />}</Route>
        <Route path="/verify/employee/:token">{(params) => <VerifyEmployeePage token={params.token} />}</Route>
        <Route path="/visitor" component={VisitorEntryPage} />
        <Route path="/print-visitor-qr/:id">{(params) => <PrintVisitorQrPage id={parseInt(params.id)} />}</Route>
        <Route path="/print-visitor-qrs" component={PrintVisitorQrsPage} />
        <Route path="/print-ticket/:id">{(params) => <PrintTicketPage id={parseInt(params.id)} />}</Route>
        <Route path="/print-hotlist" component={PrintHotlistPage} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/legal/eula" component={PlatformEulaPage} />
        <Route path="/signup" component={Signup} />
        <Route path="/signup/vendor" component={OnboardingVendor} />
        <Route path="/signup/partner" component={OnboardingPartner} />
        <Route path="/onboarding/partner" component={OnboardingPartner} />
        <Route path="/onboarding/vendor" component={OnboardingVendor} />
        <Route path="/onboarding/field/:token" component={OnboardingField} />
        {!user ? (
          <Route path="/*splat" component={Login} />
        ) : user.role === "field_employee" && isForemanPersona(user) ? (
          <ForemanPortalLayout>
            <Switch>
              <Route path="/foreman" component={ForemanHome} />
              <Route path="/foreman/schedule" component={FieldSchedule} />
              <Route path="/foreman/map" component={ForemanCrewMapPage} />
              <Route path="/foreman/crews" component={ForemanCrews} />
              <Route path="/foreman/analytics" component={ForemanAnalytics} />
              <Route path="/foreman/profile" component={FieldProfile} />
              <Route path="/foreman/profile/edit" component={FieldEditProfile} />
              <Route path="/foreman/compliance" component={FieldCompliance} />
              <Route path="/foreman/crew" component={FieldCrew} />
              <Route path="/foreman/new-ticket" component={FieldNewTicket} />
              <Route path="/foreman/scan" component={FieldNewTicket} />
              <Route path="/account/location" component={AccountLocation} />
              <Route path="/notifications/preferences" component={NotificationPreferencesPage} />
              <Route path="/notifications" component={NotificationsInboxPage} />
              <Route path="/tickets/:id">{(params) => <TicketDetail id={parseInt(params.id)} />}</Route>
              <Route path="/">
                <ForemanRootRedirect />
              </Route>
              <Route path="/*splat" component={ForemanHome} />
            </Switch>
          </ForemanPortalLayout>
        ) : user.role === "field_employee" ? (
          <FieldPortalLayout>
            <Switch>
              <Route path="/field" component={FieldHome} />
              <Route path="/field/schedule" component={FieldSchedule} />
              <Route path="/field/profile" component={FieldProfile} />
              <Route path="/field/profile/edit" component={FieldEditProfile} />
              <Route path="/field/compliance" component={FieldCompliance} />
              <Route path="/field/crew" component={FieldCrew} />
              <Route path="/field/new-ticket" component={FieldNewTicket} />
              {/* `/field/scan` is the canonical mobile QR-scan entry the
                  bottom-nav tab points at. The flow currently reuses the
                  same FieldNewTicket component (which opens straight into
                  the QR scanner); the route alias keeps the URL stable so
                  external links / docs / tab match logic don't drift. */}
              <Route path="/field/scan" component={FieldNewTicket} />
              <Route path="/account/location" component={AccountLocation} />
              <Route path="/notifications/preferences" component={NotificationPreferencesPage} />
              <Route path="/notifications" component={NotificationsInboxPage} />
              <Route path="/tickets/:id">{(params) => <TicketDetail id={parseInt(params.id)} />}</Route>
              <Route path="/*splat" component={FieldHome} />
            </Switch>
          </FieldPortalLayout>
        ) : (
          <>
            <Route path="/login" component={LoginRedirect} />
            <Route path="/login/" component={LoginRedirect} />
            <Route path="/*splat" component={AdminRoutes} />
          </>
        )}
        </Switch>
      </Suspense>
      {/* Picker self-gates on requiresContextChoice + memberships >= 2,
          so render it for every authed user — including field-employee
          default contexts that may also have a partner/admin membership. */}
      {user && <ContextPickerModal />}
      {user && <ChangePasswordModal />}
      {/* Global assistant launcher: shown on every authenticated surface
          including onboarding wizards (/onboarding/*) and the field
          portal (/field, /field/*). Also mounts in token-mode on the
          unauthenticated `/onboarding/field/:token` invite page so a
          new field employee can ask for help before they have an
          account. Hidden on print/QR/portal/visitor public pages where
          the floating button would interfere with a printed layout or
          unauthenticated capture flow. */}
      <GlobalAssistantLauncher authenticated={!!user} />
    </>
  );
}

// Decide whether the floating "Ask VNDRLY" button should appear on the
// current route. The launcher mounts on every authenticated UI surface
// and additionally on the unauthenticated field-employee invite page
// (in token mode). It's suppressed on print pages (where it would show
// up in the printout), on the unauthenticated visitor/portal landing
// pages, and on the password-recovery / login / signup flows.
function GlobalAssistantLauncher({ authenticated }: { authenticated: boolean }) {
  const { user } = useAuth();
  const [location] = useLocation();
  // Token-mode: the field-employee onboarding invite link is
  // pre-login. Match the route ourselves so the launcher can pass the
  // token to the panel and use the public chat endpoint.
  const [isFieldInvite, fieldInviteParams] = useRoute("/onboarding/field/:token");
  if (isFieldInvite && fieldInviteParams?.token) {
    return <AssistantLauncher tokenMode={{ token: fieldInviteParams.token }} />;
  }
  // Signup-mode: the public partner/vendor signup pages are also
  // pre-login. Mount the launcher in persona-scoped signup mode so a
  // brand-new visitor can ask for help filling out the form before
  // they have an account. These two paths are the ONLY pre-auth
  // surfaces (besides the field invite above) where the launcher is
  // intentionally visible — every other unauthenticated route still
  // hides it via the `!authenticated → null` early return below.
  const [isSignupPartner] = useRoute("/signup/partner");
  const [isSignupVendor] = useRoute("/signup/vendor");
  if (!authenticated && (isSignupPartner || isSignupVendor)) {
    const persona: "partner" | "vendor" = isSignupPartner ? "partner" : "vendor";
    return <AssistantLauncher signupMode={{ persona }} />;
  }
  if (!authenticated) return null;
  // Use boundary-aware checks so e.g. `/visitors` (the authenticated
  // Visitors index) is NOT matched by the `/visitor` (singular,
  // unauthenticated visitor entry) hide rule. We only treat a prefix
  // as a match when followed by `/`, `?`, or end-of-string.
  const matches = (prefix: string): boolean => {
    if (location === prefix) return true;
    const next = location.charAt(prefix.length);
    return location.startsWith(prefix) && (next === "/" || next === "?" || next === "");
  };
  const hidden =
    matches("/portal") ||
    matches("/visit") ||
    matches("/visitor") ||
    matches("/verify") ||
    location.startsWith("/print-") ||
    matches("/forgot-password") ||
    matches("/reset-password") ||
    matches("/login") ||
    matches("/signup") ||
    matches("/legal");
  if (hidden) return null;
  // Main admin/partner/vendor chrome mounts Ask V in the layout AskV pane.
  // Field ops portals (/field, /foreman) use the same AskV pane in
  // FieldOpsPortalShell. Onboarding wizards keep the floating launcher.
  if (user && !location.startsWith("/onboarding/")) {
    if (user.role !== "field_employee") {
      return null;
    }
    if (matches("/foreman") || matches("/field")) {
      return null;
    }
  }
  return <AssistantLauncher />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrandProvider>
            <ThemeProvider>
              <NotificationsModalProvider>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <AuthenticatedRouter />
                </WouterRouter>
              </NotificationsModalProvider>
              <Toaster />
            </ThemeProvider>
          </BrandProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
