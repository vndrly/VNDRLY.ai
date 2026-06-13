import { PngPillButton } from "@/components/png-pill-rollover";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { handlePhoneInput, stripPhone } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import AmberButton from "@/components/amber-button";
import GreyButton from "@/components/grey-button";
import LanguageToggle from "@/components/language-toggle";
import DarkLightToggle, { type ThemeMode } from "@/components/dark-light-toggle";
import { cn } from "@/lib/utils";
import { NAV_PANE_DARK_BG } from "@/components/nav-pane-tokens";
import { NavPaneHalftoneBackground } from "@/components/nav-pane-halftone-background";
import backIcon from "@assets/Amber-back-button-logo-tuned.png";
import { getContrastWarning, getColorPairWarning } from "@/lib/brand-color";
import { translateApiError } from "@/lib/api-error";

type CheckNameMatch = { name: string; score: number };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function apiFetch(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, { credentials: "include", ...opts });
}

export default function SignupVendor() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    physicalAddress: "",
    billingAddress: "",
    brandPrimaryColor: "",
    brandAccentColor: "",
  });

  // Fuzzy duplicate check via the public /vendors/check-name endpoint.
  // Mirrors the partner self-signup flow (artifacts/vndrly/src/pages/
  // signup-partner.tsx) so a vendor whose company is already in the
  // system is warned to contact us before creating a duplicate row.
  const [matches, setMatches] = useState<CheckNameMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  // The name the most recent check resolved for; gates submit so a fast
  // Enter can't slip through before the debounced check fires.
  const [checkedName, setCheckedName] = useState<string | null>(null);
  const [confirmDifferent, setConfirmDifferent] = useState(false);

  const update = (field: string, value: string) => setForm((prev) => ({ ...prev, [field]: value }));
  const formReady = form.name.length > 0 || form.contactName.length > 0 || form.contactEmail.length > 0;

  // Debounced fuzzy lookup; AbortController prevents stale responses
  // from overwriting state for a newer name.
  useEffect(() => {
    const trimmed = form.name.trim();
    setConfirmDifferent(false);
    if (trimmed.length < 3) {
      setMatches([]);
      setMatchesLoading(false);
      setCheckedName(trimmed);
      return;
    }
    setCheckedName(null);
    setMatchesLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/vendors/check-name?name=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setMatches([]);
          setCheckedName(null);
          return;
        }
        const data = (await res.json()) as { matches?: CheckNameMatch[] };
        if (controller.signal.aborted) return;
        setMatches(Array.isArray(data.matches) ? data.matches : []);
        setCheckedName(trimmed);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setMatches([]);
        setCheckedName(null);
      } finally {
        if (!controller.signal.aborted) setMatchesLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [form.name]);

  const trimmedName = form.name.trim();
  const checkPending =
    trimmedName.length >= 3 && (matchesLoading || checkedName !== trimmedName);
  const blockedByDuplicate = matches.length > 0 && !confirmDifferent;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (checkPending) {
      toast({ title: "Checking for similar vendors…" });
      return;
    }
    if (blockedByDuplicate) {
      toast({
        title: "Please confirm this is a different vendor before continuing.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name || "Pending",
          contactName: form.contactName || "Pending",
          contactEmail: form.contactEmail || "pending@vndrly.com",
          contactPhone: stripPhone(form.contactPhone) || null,
          physicalAddress: form.physicalAddress || null,
          billingAddress: form.billingAddress || null,
          brandPrimaryColor: form.brandPrimaryColor || null,
          brandAccentColor: form.brandAccentColor || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err: Error & { data?: unknown; status?: number } = new Error(
          data.message || data.error || "Failed to create vendor",
        );
        err.data = data;
        err.status = res.status;
        throw err;
      }
      toast({ title: "Vendor account created! You can now sign in." });
      navigate("/");
    } catch (err: unknown) {
      toast({
        title: translateApiError(err, t, t("errors.onboarding.create_vendor_failed")),
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const isDark = themeMode === "dark";

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <div className="flex-1 flex items-center justify-center px-6 py-12 lg:px-16 relative overflow-hidden" style={{ backgroundColor: isDark ? NAV_PANE_DARK_BG : "#ffffff" }}>
        <NavPaneHalftoneBackground enabled={isDark} variant="auth" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/8 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/8 to-transparent pointer-events-none" />
        <div className="absolute top-4 right-4 z-20">
          <LanguageToggle variant={isDark ? "dark" : "light"} />
        </div>
        <div className="absolute top-4 left-4 z-20">
          <DarkLightToggle mode={themeMode} onChange={setThemeMode} variant={isDark ? "dark" : "light"} />
        </div>
        <div className="w-full max-w-md relative z-10">
          <div className="flex flex-col items-start mb-8">
            <img src={vndrlyLogo} alt="VNDRLY Logo" className="w-16 h-16 rounded-xl mb-3" draggable={false} />
            <div className="flex items-center gap-3">
              <img src={backIcon} alt="Back" className="w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity" draggable={false} onClick={() => navigate("/signup")} data-testid="button-back" />
              <h1 className={cn("text-2xl font-bold tracking-tight", isDark ? "text-white" : "text-gray-900")}>Vendor Onboarding</h1>
            </div>
            <p className={cn("text-sm mt-1", isDark ? "text-gray-300" : "text-gray-500")}>Tell us about your company to get started.</p>
          </div>

          <div className={`border-2 rounded-xl p-6 shadow-xl transition-colors duration-300 ${formReady ? "border-amber-500" : "border-gray-300"}`}>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-gray-700">Company Name *</Label>
                <Input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Precision Drilling" className="h-10" data-testid="signup-input-name" />
                {matches.length > 0 && (
                  <div
                    role="alert"
                    data-testid="vendor-signup-duplicate-warning"
                    className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-medium">
                          This name looks similar to an existing vendor — please contact us first.
                        </p>
                        <ul className="space-y-0.5">
                          {matches.map((m) => (
                            <li key={m.name}>Did you mean {m.name}?</li>
                          ))}
                        </ul>
                        <label className="mt-1 flex items-center gap-2 text-amber-900">
                          <Checkbox
                            data-testid="vendor-signup-confirm-different"
                            checked={confirmDifferent}
                            onCheckedChange={(c) => setConfirmDifferent(c === true)}
                          />
                          <span>
                            I'm sure this is a different vendor — create it anyway.
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                {matchesLoading && matches.length === 0 && trimmedName.length >= 3 && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="vendor-signup-match-loading">
                    Checking for similar vendors…
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">Contact Name *</Label>
                <Input value={form.contactName} onChange={(e) => update("contactName", e.target.value)} placeholder="Full name" className="h-10" data-testid="signup-input-contact-name" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">Contact Email *</Label>
                <Input type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} placeholder="email@company.com" className="h-10" data-testid="signup-input-contact-email" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">Contact Phone</Label>
                <Input value={form.contactPhone} onChange={(e) => update("contactPhone", handlePhoneInput(e.target.value))} placeholder="(555) 123-4567" className="h-10" data-testid="signup-input-contact-phone" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">Physical Address</Label>
                <Input value={form.physicalAddress} onChange={(e) => update("physicalAddress", e.target.value)} placeholder="Street, City, State, ZIP" className="h-10" data-testid="signup-input-physical-address" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">Billing Address</Label>
                <Input value={form.billingAddress} onChange={(e) => update("billingAddress", e.target.value)} placeholder="Same as physical or different" className="h-10" data-testid="signup-input-billing-address" />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">Brand Colors</Label>
                <p className="text-xs text-gray-500">Used on printable visitor sign-in posters and other branded outputs. You can change these later.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-gray-500">Primary</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={form.brandPrimaryColor || "#000000"}
                        onChange={(e) => update("brandPrimaryColor", e.target.value)}
                        className="h-10 w-12 rounded border border-input cursor-pointer"
                        data-testid="signup-input-brand-primary-color-picker"
                      />
                      <Input
                        value={form.brandPrimaryColor}
                        onChange={(e) => update("brandPrimaryColor", e.target.value)}
                        placeholder="#f59e0b"
                        className="h-10 flex-1"
                        data-testid="signup-input-brand-primary-color"
                      />
                    </div>
                    {form.brandPrimaryColor && getContrastWarning(form.brandPrimaryColor) && (
                      <p
                        className="mt-1 text-xs text-amber-600"
                        data-testid="signup-warning-brand-primary-contrast"
                      >
                        {getContrastWarning(form.brandPrimaryColor)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500">Accent (optional)</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={form.brandAccentColor || "#000000"}
                        onChange={(e) => update("brandAccentColor", e.target.value)}
                        className="h-10 w-12 rounded border border-input cursor-pointer"
                        data-testid="signup-input-brand-accent-color-picker"
                      />
                      <Input
                        value={form.brandAccentColor}
                        onChange={(e) => update("brandAccentColor", e.target.value)}
                        placeholder="#1f7ae0"
                        className="h-10 flex-1"
                        data-testid="signup-input-brand-accent-color"
                      />
                    </div>
                    {form.brandAccentColor && getContrastWarning(form.brandAccentColor) && (
                      <p
                        className="mt-1 text-xs text-amber-600"
                        data-testid="signup-warning-brand-accent-contrast"
                      >
                        {getContrastWarning(form.brandAccentColor)}
                      </p>
                    )}
                  </div>
                </div>
                {form.brandPrimaryColor && form.brandAccentColor && getColorPairWarning(form.brandPrimaryColor, form.brandAccentColor) && (
                  <p
                    className="text-xs text-amber-600"
                    data-testid="signup-warning-brand-color-pair"
                  >
                    {getColorPairWarning(form.brandPrimaryColor, form.brandAccentColor)}
                  </p>
                )}
              </div>
              <div className="pt-2">
                {formReady ? (
                  <PngPillButton color="amber"
                    type="submit"
                    disabled={saving || checkPending || blockedByDuplicate}
                    className="w-full h-11"
                    data-testid="button-submit-signup"
                  >
                    {saving ? "Creating Account..." : "Create Vendor Account"}
                  </PngPillButton>
                ) : (
                  <PngPillButton type="submit" disabled className="w-full h-11" data-testid="button-submit-signup">
                    Create Vendor Account
                  </PngPillButton>
                )}
              </div>
            </form>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-500 text-center">
              <a href="/signup" className="font-semibold text-amber-600 hover:text-amber-700 underline underline-offset-2" onClick={(e) => { e.preventDefault(); navigate("/signup"); }}>
                Back to account type selection
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="hidden lg:block w-[3px] bg-amber-500 shrink-0" />

      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        <img src="/vndrly-background.jpg" alt="Oil field operations" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-gray-900/30 to-transparent" />
        <div className="relative z-10 flex items-end justify-center p-12 w-full h-full">
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-8 max-w-md border-2 border-amber-500">
            <h2 className="text-xl font-bold text-white mb-2">Vendor Benefits</h2>
            <p className="text-sm text-white/85 leading-relaxed">
              Manage your field employees, track work orders in real-time, and streamline communication with your Partners — all from one platform.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
