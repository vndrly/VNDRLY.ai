import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";
import { Spinner } from "@/components/ui/spinner";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import headerBg from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";
import SidebarButton from "@/components/sidebar-button";
import LanguageToggle from "@/components/language-toggle";
import DarkLightToggle, { type ThemeMode } from "@/components/dark-light-toggle";
import { PoweredByVndrly } from "@/components/powered-by-vndrly";

import logoUnderlay from "@assets/logo-underrlay_1778217900673.png";
import logoOverlay from "@assets/logo-overlay_1778217860263.png";
import { useBrand, brandStyleVars } from "@/hooks/use-brand";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type DemoAccount = {
  username: string;
  password: string;
  label: string;
  role: string;
};

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Local Dark/Light surface toggle — defaults to the vdark treatment
  // captured in replit.md. Light mode reverts the vendor sign-in to the
  // pre-vdark white-surface palette (text-gray-900 / 700 / 500 etc.).
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const isDark = themeMode === "dark";
  const [isResettingDemo, setIsResettingDemo] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[] | null>(null);
  const [isLoadingDemoAccounts, setIsLoadingDemoAccounts] = useState(false);
  const [demoAccountsAvailable, setDemoAccountsAvailable] = useState(true);
  // Tracks the demo account currently being used for one-tap sign-in so we
  // can render a per-row spinner. `null` when no demo login is in flight.
  const [demoLoginUsername, setDemoLoginUsername] = useState<string | null>(null);
  const { login, user } = useAuth();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (user && (location === "/login" || location === "/login/")) {
      navigate("/", { replace: true });
    }
  }, [user, location, navigate]);

  // Dev-only: pull the demo accounts the API server is willing to seed
  // so non-engineers can autofill the form without hunting through code.
  // Re-fetched whenever the UI language changes so the displayed `label`
  // matches the active locale (the endpoint localizes server-side).
  // Production builds never enter this branch (`import.meta.env.DEV` is
  // statically false) so the panel and its network call are dead-stripped.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!demoAccountsAvailable) return;
    const lang = i18n.language?.startsWith("es") ? "es" : "en";
    let cancelled = false;
    setIsLoadingDemoAccounts(true);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/auth/demo-users?lang=${encodeURIComponent(lang)}`,
          { credentials: "omit" },
        );
        if (cancelled) return;
        if (!res.ok) {
          // Treat non-OK (e.g. 404 in a non-dev API build) as "no demo
          // accounts" and stop trying so we don't spam the network tab.
          setDemoAccounts(null);
          setDemoAccountsAvailable(false);
          return;
        }
        const body = (await res.json()) as { accounts?: unknown };
        if (cancelled) return;
        const accounts = Array.isArray(body.accounts)
          ? body.accounts.filter((a): a is DemoAccount =>
              !!a &&
              typeof a === "object" &&
              typeof (a as DemoAccount).username === "string" &&
              typeof (a as DemoAccount).password === "string" &&
              typeof (a as DemoAccount).label === "string" &&
              typeof (a as DemoAccount).role === "string",
            )
          : [];
        setDemoAccounts(accounts);
      } catch {
        if (cancelled) return;
        setDemoAccounts(null);
        setDemoAccountsAvailable(false);
      } finally {
        if (!cancelled) setIsLoadingDemoAccounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [i18n.language, demoAccountsAvailable]);

  const handleUseDemoAccount = async (account: DemoAccount) => {
    // Ignore clicks while any sign-in is already in flight so a quick
    // double-click (or clicking a different row mid-attempt) can't kick
    // off a second concurrent login.
    if (isSubmitting) return;
    // Mirror the form state so the username/password inputs reflect what
    // we're about to submit — this keeps the UI honest if the login
    // fails (the user sees the credentials we tried and can edit them).
    setUsername(account.username);
    setPassword(account.password);
    setDemoLoginUsername(account.username);
    setIsSubmitting(true);
    try {
      await login(account.username, account.password);
      navigate("/", { replace: true });
    } catch (err) {
      toast({
        title: translateApiError(err, t, t("login.loginFailed")),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      setDemoLoginUsername(null);
    }
  };

  // Tracks the most-recently-copied credential so we can briefly swap the
  // copy icon for a checkmark — purely visual feedback that the click
  // landed (the toast is the canonical confirmation, but the icon flip
  // makes the per-row affordance feel responsive). Keyed as
  // `${username}:${field}` so each row's two icons are independent.
  // Cleared after ~1.5s by the timer ref below.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleCopyCredential = async (
    account: DemoAccount,
    field: "username" | "password",
  ) => {
    const value = field === "username" ? account.username : account.password;
    try {
      await navigator.clipboard.writeText(value);
      const key = `${account.username}:${field}`;
      setCopiedKey(key);
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
        copiedTimerRef.current = null;
      }, 1500);
      toast({
        title: t("login.demoAccountsCopied", {
          label:
            field === "username"
              ? t("login.demoAccountsUsernameLabel")
              : t("login.demoAccountsPasswordLabel"),
        }),
      });
    } catch {
      toast({
        title: t("login.demoAccountsCopyFailed"),
        variant: "destructive",
      });
    }
  };

  const formReady = username.length > 0 && password.length > 0;
  const brand = useBrand();
  const branded = brand.isOrgBranded;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setIsSubmitting(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      toast({
        title: translateApiError(err, t, t("login.loginFailed")),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetDemoLogins = async () => {
    if (isResettingDemo) return;
    setIsResettingDemo(true);
    try {
      // Send the request WITHOUT credentials. /auth/seed is
      // unauthenticated and the global session-version middleware
      // (artifacts/api-server/src/app.ts) will 401 any request that
      // carries a stale session cookie — and seed itself bumps
      // sessionVersion when it restores a drifted password, so a
      // second click moments later would otherwise fail with
      // "Session has been invalidated" on the now-stale cookie. The
      // anonymous request keeps recovery resilient.
      const res = await fetch(`${API_BASE}/api/auth/seed`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        let serverMessage: string | null = null;
        try {
          const body = await res.json();
          if (body && typeof body.message === "string") serverMessage = body.message;
        } catch {
          /* non-JSON error body — fall through to default copy */
        }
        toast({
          title: t("login.resetDemoFailed"),
          description: serverMessage ?? t("login.resetDemoFailedDescription", { status: res.status }),
          variant: "destructive",
        });
        return;
      }
      const body = (await res.json()) as { passwordReset?: unknown; added?: unknown };
      const restored = Array.isArray(body.passwordReset)
        ? (body.passwordReset.filter((u): u is string => typeof u === "string"))
        : [];
      const added = Array.isArray(body.added)
        ? (body.added.filter((u): u is string => typeof u === "string"))
        : [];
      // Merge added (newly inserted users) and passwordReset (existing
      // users whose drifted hash was restored) so the toast credits both
      // — on a brand-new dev DB the restoration shows up as `added`,
      // on an existing-but-drifted DB it shows up as `passwordReset`.
      const changed = Array.from(new Set([...added, ...restored]));
      if (changed.length === 0) {
        toast({ title: t("login.resetDemoInSync") });
      } else {
        toast({
          title: t("login.resetDemoRestored", { users: changed.join(", ") }),
        });
      }
    } catch (err) {
      toast({
        title: t("login.resetDemoFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsResettingDemo(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" style={brandStyleVars(brand)}>
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-16 relative" style={{ backgroundColor: isDark ? "#3a3d42" : "#ffffff" }}>
        <div
          className="absolute top-0 left-0 right-0 pointer-events-none z-0"
          style={{
            backgroundImage: `url(${headerBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center top",
            opacity: 0.85,
            height: "240px",
            maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          }}
        />
        <PoweredByVndrly
          className={cn("absolute bottom-4 right-4 z-20", isDark ? "text-gray-300" : "text-gray-500")}
        />
        <div className="absolute top-4 right-4 z-20">
          <LanguageToggle variant={isDark ? "dark" : "light"} />
        </div>
        <div className="absolute top-4 left-4 z-20">
          <DarkLightToggle mode={themeMode} onChange={setThemeMode} variant={isDark ? "dark" : "light"} />
        </div>
        <div className="w-full max-w-md relative z-10">
          <div className="flex items-center gap-3 mb-3">
            {(() => {
              // Mirror the navigation pane's top-of-sidebar logo treatment:
              // partner-square (1:1) at 64x64 when available, otherwise the
              // 64x64 default VNDRLY square. We intentionally avoid the
              // irregular logoUrl fallback here so the login screen always
              // shows a square 64x64 badge (matching the nav top), which
              // also gives us a stable layout while branding loads.
              const sidebarLogoUrl = brand.logoSquareUrl || brand.logoUrl || null;
              const usingSquareLogo = !!brand.logoSquareUrl;
              if (branded && sidebarLogoUrl && usingSquareLogo) {
                return (
                  <div className="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden">
                    <img
                      src={logoUnderlay}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                      style={{ opacity: 0.5 }}
                      draggable={false}
                    />
                    <img
                      src={logoOverlay}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                      style={{ opacity: 0.7 }}
                      draggable={false}
                    />
                    <img
                      src={sidebarLogoUrl}
                      alt={brand.name ? `${brand.name} Logo` : "Partner Logo"}
                      className="absolute inset-0 w-full h-full object-contain p-2"
                      draggable={false}
                      data-testid="img-login-partner-logo"
                    />
                  </div>
                );
              }
              if (branded && sidebarLogoUrl) {
                return (
                  <img
                    src={sidebarLogoUrl}
                    alt={brand.name ? `${brand.name} Logo` : "Partner Logo"}
                    className="h-16 w-auto max-w-[120px] object-contain shrink-0 rounded-lg bg-white/0 p-1"
                    draggable={false}
                    data-testid="img-login-partner-logo"
                  />
                );
              }
              return (
                <img
                  src={vndrlyLogo}
                  alt="VNDRLY Logo"
                  className="w-16 h-16 rounded-lg shrink-0"
                  draggable={false}
                  data-testid="img-login-default-logo"
                />
              );
            })()}
            <div className="flex-1 min-w-0">
              <h1 className={cn("text-2xl font-bold tracking-tight leading-none", isDark ? "text-white" : "text-gray-900")}>{branded && brand.name ? brand.name : "VNDRLY"}</h1>
              <p className={cn("text-sm font-semibold leading-tight mt-1", isDark ? "text-gray-200" : "text-gray-700")}>{t("login.title")}</p>
            </div>
          </div>
          <div className="mb-8">
            <p className={cn("text-xs", isDark ? "text-gray-300" : "text-gray-500")}>{t("login.subtitle")}</p>
          </div>

          <div
            className={cn("border-2 rounded-xl p-6 shadow-xl transition-colors duration-300", formReady ? (branded ? "" : "border-amber-500") : "border-gray-300")}
            style={formReady && branded ? { borderColor: brand.primary } : undefined}
          >
            <form id="login-form" onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="username" className={isDark ? "text-gray-100" : "text-gray-700"}>{t("login.emailLabel")}</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("login.emailPlaceholder")}
                  autoComplete="username"
                  data-testid="input-username"
                  className="h-[38px] bg-white rounded-md"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className={isDark ? "text-gray-100" : "text-gray-700"}>{t("login.passwordLabel")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("login.passwordPlaceholder")}
                    autoComplete="current-password"
                    data-testid="input-password"
                    className="h-[38px] bg-white rounded-md pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    data-testid="button-toggle-password-visibility"
                    className="absolute inset-y-0 right-0 flex items-center justify-center w-10 text-gray-500 hover:text-gray-800 focus:outline-none focus:text-gray-800"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="pt-2">
                <SidebarButton
                  isActive={false}
                  testId="button-login"
                  branded={branded}
                  brandPrimary={brand.primary}
                  brandAccent={brand.accent}
                  onClick={() => {
                    if (!formReady || isSubmitting) return;
                    (document.getElementById("login-form") as HTMLFormElement | null)?.requestSubmit();
                  }}
                >
                  <LogIn className="w-4 h-4" />
                  {isSubmitting ? t("login.signingIn") : t("login.signIn")}
                </SidebarButton>
              </div>
            </form>
          </div>

          {/* Helper text blocks share the bordered card's px-6 padding so
              their left edge lines up with the email/password input boxes
              above. Text is left-aligned (rather than centered) for the
              same reason. The Reset my Password link sits inline next to
              the "Field Employees:" heading. */}
          <div className={cn("mt-4 pt-4 px-6 border-t", isDark ? "border-white/20" : "border-gray-200")}>
            <p className={cn("text-sm leading-relaxed", isDark ? "text-gray-300" : "text-gray-500")}>
              <span className={cn("font-medium", isDark ? "text-gray-100" : "text-gray-700")}>{t("login.fieldEmployees")}</span>{" "}
              <a
                href="/forgot-password"
                className={cn("font-semibold hover:text-[color:var(--brand-primary)] no-underline transition-colors", isDark ? "text-gray-200" : "text-gray-500")}
                onClick={(e) => { e.preventDefault(); navigate("/forgot-password"); }}
                data-testid="link-reset-password"
              >
                {t("login.resetPassword")}
              </a>
              <br />
              {t("login.fieldEmployeesNote")}
            </p>
            <p className={cn("mt-3 text-sm leading-relaxed", isDark ? "text-gray-300" : "text-gray-500")}>
              <span className={cn("font-medium", isDark ? "text-gray-100" : "text-gray-700")}>{t("login.newToVndrly")}</span>{" "}
              <a
                href="/signup"
                className="font-semibold text-[color:var(--brand-primary)] hover:underline no-underline transition-colors"
                onClick={(e) => { e.preventDefault(); navigate("/signup"); }}
                data-testid="link-onboard-org"
              >
                {t("login.newToVndrlyOnboardLink")}
              </a>
              <br />
              <span className="italic">"{t("login.newToVndrlyQuote")}"</span>{" "}
              <span className={isDark ? "text-gray-300" : "text-gray-500"}>{t("login.newToVndrlyAttribution")}</span>
            </p>
            <p className={cn("mt-3 text-sm", isDark ? "text-gray-300" : "text-gray-500")}>
              <a
                href="/legal/eula"
                className="font-semibold text-[color:var(--brand-primary)] hover:underline no-underline transition-colors"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/legal/eula");
                }}
                data-testid="link-platform-eula"
              >
                {t("login.eulaLink")}
              </a>
            </p>
          </div>

          {/* Match the inner width of the bordered Sign In card above
              (which uses p-6 → 24px horizontal padding) so the visitor
              button lines up under "Sign In to Portal" at the exact same
              width. */}
          <div className={cn("mt-5 pt-4 px-6 border-t", isDark ? "border-white/20" : "border-gray-200")}>
            <SidebarButton
              isActive={false}
              testId="button-continue-as-visitor"
              branded={branded}
              brandPrimary={brand.primary}
              brandAccent={brand.accent}
              onClick={() => navigate("/visitor")}
            >
              <UserPlus className="w-4 h-4" />
              {t("visitor.continueAsVisitor")}
            </SidebarButton>
          </div>

          {/* Dev-only affordances. Mirrors the gating used by the
              dev-only API endpoints (`/auth/seed`, `/auth/demo-users`):
              shown only in development builds so it never ships to
              production. The "Reset demo logins" button hits POST
              /api/auth/seed which is idempotent and restores any drifted
              demo passwords. The "Demo accounts" panel below it lists
              every seeded account so non-engineers can autofill the form
              with a single click instead of hunting through code. */}
          {import.meta.env.DEV && (
            <div className="mt-4 px-6 space-y-3">
              {demoAccountsAvailable && (
                <div
                  className="rounded-md border border-dashed border-gray-300 bg-white/50 p-3"
                  data-testid="panel-demo-accounts"
                >
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-gray-700">
                      {t("login.demoAccountsTitle")}
                    </p>
                    <p className="text-[11px] text-gray-500 leading-snug">
                      {t("login.demoAccountsSubtitle")}
                    </p>
                  </div>
                  {isLoadingDemoAccounts && demoAccounts === null ? (
                    <p
                      className="text-xs text-gray-500 py-1"
                      data-testid="text-demo-accounts-loading"
                    >
                      {t("login.demoAccountsLoading")}
                    </p>
                  ) : demoAccounts && demoAccounts.length > 0 ? (
                    <ul className="space-y-1.5">
                      {demoAccounts.map((account) => {
                        // The row is a clickable surface that submits a
                        // one-tap sign-in, but we also need per-credential
                        // copy buttons. Nesting <button>s inside a parent
                        // <button> is invalid HTML, so the outer wrapper
                        // is a div with role="button" + keyboard handlers
                        // and the copy icons are real <button>s that stop
                        // propagation so they don't also trigger sign-in.
                        const usernameCopied =
                          copiedKey === `${account.username}:username`;
                        const passwordCopied =
                          copiedKey === `${account.username}:password`;
                        // Per-row sign-in indicator: while one row is
                        // signing in, that row shows a spinner and the
                        // others are dimmed + non-interactive so a stray
                        // click can't queue a second concurrent attempt.
                        const isSigningIn =
                          demoLoginUsername === account.username;
                        const otherSignInBusy = isSubmitting && !isSigningIn;
                        return (
                          <li key={account.username}>
                            <div
                              role="button"
                              tabIndex={isSubmitting ? -1 : 0}
                              aria-busy={isSigningIn}
                              aria-disabled={isSubmitting}
                              onClick={() => {
                                if (isSubmitting) return;
                                void handleUseDemoAccount(account);
                              }}
                              onKeyDown={(e) => {
                                // Only treat Enter/Space as sign-in when
                                // the row itself is the focused element —
                                // not when a nested copy <button> bubbles
                                // its own activation key up. Without this
                                // guard, pressing Enter on a focused copy
                                // icon would also trigger a sign-in.
                                if (e.target !== e.currentTarget) return;
                                if (isSubmitting) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  void handleUseDemoAccount(account);
                                }
                              }}
                              title={t("login.demoAccountsUseThis")}
                              data-testid={`button-use-demo-${account.username}`}
                              className={cn(
                                "w-full text-left rounded-md border bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)] focus:ring-offset-1 transition-colors",
                                isSigningIn
                                  ? "border-[color:var(--brand-primary)] cursor-wait"
                                  : otherSignInBusy
                                    ? "border-gray-200 opacity-50 cursor-not-allowed"
                                    : "border-gray-200 hover:bg-gray-50 hover:border-gray-300 cursor-pointer",
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-gray-800 truncate">
                                  {account.label}
                                </span>
                                {isSigningIn ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[color:var(--brand-primary)] shrink-0"
                                    data-testid={`indicator-signing-in-${account.username}`}
                                  >
                                    <Spinner className="size-3" />
                                    <span>{t("login.demoAccountsSigningIn")}</span>
                                  </span>
                                ) : (
                                  <span className="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">
                                    {account.role}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 grid grid-cols-[auto,1fr,auto] gap-x-2 gap-y-0.5 items-center text-[11px] text-gray-600 font-mono leading-snug">
                                <span className="text-gray-400">
                                  {t("login.demoAccountsUsernameLabel")}:
                                </span>
                                <span className="truncate">{account.username}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleCopyCredential(account, "username");
                                  }}
                                  title={t("login.demoAccountsCopyUsername")}
                                  aria-label={t("login.demoAccountsCopyUsername")}
                                  data-testid={`button-copy-demo-username-${account.username}`}
                                  className="inline-flex items-center justify-center size-5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)] transition-colors"
                                >
                                  {usernameCopied ? (
                                    <Check className="size-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="size-3" />
                                  )}
                                </button>
                                <span className="text-gray-400">
                                  {t("login.demoAccountsPasswordLabel")}:
                                </span>
                                <span className="truncate">{account.password}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleCopyCredential(account, "password");
                                  }}
                                  title={t("login.demoAccountsCopyPassword")}
                                  aria-label={t("login.demoAccountsCopyPassword")}
                                  data-testid={`button-copy-demo-password-${account.username}`}
                                  className="inline-flex items-center justify-center size-5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)] transition-colors"
                                >
                                  {passwordCopied ? (
                                    <Check className="size-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="size-3" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p
                      className="text-xs text-gray-500 py-1"
                      data-testid="text-demo-accounts-empty"
                    >
                      {t("login.demoAccountsEmpty")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Vertical divider mirrors the navigation pane's primary-color
          accent strip — always brand-primary so the partner's brand color
          marks the seam between the login form and the hero panel. */}
      <div
        className={cn("hidden lg:block w-[2px] shrink-0", branded ? "" : "bg-amber-500")}
        style={branded ? { backgroundColor: brand.primary } : undefined}
      />

      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <img
          src="/vndrly-background.jpg"
          alt="Oil field operations"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-gray-900/30 to-transparent" />
        <div className="relative z-10 flex items-end justify-start p-12 w-full h-full">
          <div
            className={cn("bg-white/10 backdrop-blur-md rounded-xl p-8 max-w-md border-2", branded ? "" : "border-amber-500")}
            style={branded ? { borderColor: brand.primary } : undefined}
          >
            <h2 className="text-xl font-bold text-white mb-2">{t("login.heroTitle")}</h2>
            <p className="text-sm text-white/85 leading-relaxed font-normal">
              {t("login.heroDescription")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
