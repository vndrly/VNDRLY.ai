import { PngPillButton } from "@/components/png-pill-rollover";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Checkbox } from "@/components/ui/checkbox";
import BlueButton from "@/components/blue-button";
import GreyButton from "@/components/grey-button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";
import OnboardingStepper, { type StepperStep } from "@/components/onboarding-stepper";
import OnboardingVerificationBanner from "@/components/onboarding-verification-banner";
import LanguageToggle from "@/components/language-toggle";
import { onboardingApi } from "@/lib/onboarding-api";
import { handlePhoneInput, stripPhone } from "@/lib/utils";

type StepKey =
  | "company-basics"
  | "branding"
  | "first-site"
  | "tax-billing"
  | "preferences"
  | "invite-team";

const STEPS: (StepperStep & { key: StepKey })[] = [
  { key: "company-basics", label: "Company Basics" },
  { key: "branding", label: "Branding" },
  { key: "first-site", label: "First Site" },
  { key: "tax-billing", label: "Tax & Billing" },
  { key: "preferences", label: "Preferences" },
  { key: "invite-team", label: "Invite Team" },
];

// Per spec: brand colors+logo, first site, and tax IDs are
// "must-haves" — the wizard cannot finish without them. Operating
// preferences (hours, radius) and inviting the rest of the team are
// "should-haves" — skipping them adds the step to the dashboard's
// Finish-setup widget so the partner admin can finish later.
// Only the account-creation step is required up-front. Every step
// after that may be skipped so the user can quit and finish later
// from the dashboard's Finish-setup widget. Required data is still
// enforced at /complete time (the user can't actually finalise
// onboarding without it), but they're free to walk away in between.
const REQUIRED_STEPS = new Set<StepKey>(["company-basics"]);

interface PartnerPayload {
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  // Two logos, both must-have per spec: horizontal renders in the
  // sidebar and ticket headers, square renders in 64×64 favicons and
  // the visitor-portal poster.
  logoUrl?: string;
  logoSquareUrl?: string;
  firstSite?: { name?: string; address?: string; siteCode?: string; siteRadiusMeters?: number };
  taxBilling?: { federalTaxId?: string; stateTaxId?: string; physicalAddress?: string; billingAddress?: string };
  // Should-have operating preferences (hours-of-operation copy on the
  // visitor portal + default vendor-matching radius).
  preferences?: { hoursOfOperation?: string; operatingRadiusMiles?: number };
  inviteEmails?: string[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function OnboardingPartner() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const { toast } = useToast();

  // Wizard-wide context: orgId comes back from step 1.
  const [orgId, setOrgId] = useState<number | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [payload, setPayload] = useState<PartnerPayload>({});
  const [loading, setLoading] = useState(false);
  // Email verification state — captured from /onboarding/me. The
  // banner renders only when the user has an account (post-step-1)
  // and is unverified.
  const [verification, setVerification] = useState<{
    email: string | null;
    emailVerifiedAt: string | null;
  } | null>(null);

  // Step 1 form state.
  const [basics, setBasics] = useState({
    name: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    password: "",
    confirm: "",
  });

  // Fuzzy duplicate-name check via the public /partners/check-name
  // endpoint. Mirrors the warning on artifacts/vndrly/src/pages/
  // signup-partner.tsx so a partner whose company is already in the
  // system is warned to contact us before the wizard creates a
  // duplicate org row in submitBasics → onboardingApi.startPartner.
  const [nameMatches, setNameMatches] = useState<{ name: string; score: number }[]>([]);
  const [nameMatchesLoading, setNameMatchesLoading] = useState(false);
  // The name the most recent check resolved for; gates submitBasics so
  // a fast Enter can't slip through before the debounced check fires.
  const [checkedName, setCheckedName] = useState<string | null>("");
  const [confirmDifferentPartner, setConfirmDifferentPartner] = useState(false);

  // Step 2 — Branding. Both logos are spec must-haves.
  const [branding, setBranding] = useState({
    brandPrimaryColor: "",
    brandAccentColor: "",
    logoUrl: "" as string,
    logoSquareUrl: "" as string,
  });

  // Step 3 — First site.
  const [firstSite, setFirstSite] = useState({ name: "", address: "", siteCode: "", siteRadiusMeters: 1609 });

  // Step 4 — Tax & billing. Spec calls out federal AND state IDs and
  // BOTH a physical and billing address.
  const [taxBilling, setTaxBilling] = useState({ federalTaxId: "", stateTaxId: "", physicalAddress: "", billingAddress: "" });

  // Step 5 — Operating preferences (should-have).
  const [preferences, setPreferences] = useState({ hoursOfOperation: "", operatingRadiusMiles: "" });

  // Step 6 — Invite team.
  const [inviteText, setInviteText] = useState("");

  const currentStep = STEPS[stepIndex];

  // Resume an in-flight wizard if the user hits the URL while already
  // signed in (e.g. closed the tab and came back). Re-hydrate every
  // step's local form state from the saved payload so users don't see
  // blank fields after resuming.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await onboardingApi.getMine();
        if (cancelled) return;
        // Capture verification state so the banner above the wizard
        // can render even when there's no progress row yet (defensive).
        if (me.user) setVerification(me.user);
        // Already-onboarded redirect: if the signed-in partner has
        // finished the wizard AND has no skipped should-have steps,
        // send them straight to the dashboard. If they still have
        // skipped items, allow re-entry so the dashboard's
        // Finish-setup widget deep-links back here to fill them in.
        if (me.progress?.completedAt && (me.progress.skippedSteps?.length ?? 0) === 0) {
          window.location.assign(`${BASE}/`);
          return;
        }
        if (!me.progress || me.progress.orgType !== "partner") return;
        // Deep-link support: ?step=<key> wins over the persisted
        // currentStep so the dashboard's Finish-setup widget can jump
        // straight to a skipped should-have step.
        const params = new URLSearchParams(window.location.search);
        const stepParam = params.get("step");
        const overrideIdx = stepParam ? STEPS.findIndex((s) => s.key === stepParam) : -1;
        const idx = overrideIdx !== -1 ? overrideIdx : STEPS.findIndex((s) => s.key === me.progress!.currentStep);
        setOrgId(me.progress.partnerId ?? null);
        setStepIndex(idx === -1 ? 1 : idx);
        setCompleted(me.progress.completedSteps ?? []);
        setSkipped(me.progress.skippedSteps ?? []);
        const p = (me.progress.payload ?? {}) as PartnerPayload;
        setPayload(p);
        if (p.brandPrimaryColor || p.brandAccentColor || p.logoUrl || p.logoSquareUrl) {
          setBranding({
            brandPrimaryColor: p.brandPrimaryColor ?? "",
            brandAccentColor: p.brandAccentColor ?? "",
            logoUrl: p.logoUrl ?? "",
            logoSquareUrl: p.logoSquareUrl ?? "",
          });
        }
        if (p.firstSite) {
          setFirstSite({
            name: p.firstSite.name ?? "",
            address: p.firstSite.address ?? "",
            siteCode: p.firstSite.siteCode ?? "",
            siteRadiusMeters: typeof p.firstSite.siteRadiusMeters === "number" ? p.firstSite.siteRadiusMeters : 1609,
          });
        }
        if (p.taxBilling) {
          setTaxBilling({
            federalTaxId: p.taxBilling.federalTaxId ?? "",
            stateTaxId: p.taxBilling.stateTaxId ?? "",
            physicalAddress: p.taxBilling.physicalAddress ?? "",
            billingAddress: p.taxBilling.billingAddress ?? "",
          });
        }
        if (p.preferences) {
          setPreferences({
            hoursOfOperation: p.preferences.hoursOfOperation ?? "",
            operatingRadiusMiles:
              typeof p.preferences.operatingRadiusMiles === "number"
                ? String(p.preferences.operatingRadiusMiles)
                : "",
          });
        }
        if (p.inviteEmails && p.inviteEmails.length > 0) {
          setInviteText(p.inviteEmails.join(", "));
        }
      } catch {
        // Not authenticated yet — that's the normal first-visit flow.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced fuzzy lookup for the Step 1 Company Name input. Only
  // runs while the user is still on the anonymous step-1 view (no
  // orgId yet) — once the account exists we've already won the
  // duplicate race so further keystrokes don't need to hit the public
  // endpoint. AbortController prevents stale responses from
  // overwriting state for a newer name.
  useEffect(() => {
    if (orgId) {
      // Clear any stale state once the account exists.
      setNameMatches([]);
      setNameMatchesLoading(false);
      setCheckedName(basics.name.trim());
      setConfirmDifferentPartner(false);
      return;
    }
    const trimmed = basics.name.trim();
    setConfirmDifferentPartner(false);
    if (trimmed.length < 3) {
      setNameMatches([]);
      setNameMatchesLoading(false);
      setCheckedName(trimmed);
      return;
    }
    setCheckedName(null);
    setNameMatchesLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `${BASE}/api/partners/check-name?name=${encodeURIComponent(trimmed)}`,
          { credentials: "include", signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setNameMatches([]);
          setCheckedName(null);
          return;
        }
        const data = (await res.json()) as { matches?: { name: string; score: number }[] };
        if (controller.signal.aborted) return;
        setNameMatches(Array.isArray(data.matches) ? data.matches : []);
        setCheckedName(trimmed);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setNameMatches([]);
        setCheckedName(null);
      } finally {
        if (!controller.signal.aborted) setNameMatchesLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [basics.name, orgId]);

  const trimmedBasicsName = basics.name.trim();
  const namePending =
    !orgId &&
    trimmedBasicsName.length >= 3 &&
    (nameMatchesLoading || checkedName !== trimmedBasicsName);
  const namePassesDuplicateCheck =
    orgId !== null || nameMatches.length === 0 || confirmDifferentPartner;

  const persist = async (next: {
    currentStep?: StepKey;
    completedKey?: StepKey;
    skippedKey?: StepKey;
    payloadPatch?: Partial<PartnerPayload>;
  }) => {
    if (!orgId) return;
    const newCompleted = next.completedKey
      ? Array.from(new Set([...completed, next.completedKey]))
      : completed;
    // When a step transitions from skipped → completed, drop it from
    // skipped so the dashboard's Finish-setup widget stops showing it
    // as outstanding.
    const skippedAfterRemoval = next.completedKey
      ? skipped.filter((s) => s !== next.completedKey)
      : skipped;
    const newSkipped = next.skippedKey
      ? Array.from(new Set([...skippedAfterRemoval, next.skippedKey]))
      : skippedAfterRemoval;
    const newPayload = next.payloadPatch ? { ...payload, ...next.payloadPatch } : payload;
    setCompleted(newCompleted);
    setSkipped(newSkipped);
    setPayload(newPayload);
    await onboardingApi.updateProgress("partner", orgId, {
      currentStep: next.currentStep ?? currentStep.key,
      completedSteps: newCompleted,
      skippedSteps: newSkipped,
      payload: newPayload as Record<string, unknown>,
    });
  };

  // ─── Step 1: create the account ─────────────────────────────────
  const submitBasics = async () => {
    if (!basics.name.trim() || !basics.contactName.trim() || !basics.contactEmail.trim()) {
      toast({ title: "Please fill in name, contact, and email.", variant: "destructive" });
      return;
    }
    const phoneDigits = stripPhone(basics.contactPhone);
    if (!phoneDigits) {
      toast({ title: "Contact phone is required.", variant: "destructive" });
      return;
    }
    if (basics.password.length < 8) {
      toast({ title: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (basics.password !== basics.confirm) {
      toast({ title: "Passwords do not match.", variant: "destructive" });
      return;
    }
    // Duplicate-name guard: don't let a fast Enter race past the
    // debounced /partners/check-name lookup, and require explicit
    // confirmation when the lookup matched an existing partner.
    if (namePending) {
      toast({ title: "Checking for similar partners…" });
      return;
    }
    if (!namePassesDuplicateCheck) {
      toast({
        title: "Please confirm this is a different partner before continuing.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const resp = await onboardingApi.startPartner({
        name: basics.name.trim(),
        contactName: basics.contactName.trim(),
        contactEmail: basics.contactEmail.trim(),
        contactPhone: phoneDigits,
        password: basics.password,
      });
      setOrgId(resp.orgId);
      setCompleted(["company-basics"]);
      setStepIndex(1);
      await onboardingApi.updateProgress("partner", resp.orgId, {
        currentStep: "branding",
        completedSteps: ["company-basics"],
      });
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ─── Logo upload (step 2) ───────────────────────────────────────
  // Same upload pipeline for both logos; the `slot` arg picks which
  // branding field gets the resulting URL.
  const uploadLogo = async (file: File, slot: "horizontal" | "square") => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/storage/uploads/request-url`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!r.ok) throw new Error("Could not get upload URL");
      const { uploadURL, objectPath } = (await r.json()) as { uploadURL: string; objectPath: string };
      const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error("Upload failed");
      const fin = await fetch(`${BASE}/api/storage/uploads/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL, visibility: "public" }),
      });
      if (!fin.ok) throw new Error("Finalize failed");
      const { objectPath: finalPath } = (await fin.json()) as { objectPath: string };
      const path = finalPath || objectPath;
      const finalUrl = path.startsWith("/") ? `${BASE}/api/storage${path}` : path;
      setBranding((b) => slot === "square" ? { ...b, logoSquareUrl: finalUrl } : { ...b, logoUrl: finalUrl });
      toast({ title: slot === "square" ? "Square logo uploaded." : "Horizontal logo uploaded." });
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ─── Per-step required-field validation ─────────────────────────
  const validateCurrentStep = (): string | null => {
    switch (currentStep.key) {
      case "branding":
        if (!branding.brandPrimaryColor.trim() || !branding.brandAccentColor.trim()) {
          return "Pick a primary and an accent color.";
        }
        if (!branding.logoUrl.trim()) {
          return "Upload your horizontal logo to continue.";
        }
        if (!branding.logoSquareUrl.trim()) {
          return "Upload your square logo to continue.";
        }
        return null;
      case "first-site":
        if (!firstSite.name.trim() || !firstSite.address.trim() || !firstSite.siteCode.trim()) {
          return "Site name, address, and site code are all required.";
        }
        if (!Number.isFinite(firstSite.siteRadiusMeters) || firstSite.siteRadiusMeters <= 0) {
          return "Site radius must be a positive number of meters.";
        }
        return null;
      case "tax-billing":
        if (!taxBilling.federalTaxId.trim() || !taxBilling.stateTaxId.trim()) {
          return "Federal and state tax IDs are required.";
        }
        if (!taxBilling.physicalAddress.trim()) {
          return "A physical address is required.";
        }
        if (!taxBilling.billingAddress.trim()) {
          return "A billing address is required.";
        }
        return null;
      default:
        return null;
    }
  };

  // ─── Generic step navigation ────────────────────────────────────
  const nextStep = async (extras?: { payloadPatch?: Partial<PartnerPayload> }) => {
    const err = validateCurrentStep();
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await persist({
        currentStep: STEPS[stepIndex + 1].key,
        completedKey: currentStep.key as StepKey,
        payloadPatch: extras?.payloadPatch,
      });
      setStepIndex((i) => i + 1);
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Helper that mirrors the per-step payload patch the Continue
  // button builds. Used by both nextStep callers (the green button)
  // AND by Save & Quit so the user's in-progress edits don't get
  // dropped on the way out.
  const currentStepPatch = (): Partial<PartnerPayload> => {
    const patch: Partial<PartnerPayload> = {};
    if (currentStep.key === "branding") {
      patch.brandPrimaryColor = branding.brandPrimaryColor || undefined;
      patch.brandAccentColor = branding.brandAccentColor || undefined;
      patch.logoUrl = branding.logoUrl || undefined;
      patch.logoSquareUrl = branding.logoSquareUrl || undefined;
    } else if (currentStep.key === "first-site") {
      patch.firstSite = firstSite;
    } else if (currentStep.key === "tax-billing") {
      patch.taxBilling = taxBilling;
    } else if (currentStep.key === "preferences") {
      const radius = Number(preferences.operatingRadiusMiles);
      patch.preferences = {
        hoursOfOperation: preferences.hoursOfOperation.trim() || undefined,
        operatingRadiusMiles:
          Number.isFinite(radius) && radius > 0 ? Math.round(radius) : undefined,
      };
    } else if (currentStep.key === "invite-team") {
      patch.inviteEmails = inviteEmails;
    }
    return patch;
  };

  // Save & Quit: persists whatever the user has typed into the
  // *current* step (without marking it complete), then sends them to
  // the dashboard. Per spec, every post-step-1 step is optional —
  // they can finish later from the Finish-setup widget.
  const saveAndQuit = async () => {
    if (!orgId) {
      // No account yet (still on step 1) — nothing to save; just bail.
      window.location.assign(`${BASE}/`);
      return;
    }
    setLoading(true);
    try {
      await persist({ payloadPatch: currentStepPatch() });
      window.location.assign(`${BASE}/`);
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const skipStep = async () => {
    // Defense in depth: the button is hidden on required steps, but
    // never let a refactor accidentally let a required step be skipped.
    if (REQUIRED_STEPS.has(currentStep.key as StepKey)) {
      toast({ title: "This step is required.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const isLast = stepIndex === STEPS.length - 1;
      if (isLast) {
        // Last-step skip is "skip + quit": persist this step as
        // skipped and exit to the dashboard. Do NOT call /complete —
        // earlier optional sections may still be empty and the user
        // can resume later from the Finish-setup widget.
        await persist({
          payloadPatch: currentStepPatch(),
          skippedKey: currentStep.key as StepKey,
        });
        window.location.assign(`${BASE}/`);
        return;
      }
      await persist({ currentStep: STEPS[stepIndex + 1].key, skippedKey: currentStep.key as StepKey });
      setStepIndex((i) => i + 1);
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const finish = async (extras?: { payloadPatch?: Partial<PartnerPayload>; skipCurrent?: boolean }) => {
    if (!orgId) return;
    setLoading(true);
    try {
      // Persist whatever the user filled (or skipped) on the *current*
      // last step. Done inline rather than via nextStep() because there
      // is no `STEPS[stepIndex + 1]` to advance to.
      const completedKey = extras?.skipCurrent ? undefined : (currentStep.key as StepKey);
      const skippedKey = extras?.skipCurrent ? (currentStep.key as StepKey) : undefined;
      await persist({
        currentStep: currentStep.key as StepKey,
        completedKey,
        skippedKey,
        payloadPatch: extras?.payloadPatch,
      });
      await onboardingApi.complete("partner", orgId);
      toast({ title: "Welcome aboard!" });
      // Hard navigation so the auth provider re-fetches /api/auth/me
      // and picks up the fresh signup session cookie.
      window.location.assign(`${BASE}/`);
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const prevStep = () => setStepIndex((i) => Math.max(0, i - 1));

  const inviteEmails = useMemo(
    () =>
      inviteText
        .split(/[\s,;]+/)
        .map((e) => e.trim())
        .filter((e) => e.includes("@")),
    [inviteText],
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 relative">
      <div className="absolute top-4 right-4 z-20">
        <LanguageToggle variant="light" />
      </div>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <img src={vndrlyLogo} alt="VNDRLY" className="w-12 h-12 rounded-lg" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Partner Onboarding</h1>
            <p className="text-sm text-gray-500">Get your team set up in 5 quick steps.</p>
          </div>
        </div>

        {/* Email-verification banner — appears once an account
            exists. Hidden on the anonymous step-1 visit so it doesn't
            confuse first-time signups. */}
        {orgId && verification && (
          <OnboardingVerificationBanner
            email={verification.email}
            emailVerifiedAt={verification.emailVerifiedAt}
          />
        )}

        <div className="bg-white rounded-xl border-2 border-gray-200 shadow-sm p-6">
          <OnboardingStepper
            steps={STEPS}
            currentIndex={stepIndex}
            completedKeys={completed}
            skippedKeys={skipped}
            className="mb-8"
          />

          {currentStep.key === "company-basics" && (
            <div className="space-y-4" data-testid="step-company-basics-body">
              <h2 className="text-lg font-semibold text-gray-900">Tell us about your company</h2>
              <div>
                <Label>Company Name *</Label>
                <Input value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} placeholder="e.g. Exxon Energy" data-testid="input-company-name" />
                {!orgId && nameMatches.length > 0 && (
                  <div
                    role="alert"
                    data-testid="partner-onboarding-duplicate-warning"
                    className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-medium">
                          This name looks similar to an existing partner — please contact us first.
                        </p>
                        <ul className="space-y-0.5">
                          {nameMatches.map((m) => (
                            <li key={m.name}>Did you mean {m.name}?</li>
                          ))}
                        </ul>
                        <label className="mt-1 flex items-center gap-2 text-amber-900">
                          <Checkbox
                            data-testid="partner-onboarding-confirm-different"
                            checked={confirmDifferentPartner}
                            onCheckedChange={(c) => setConfirmDifferentPartner(c === true)}
                          />
                          <span>
                            I'm sure this is a different partner — create it anyway.
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                {!orgId && nameMatchesLoading && nameMatches.length === 0 && trimmedBasicsName.length >= 3 && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="partner-onboarding-match-loading">
                    Checking for similar partners…
                  </p>
                )}
              </div>
              <div>
                <Label>Your Name *</Label>
                <Input value={basics.contactName} onChange={(e) => setBasics({ ...basics, contactName: e.target.value })} placeholder="Full name" data-testid="input-contact-name" />
              </div>
              <div>
                <Label>Email *</Label>
                <Input type="email" value={basics.contactEmail} onChange={(e) => setBasics({ ...basics, contactEmail: e.target.value })} placeholder="email@company.com" data-testid="input-contact-email" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={basics.contactPhone} onChange={(e) => setBasics({ ...basics, contactPhone: handlePhoneInput(e.target.value) })} placeholder="(555) 123-4567" data-testid="input-contact-phone" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Password *</Label>
                  <Input type="password" value={basics.password} onChange={(e) => setBasics({ ...basics, password: e.target.value })} data-testid="input-password" />
                </div>
                <div>
                  <Label>Confirm *</Label>
                  <Input type="password" value={basics.confirm} onChange={(e) => setBasics({ ...basics, confirm: e.target.value })} data-testid="input-password-confirm" />
                </div>
              </div>
              <p className="text-xs text-gray-500">8 characters minimum. You'll sign in with this email and password.</p>
            </div>
          )}

          {currentStep.key === "branding" && (
            <div className="space-y-4" data-testid="step-branding-body">
              <h2 className="text-lg font-semibold text-gray-900">Make it yours</h2>
              <p className="text-sm text-gray-500">Logos and colors appear on visitor sign-in posters and printable docs.</p>
              <div>
                <Label>Horizontal logo *</Label>
                <p className="text-xs text-gray-500 mb-1">Used in the sidebar and ticket headers.</p>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0], "horizontal")}
                    data-testid="input-logo"
                    className="text-sm"
                  />
                  {branding.logoUrl && <img src={branding.logoUrl} alt="logo preview" className="h-12 max-w-[160px] object-contain border rounded" />}
                </div>
              </div>
              <div>
                <Label>Square logo *</Label>
                <p className="text-xs text-gray-500 mb-1">Used in 64×64 favicons and the visitor portal poster.</p>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0], "square")}
                    data-testid="input-logo-square"
                    className="text-sm"
                  />
                  {branding.logoSquareUrl && <img src={branding.logoSquareUrl} alt="square logo preview" className="h-12 w-12 object-contain border rounded" />}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Primary color *</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={branding.brandPrimaryColor || "#1f7ae0"} onChange={(e) => setBranding({ ...branding, brandPrimaryColor: e.target.value })} className="h-10 w-12 rounded border cursor-pointer" data-testid="input-brand-primary-picker" />
                    <Input value={branding.brandPrimaryColor} onChange={(e) => setBranding({ ...branding, brandPrimaryColor: e.target.value })} placeholder="#1f7ae0" data-testid="input-brand-primary" />
                  </div>
                </div>
                <div>
                  <Label>Accent color *</Label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={branding.brandAccentColor || "#f59e0b"} onChange={(e) => setBranding({ ...branding, brandAccentColor: e.target.value })} className="h-10 w-12 rounded border cursor-pointer" data-testid="input-brand-accent-picker" />
                    <Input value={branding.brandAccentColor} onChange={(e) => setBranding({ ...branding, brandAccentColor: e.target.value })} placeholder="#f59e0b" data-testid="input-brand-accent" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep.key === "first-site" && (
            <div className="space-y-4" data-testid="step-first-site-body">
              <h2 className="text-lg font-semibold text-gray-900">Add your first site</h2>
              <p className="text-sm text-gray-500">Every partner needs at least one site so you can dispatch tickets and run reports.</p>
              <div>
                <Label>Site name *</Label>
                <Input value={firstSite.name} onChange={(e) => setFirstSite({ ...firstSite, name: e.target.value })} placeholder="e.g. Permian Site #4" data-testid="input-site-name" />
              </div>
              <div>
                <Label>Address *</Label>
                <Input value={firstSite.address} onChange={(e) => setFirstSite({ ...firstSite, address: e.target.value })} placeholder="Street, City, State, ZIP" data-testid="input-site-address" />
              </div>
              <div>
                <Label>Site code *</Label>
                <Input value={firstSite.siteCode} onChange={(e) => setFirstSite({ ...firstSite, siteCode: e.target.value })} placeholder="Short identifier (used in QR codes)" data-testid="input-site-code" />
              </div>
              <div>
                <Label>Geofence radius (meters) *</Label>
                <Input
                  type="number"
                  min={1}
                  value={firstSite.siteRadiusMeters}
                  onChange={(e) => setFirstSite({ ...firstSite, siteRadiusMeters: Number(e.target.value) })}
                  placeholder="152"
                  data-testid="input-site-radius"
                />
                <p className="text-xs text-gray-500 mt-1">Used by the mobile app for clock-in proximity. 152 m (~500 ft) is a sensible default.</p>
              </div>
            </div>
          )}

          {currentStep.key === "tax-billing" && (
            <div className="space-y-4" data-testid="step-tax-billing-body">
              <h2 className="text-lg font-semibold text-gray-900">Tax &amp; billing</h2>
              <p className="text-sm text-gray-500">Required so we can issue 1099s and route invoices correctly.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Federal Tax ID (EIN) *</Label>
                  <Input value={taxBilling.federalTaxId} onChange={(e) => setTaxBilling({ ...taxBilling, federalTaxId: e.target.value })} placeholder="XX-XXXXXXX" data-testid="input-federal-tax-id" />
                </div>
                <div>
                  <Label>State Tax ID *</Label>
                  <Input value={taxBilling.stateTaxId} onChange={(e) => setTaxBilling({ ...taxBilling, stateTaxId: e.target.value })} data-testid="input-state-tax-id" />
                </div>
              </div>
              <div>
                <Label>Physical address *</Label>
                <Textarea value={taxBilling.physicalAddress} onChange={(e) => setTaxBilling({ ...taxBilling, physicalAddress: e.target.value })} placeholder="Street, city, state, ZIP — your headquarters location" data-testid="input-physical-address" />
              </div>
              <div>
                <Label>Billing address *</Label>
                <Textarea value={taxBilling.billingAddress} onChange={(e) => setTaxBilling({ ...taxBilling, billingAddress: e.target.value })} placeholder="Where invoices should be mailed (use the same as physical if applicable)" data-testid="input-billing-address" />
              </div>
            </div>
          )}

          {currentStep.key === "preferences" && (
            <div className="space-y-4" data-testid="step-preferences-body">
              <h2 className="text-lg font-semibold text-gray-900">Operating preferences (optional)</h2>
              <p className="text-sm text-gray-500">Drives the visitor-portal copy and how we match nearby vendors. You can skip this and edit it later from the dashboard.</p>
              <div>
                <Label>Hours of operation</Label>
                <Textarea
                  value={preferences.hoursOfOperation}
                  onChange={(e) => setPreferences({ ...preferences, hoursOfOperation: e.target.value })}
                  placeholder="e.g. Mon–Fri 6am–6pm, Sat 8am–noon"
                  rows={3}
                  data-testid="input-hours-of-operation"
                />
              </div>
              <div>
                <Label>Default operating radius (miles)</Label>
                <Input
                  type="number"
                  min={1}
                  value={preferences.operatingRadiusMiles}
                  onChange={(e) => setPreferences({ ...preferences, operatingRadiusMiles: e.target.value })}
                  placeholder="50"
                  className="max-w-[180px]"
                  data-testid="input-operating-radius-miles"
                />
                <p className="text-xs text-gray-500 mt-1">How far from your sites you'll consider vendor matches.</p>
              </div>
            </div>
          )}

          {currentStep.key === "invite-team" && (
            <div className="space-y-4" data-testid="step-invite-team-body">
              <h2 className="text-lg font-semibold text-gray-900">Invite your team (optional)</h2>
              <p className="text-sm text-gray-500">Paste one or more email addresses (separated by commas, spaces, or new lines). They'll get an invite link to join your account.</p>
              <Textarea
                value={inviteText}
                onChange={(e) => setInviteText(e.target.value)}
                placeholder="alice@company.com, bob@company.com"
                rows={5}
                data-testid="input-invite-emails"
              />
              {inviteEmails.length > 0 && (
                <p className="text-sm text-gray-700">
                  {inviteEmails.length} email{inviteEmails.length === 1 ? "" : "s"} ready to invite.
                </p>
              )}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            <PillButton
              color="image"
              onClick={() => (stepIndex === 0 ? navigate("/signup") : prevStep())}
              disabled={loading}
              data-testid="button-back"
            >
              ← Back
            </PillButton>
            <div className="flex items-center gap-2">
              {stepIndex > 0 && !REQUIRED_STEPS.has(currentStep.key as StepKey) && (
                <PngPillButton onClick={skipStep} disabled={loading} data-testid="button-skip" className="px-4 h-10">
                  {t("onboardingActions.skipForNow")}
                </PngPillButton>
              )}
              {/* Save & Quit — only meaningful once an account exists.
                  Persists the current step's edits then sends the user
                  to the dashboard, where the Finish-setup widget
                  surfaces a Resume CTA. */}
              {stepIndex > 0 && (
                <PngPillButton
                  onClick={saveAndQuit}
                  disabled={loading}
                  data-testid="button-save-and-quit"
                  className="px-4 h-10"
                >
                  {t("onboardingActions.saveAndQuit")}
                </PngPillButton>
              )}
              {stepIndex === 0 ? (
                <PngPillButton color="blue"
                  onClick={submitBasics}
                  disabled={loading || namePending || !namePassesDuplicateCheck}
                  data-testid="button-create-account"
                  className="px-6 h-10"
                >
                  {loading ? "Creating…" : "Create account"}
                </PngPillButton>
              ) : stepIndex === STEPS.length - 1 ? (
                <PngPillButton color="blue"
                  onClick={() => finish({ payloadPatch: { inviteEmails } })}
                  disabled={loading}
                  data-testid="button-finish"
                  className="px-6 h-10"
                >
                  {loading ? "Finishing…" : "Finish setup"}
                </PngPillButton>
              ) : (
                <PngPillButton color="blue"
                  onClick={() => nextStep({ payloadPatch: currentStepPatch() })}
                  disabled={loading}
                  data-testid="button-next"
                  className="px-6 h-10"
                >
                  {loading ? "Saving…" : "Continue"}
                </PngPillButton>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-4">
          Step {stepIndex + 1} of {STEPS.length}. Your progress is saved automatically.
        </p>
      </div>
    </div>
  );
}
