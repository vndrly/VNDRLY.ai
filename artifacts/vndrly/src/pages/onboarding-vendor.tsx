import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Checkbox } from "@/components/ui/checkbox";
import OnboardingPillButton from "@/components/onboarding-pill-button";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";
import OnboardingStepper, { type StepperStep } from "@/components/onboarding-stepper";
import OnboardingVerificationBanner from "@/components/onboarding-verification-banner";
import LanguageToggle from "@/components/language-toggle";
import { onboardingApi } from "@/lib/onboarding-api";
import { handlePhoneInput, stripPhone } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

type StepKey =
  | "company-basics"
  | "tax-ids"
  | "work-types"
  | "compliance"
  | "rates"
  | "branding"
  | "first-employee";

// Spec'd vendor wizard. The first 6 steps are must-haves: a vendor cannot
// transact without tax IDs, work types, COI, rates, or a field employee.
// "Branding" (vendor brand color + logo) is a spec should-have that's
// skippable — skipping it adds it to the Finish-setup widget on the
// dashboard so the vendor can finish later from there.
const STEPS: (StepperStep & { key: StepKey })[] = [
  { key: "company-basics", label: "Account" },
  { key: "tax-ids", label: "Tax IDs" },
  { key: "work-types", label: "Service Area & Work Types" },
  { key: "compliance", label: "Compliance" },
  { key: "rates", label: "Rates & 1099" },
  { key: "branding", label: "Branding" },
  { key: "first-employee", label: "First Employee" },
];

// Required steps cannot be skipped — the Skip button is hidden for
// these. Anything not in this set may be skipped, in which case it
// goes onto the dashboard's Finish-setup checklist.
// Only the account-creation step is required up-front. Every step
// after that may be skipped so the user can quit and finish later
// from the dashboard's Finish-setup widget. Required data is still
// enforced at /complete time (the user can't actually finalise
// onboarding without it), but they're free to walk away in between.
const REQUIRED_STEPS = new Set<StepKey>(["company-basics"]);

interface VendorPayload {
  taxIds?: { federalTaxId?: string; stateTaxId?: string; physicalAddress?: string; billingAddress?: string };
  serviceArea?: { operatingRadiusMiles?: number };
  workTypeIds?: number[];
  compliance?: { carrier?: string; policyNumber?: string; expirationDate?: string; documentUrl?: string; coverageNotes?: string };
  rates?: { hourlyRate?: string; dailyOtHours?: string; weeklyOtHours?: string; overtimeMultiplier?: string };
  eDeliveryConsent?: boolean;
  branding?: { brandPrimaryColor?: string; logoUrl?: string };
  firstEmployee?: { firstName?: string; lastName?: string; email?: string; phone?: string };
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function OnboardingVendor() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [orgId, setOrgId] = useState<number | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [payload, setPayload] = useState<VendorPayload>({});
  const [loading, setLoading] = useState(false);
  const [workTypes, setWorkTypes] = useState<Array<{ id: number; name: string; category: string | null }>>([]);
  // Email verification state — captured from /onboarding/me. The
  // banner renders only when the user has an account (post-step-1)
  // and is unverified.
  const [verification, setVerification] = useState<{
    email: string | null;
    emailVerifiedAt: string | null;
  } | null>(null);

  const [basics, setBasics] = useState({
    name: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    password: "",
    confirm: "",
  });

  // Fuzzy duplicate-name check via the public /vendors/check-name
  // endpoint. Mirrors the warning on artifacts/vndrly-mobile/app/
  // signup-vendor.tsx so a vendor whose company is already in the
  // system is warned to contact us before the wizard creates a
  // duplicate org row in submitBasics → onboardingApi.startVendor.
  const [nameMatches, setNameMatches] = useState<{ name: string; score: number }[]>([]);
  const [nameMatchesLoading, setNameMatchesLoading] = useState(false);
  // The name the most recent check resolved for; gates submitBasics so
  // a fast Enter can't slip through before the debounced check fires.
  const [checkedName, setCheckedName] = useState<string | null>("");
  const [confirmDifferentVendor, setConfirmDifferentVendor] = useState(false);
  const [taxIds, setTaxIds] = useState({ federalTaxId: "", stateTaxId: "", physicalAddress: "", billingAddress: "" });
  const [selectedWtIds, setSelectedWtIds] = useState<number[]>([]);
  // Operating radius in miles. Used to auto-match the vendor to nearby
  // partner sites in the marketplace. Default 50 mi mirrors the
  // analogous setting in the legacy admin form.
  const [serviceRadius, setServiceRadius] = useState<string>("50");
  const [compliance, setCompliance] = useState({ carrier: "", policyNumber: "", expirationDate: "", documentUrl: "", coverageNotes: "" });
  const [rates, setRates] = useState({ hourlyRate: "", dailyOtHours: "8", weeklyOtHours: "40", overtimeMultiplier: "1.5" });
  // 1099 e-delivery consent is a tri-state in our payload (undefined =
  // not asked). The form forces a yes/no choice via radios so we save
  // an explicit boolean, never undefined.
  const [eDeliveryConsent, setEDeliveryConsent] = useState<boolean | undefined>(undefined);
  // Vendor branding (should-have): drives the in-app vendor portal
  // colour and the vendor logo on invoices. Both fields are optional;
  // skipping this step adds it to the dashboard's Finish-setup widget.
  const [vendorBranding, setVendorBranding] = useState({ brandPrimaryColor: "", logoUrl: "" });
  const [firstEmp, setFirstEmp] = useState({ firstName: "", lastName: "", email: "", phone: "" });

  const currentStep = STEPS[stepIndex];

  // Resume / already-onboarded redirect. If the signed-in vendor admin
  // has already finished onboarding, the wizard is a no-op for them —
  // bounce to the dashboard instead of letting them re-write canonical
  // data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await onboardingApi.getMine();
        if (cancelled) return;
        // Capture verification state so the banner above the wizard
        // can render even when there's no progress row yet (defensive).
        if (me.user) setVerification(me.user);
        // Already-onboarded redirect: only short-circuit when there
        // are no outstanding skipped steps. Otherwise allow re-entry
        // so the dashboard Finish-setup widget can deep-link back
        // here to complete a previously-skipped item.
        if (me.progress?.completedAt && (me.progress.skippedSteps?.length ?? 0) === 0) {
          window.location.assign(`${BASE}/`);
          return;
        }
        if (!me.progress || me.progress.orgType !== "vendor") return;
        // Deep-link support: ?step=<key> wins over the persisted
        // currentStep so the dashboard's Finish-setup widget can jump
        // straight to a skipped should-have step. Tolerate stale step
        // keys from earlier wizard versions by falling back to the
        // first incomplete step.
        const params = new URLSearchParams(window.location.search);
        const stepParam = params.get("step");
        const overrideIdx = stepParam ? STEPS.findIndex((s) => s.key === stepParam) : -1;
        const idx = overrideIdx !== -1 ? overrideIdx : STEPS.findIndex((s) => s.key === me.progress!.currentStep);
        setOrgId(me.progress.vendorId ?? null);
        setStepIndex(idx === -1 ? 1 : idx);
        setCompleted(me.progress.completedSteps ?? []);
        setSkipped(me.progress.skippedSteps ?? []);
        const p = (me.progress.payload ?? {}) as VendorPayload;
        setPayload(p);
        if (p.taxIds) {
          setTaxIds({
            federalTaxId: p.taxIds.federalTaxId ?? "",
            stateTaxId: p.taxIds.stateTaxId ?? "",
            physicalAddress: p.taxIds.physicalAddress ?? "",
            billingAddress: p.taxIds.billingAddress ?? "",
          });
        }
        if (Array.isArray(p.workTypeIds)) setSelectedWtIds(p.workTypeIds);
        if (p.serviceArea?.operatingRadiusMiles != null) {
          setServiceRadius(String(p.serviceArea.operatingRadiusMiles));
        }
        if (typeof p.eDeliveryConsent === "boolean") setEDeliveryConsent(p.eDeliveryConsent);
        if (p.compliance) {
          setCompliance({
            carrier: p.compliance.carrier ?? "",
            policyNumber: p.compliance.policyNumber ?? "",
            expirationDate: p.compliance.expirationDate ?? "",
            documentUrl: p.compliance.documentUrl ?? "",
            coverageNotes: p.compliance.coverageNotes ?? "",
          });
        }
        if (p.rates) {
          setRates({
            hourlyRate: p.rates.hourlyRate ?? "",
            dailyOtHours: p.rates.dailyOtHours ?? "8",
            weeklyOtHours: p.rates.weeklyOtHours ?? "40",
            overtimeMultiplier: p.rates.overtimeMultiplier ?? "1.5",
          });
        }
        if (p.branding) {
          setVendorBranding({
            brandPrimaryColor: p.branding.brandPrimaryColor ?? "",
            logoUrl: p.branding.logoUrl ?? "",
          });
        }
        if (p.firstEmployee) {
          setFirstEmp({
            firstName: p.firstEmployee.firstName ?? "",
            lastName: p.firstEmployee.lastName ?? "",
            email: p.firstEmployee.email ?? "",
            phone: p.firstEmployee.phone ?? "",
          });
        }
      } catch {
        // anonymous visitor — sit on step 1 (account creation)
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
      setConfirmDifferentVendor(false);
      return;
    }
    const trimmed = basics.name.trim();
    setConfirmDifferentVendor(false);
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
          `${BASE}/api/vendors/check-name?name=${encodeURIComponent(trimmed)}`,
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
    orgId !== null || nameMatches.length === 0 || confirmDifferentVendor;

  // Load work-types catalog the moment we have a session (i.e. after
  // signup). Failing softly is OK — the user can retry by reloading.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const wt = await onboardingApi.getWorkTypes();
        if (!cancelled) setWorkTypes(wt);
      } catch {
        // server may briefly 401 right after signup if cookie sync is
        // delayed; the user can refresh.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const persist = async (next: { currentStep?: StepKey; completedKey?: StepKey; payloadPatch?: Partial<VendorPayload> }) => {
    if (!orgId) return;
    const newCompleted = next.completedKey ? Array.from(new Set([...completed, next.completedKey])) : completed;
    // When a previously-skipped step is now completed, drop it from
    // the skipped list so the Finish-setup widget on the dashboard
    // stops nagging the user about it.
    const newSkipped = next.completedKey ? skipped.filter((s) => s !== next.completedKey) : skipped;
    const newPayload = next.payloadPatch ? { ...payload, ...next.payloadPatch } : payload;
    setCompleted(newCompleted);
    setSkipped(newSkipped);
    setPayload(newPayload);
    await onboardingApi.updateProgress("vendor", orgId, {
      currentStep: next.currentStep ?? currentStep.key,
      completedSteps: newCompleted,
      skippedSteps: newSkipped,
      payload: newPayload as Record<string, unknown>,
    });
  };

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
    // debounced /vendors/check-name lookup, and require explicit
    // confirmation when the lookup matched an existing vendor.
    if (namePending) {
      toast({ title: "Checking for similar vendors…" });
      return;
    }
    if (!namePassesDuplicateCheck) {
      toast({
        title: "Please confirm this is a different vendor before continuing.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const resp = await onboardingApi.startVendor({
        name: basics.name.trim(),
        contactName: basics.contactName.trim(),
        contactEmail: basics.contactEmail.trim(),
        contactPhone: phoneDigits,
        password: basics.password,
      });
      setOrgId(resp.orgId);
      setCompleted(["company-basics"]);
      setStepIndex(1);
      await onboardingApi.updateProgress("vendor", resp.orgId, {
        currentStep: "tax-ids",
        completedSteps: ["company-basics"],
      });
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const uploadDoc = async (file: File) => {
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
        body: JSON.stringify({ objectURL: uploadURL, visibility: "private" }),
      });
      if (!fin.ok) throw new Error("Finalize failed");
      const { objectPath: finalPath } = (await fin.json()) as { objectPath: string };
      const path = finalPath || objectPath;
      const finalUrl = path.startsWith("/") ? `${BASE}/api/storage${path}` : path;
      setCompliance((c) => ({ ...c, documentUrl: finalUrl }));
      toast({ title: "Document uploaded." });
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Per-step required-field validation. Returning a string short-
  // circuits navigation and surfaces the failure to the user.
  const validateCurrentStep = (): string | null => {
    switch (currentStep.key) {
      case "tax-ids":
        if (!taxIds.federalTaxId.trim() || !taxIds.stateTaxId.trim()) return "Federal and state tax IDs are required.";
        if (!taxIds.physicalAddress.trim() || !taxIds.billingAddress.trim()) return "Physical and billing addresses are required.";
        return null;
      case "work-types": {
        const r = Number(serviceRadius);
        if (!Number.isFinite(r) || r <= 0) return "Enter how far you'll travel for work (miles).";
        if (selectedWtIds.length === 0) return "Pick at least one work type.";
        return null;
      }
      case "compliance":
        if (!compliance.carrier.trim() || !compliance.policyNumber.trim()) return "Carrier and policy number are required.";
        if (!compliance.expirationDate.trim()) return "Expiration date is required.";
        if (!compliance.documentUrl.trim()) return "Upload a copy of your COI to continue.";
        return null;
      case "rates":
        if (!rates.hourlyRate.trim() || isNaN(Number(rates.hourlyRate))) return "Enter a baseline hourly rate.";
        if (!rates.dailyOtHours.trim() || isNaN(Number(rates.dailyOtHours))) return "Enter a daily OT threshold.";
        if (!rates.weeklyOtHours.trim() || isNaN(Number(rates.weeklyOtHours))) return "Enter a weekly OT threshold.";
        if (!rates.overtimeMultiplier.trim() || isNaN(Number(rates.overtimeMultiplier))) return "Enter an overtime multiplier.";
        if (eDeliveryConsent === undefined) return "Choose how you'd like to receive your 1099.";
        return null;
      case "first-employee":
        if (!firstEmp.firstName.trim() || !firstEmp.lastName.trim()) return "First and last name are required.";
        if (!firstEmp.email.trim()) return "Email is required.";
        return null;
      default:
        return null;
    }
  };

  const nextStep = async () => {
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
        payloadPatch: buildPayloadPatch(),
      });
      setStepIndex((i) => i + 1);
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
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
      await persist({ payloadPatch: buildPayloadPatch() });
      window.location.assign(`${BASE}/`);
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Skip the current (should-have) step. Persists `skippedSteps` so the
  // dashboard's Finish-setup widget can deep-link the vendor admin back
  // here later. Required steps are guarded server-side by
  // validateVendorPayload, so this also defends against a runaway client
  // calling skip on a hard-required key.
  const skipStep = async () => {
    if (REQUIRED_STEPS.has(currentStep.key as StepKey)) return;
    setLoading(true);
    try {
      const newSkipped = Array.from(new Set([...skipped, currentStep.key as StepKey]));
      setSkipped(newSkipped);
      const newPayload = payload;
      const isLast = stepIndex === STEPS.length - 1;
      // On the last step, "Skip" persists the skipped flag and quits
      // to the dashboard rather than advancing past the end. Earlier
      // optional sections may still be empty; do NOT call /complete.
      const nextStep = isLast ? currentStep.key : STEPS[stepIndex + 1].key;
      await onboardingApi.updateProgress("vendor", orgId!, {
        currentStep: nextStep,
        completedSteps: completed,
        skippedSteps: newSkipped,
        payload: newPayload as Record<string, unknown>,
      });
      if (isLast) {
        window.location.assign(`${BASE}/`);
        return;
      }
      setStepIndex((i) => i + 1);
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const finish = async () => {
    if (!orgId) return;
    const err = validateCurrentStep();
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      // Persist the final step's edits inline so the server-side
      // /complete validation sees a complete payload. Route through
      // persist() so the final step is also removed from skippedSteps
      // if it was previously skipped (paranoid edge: shouldn't happen
      // for required steps, but keeps state consistent on resume).
      await persist({
        completedKey: currentStep.key as StepKey,
        payloadPatch: buildPayloadPatch(),
      });
      await onboardingApi.complete("vendor", orgId);
      toast({ title: "Welcome aboard!" });
      window.location.assign(`${BASE}/`);
    } catch (e) {
      const msg = (e as Error).message;
      // Server returns "Required fields missing" with a list — show it
      // in plain English so the user knows where to go fix things.
      toast({ title: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const prevStep = () => setStepIndex((i) => Math.max(0, i - 1));

  const toggleWt = (id: number) =>
    setSelectedWtIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const buildPayloadPatch = useMemo<() => Partial<VendorPayload>>(() => {
    return () => {
      switch (currentStep.key) {
        case "tax-ids":
          return { taxIds };
        case "work-types":
          return {
            workTypeIds: selectedWtIds,
            serviceArea: { operatingRadiusMiles: Number(serviceRadius) },
          };
        case "compliance":
          return { compliance };
        case "rates":
          // Persist eDeliveryConsent as the literal user choice, not a
          // coercion. Coercing undefined → false would let an unset
          // value silently pass the server's `typeof boolean` check
          // and complete onboarding without explicit IRS consent.
          // The client-side step validation already blocks `undefined`,
          // so by the time we get here it should be a real boolean.
          return typeof eDeliveryConsent === "boolean"
            ? { rates, eDeliveryConsent }
            : { rates };
        case "branding":
          // Persist whatever the user has typed; an empty payload here
          // is fine because the Skip path explicitly goes through
          // skipStep() and adds the step to skippedSteps.
          return {
            branding: {
              brandPrimaryColor: vendorBranding.brandPrimaryColor.trim() || undefined,
              logoUrl: vendorBranding.logoUrl.trim() || undefined,
            },
          };
        case "first-employee":
          return { firstEmployee: firstEmp };
        default:
          return {};
      }
    };
  }, [currentStep.key, taxIds, selectedWtIds, serviceRadius, compliance, rates, eDeliveryConsent, vendorBranding, firstEmp]);

  // Group work-types by category so the picker is scannable instead of
  // a 60-item flat list.
  const wtByCategory = useMemo(() => {
    const groups = new Map<string, typeof workTypes>();
    for (const wt of workTypes) {
      const key = wt.category ?? "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(wt);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [workTypes]);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 relative">
      <div className="absolute top-4 right-4 z-20">
        <LanguageToggle variant="light" />
      </div>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <img src={vndrlyLogo} alt="VNDRLY" className="w-12 h-12 rounded-lg" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vendor Onboarding</h1>
            <p className="text-sm text-gray-500">A short setup flow so you can start taking work.</p>
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

        <Card><CardContent className="p-6 pt-6">
          <OnboardingStepper steps={STEPS} currentIndex={stepIndex} completedKeys={completed} skippedKeys={skipped} className="mb-8" />

          {currentStep.key === "company-basics" && (
            <div className="space-y-4" data-testid="step-company-basics-body">
              <h2 className="text-lg font-semibold text-gray-900">Tell us about your company</h2>
              <div>
                <Label>Company Name *</Label>
                <Input value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} placeholder="e.g. Smith Welding LLC" data-testid="input-company-name" />
                {!orgId && nameMatches.length > 0 && (
                  <div
                    role="alert"
                    data-testid="vendor-onboarding-duplicate-warning"
                    className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-medium">
                          This name looks similar to an existing vendor — please contact us first.
                        </p>
                        <ul className="space-y-0.5">
                          {nameMatches.map((m) => (
                            <li key={m.name}>Did you mean {m.name}?</li>
                          ))}
                        </ul>
                        <label className="mt-1 flex items-center gap-2 text-amber-900">
                          <Checkbox
                            data-testid="vendor-onboarding-confirm-different"
                            checked={confirmDifferentVendor}
                            onCheckedChange={(c) => setConfirmDifferentVendor(c === true)}
                          />
                          <span>
                            I'm sure this is a different vendor — create it anyway.
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                {!orgId && nameMatchesLoading && nameMatches.length === 0 && trimmedBasicsName.length >= 3 && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="vendor-onboarding-match-loading">
                    Checking for similar vendors…
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
              <p className="text-xs text-gray-500">8 characters minimum.</p>
            </div>
          )}

          {currentStep.key === "tax-ids" && (
            <div className="space-y-4" data-testid="step-tax-ids-body">
              <h2 className="text-lg font-semibold text-gray-900">Tax IDs &amp; addresses</h2>
              <p className="text-sm text-gray-500">Required so partners can issue 1099s and route invoices correctly.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Federal Tax ID (EIN) *</Label>
                  <Input value={taxIds.federalTaxId} onChange={(e) => setTaxIds({ ...taxIds, federalTaxId: e.target.value })} placeholder="XX-XXXXXXX" data-testid="input-federal-tax-id" />
                </div>
                <div>
                  <Label>State Tax ID *</Label>
                  <Input value={taxIds.stateTaxId} onChange={(e) => setTaxIds({ ...taxIds, stateTaxId: e.target.value })} data-testid="input-state-tax-id" />
                </div>
              </div>
              <div>
                <Label>Physical Address *</Label>
                <Textarea value={taxIds.physicalAddress} onChange={(e) => setTaxIds({ ...taxIds, physicalAddress: e.target.value })} placeholder="Street, city, state, ZIP" data-testid="input-physical-address" />
              </div>
              <div>
                <Label>Billing Address *</Label>
                <Textarea value={taxIds.billingAddress} onChange={(e) => setTaxIds({ ...taxIds, billingAddress: e.target.value })} placeholder="Where invoices should be sent from" data-testid="input-billing-address" />
              </div>
            </div>
          )}

          {currentStep.key === "work-types" && (
            <div className="space-y-3" data-testid="step-work-types-body">
              <h2 className="text-lg font-semibold text-gray-900">Service area &amp; work types</h2>
              <p className="text-sm text-gray-500">Tell us how far you'll travel and what work you do — partners use this to match you to nearby jobs.</p>
              <div>
                <Label>Operating radius (miles) *</Label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  value={serviceRadius}
                  onChange={(e) => setServiceRadius(e.target.value)}
                  data-testid="input-service-radius"
                  className="max-w-[160px]"
                />
                <p className="text-xs text-gray-500 mt-1">How far from your physical address you'll accept work.</p>
              </div>
              {workTypes.length === 0 ? (
                <p className="text-sm text-gray-400" data-testid="work-types-loading">Loading the work-types catalog…</p>
              ) : (
                <div className="space-y-4 max-h-[420px] overflow-y-auto pr-2">
                  {wtByCategory.map(([cat, items]) => (
                    <div key={cat}>
                      <p className="text-xs font-semibold uppercase text-gray-500 mb-1">{cat}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {items.map((wt) => (
                          <label
                            key={wt.id}
                            className="flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50"
                            data-testid={`work-type-option-${wt.id}`}
                          >
                            <Checkbox checked={selectedWtIds.includes(wt.id)} onCheckedChange={() => toggleWt(wt.id)} />
                            <span className="text-sm">{wt.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentStep.key === "compliance" && (
            <div className="space-y-4" data-testid="step-compliance-body">
              <h2 className="text-lg font-semibold text-gray-900">Insurance &amp; compliance</h2>
              <p className="text-sm text-gray-500">Upload a current Certificate of Insurance — partners require it before assigning work.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Carrier *</Label>
                  <Input value={compliance.carrier} onChange={(e) => setCompliance({ ...compliance, carrier: e.target.value })} placeholder="e.g. The Hartford" data-testid="input-insurance-carrier" />
                </div>
                <div>
                  <Label>Policy number *</Label>
                  <Input value={compliance.policyNumber} onChange={(e) => setCompliance({ ...compliance, policyNumber: e.target.value })} data-testid="input-insurance-policy" />
                </div>
              </div>
              <div>
                <Label>Expiration date *</Label>
                <Input type="date" value={compliance.expirationDate} onChange={(e) => setCompliance({ ...compliance, expirationDate: e.target.value })} data-testid="input-insurance-expiration" />
              </div>
              <div>
                <Label>COI document *</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    onChange={(e) => e.target.files?.[0] && uploadDoc(e.target.files[0])}
                    data-testid="input-coi-file"
                    className="text-sm"
                  />
                  {compliance.documentUrl && (
                    <a href={compliance.documentUrl} target="_blank" rel="noreferrer" className="text-xs underline text-blue-600" data-testid="link-coi-preview">
                      View uploaded
                    </a>
                  )}
                </div>
              </div>
              <div>
                <Label>Coverage notes</Label>
                <Textarea value={compliance.coverageNotes} onChange={(e) => setCompliance({ ...compliance, coverageNotes: e.target.value })} placeholder="e.g. $1M general liability, $5M umbrella" data-testid="input-insurance-notes" />
              </div>
            </div>
          )}

          {currentStep.key === "rates" && (
            <div className="space-y-4" data-testid="step-rates-body">
              <h2 className="text-lg font-semibold text-gray-900">Rates, overtime &amp; 1099 delivery</h2>
              <p className="text-sm text-gray-500">Set your baseline hourly rate and overtime rules. You can override these per-employee later.</p>
              <div>
                <Label>Baseline hourly rate (USD) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={rates.hourlyRate}
                  onChange={(e) => setRates({ ...rates, hourlyRate: e.target.value })}
                  placeholder="e.g. 45.00"
                  data-testid="input-hourly-rate"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Daily OT after (hours) *</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    value={rates.dailyOtHours}
                    onChange={(e) => setRates({ ...rates, dailyOtHours: e.target.value })}
                    data-testid="input-daily-ot"
                  />
                </div>
                <div>
                  <Label>Weekly OT after (hours) *</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    value={rates.weeklyOtHours}
                    onChange={(e) => setRates({ ...rates, weeklyOtHours: e.target.value })}
                    data-testid="input-weekly-ot"
                  />
                </div>
                <div>
                  <Label>OT multiplier *</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min="1"
                    value={rates.overtimeMultiplier}
                    onChange={(e) => setRates({ ...rates, overtimeMultiplier: e.target.value })}
                    data-testid="input-ot-multiplier"
                  />
                  <p className="text-xs text-gray-500 mt-1">Federal default is 1.5×.</p>
                </div>
              </div>
              <div className="border-t pt-4">
                <Label>1099-NEC delivery preference *</Label>
                <p className="text-xs text-gray-500 mb-2">
                  IRS rules require explicit consent before we can deliver year-end tax forms electronically. You can change this later.
                </p>
                <div className="flex flex-col gap-2">
                  <label className="flex items-start gap-2 cursor-pointer" data-testid="radio-edelivery-yes">
                    <input
                      type="radio"
                      className="mt-1"
                      name="edelivery"
                      checked={eDeliveryConsent === true}
                      onChange={() => setEDeliveryConsent(true)}
                    />
                    <span className="text-sm">
                      <strong>Send my 1099 electronically</strong> — I consent to receive the form as a downloadable PDF instead of by mail.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer" data-testid="radio-edelivery-no">
                    <input
                      type="radio"
                      className="mt-1"
                      name="edelivery"
                      checked={eDeliveryConsent === false}
                      onChange={() => setEDeliveryConsent(false)}
                    />
                    <span className="text-sm">
                      <strong>Mail me a paper 1099</strong> — send the form to my physical address each January.
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {currentStep.key === "branding" && (
            <div className="space-y-4" data-testid="step-branding-body">
              <h2 className="text-lg font-semibold text-gray-900">Vendor branding (optional)</h2>
              <p className="text-sm text-gray-500">Adds your colour and logo to the vendor portal and invoice PDFs. You can skip this and add it later from the dashboard.</p>
              <div>
                <Label>Brand primary colour</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="color"
                    value={vendorBranding.brandPrimaryColor || "#0070f3"}
                    onChange={(e) => setVendorBranding({ ...vendorBranding, brandPrimaryColor: e.target.value })}
                    className="w-16 h-10 p-1"
                    data-testid="input-vendor-brand-color"
                  />
                  <Input
                    value={vendorBranding.brandPrimaryColor}
                    onChange={(e) => setVendorBranding({ ...vendorBranding, brandPrimaryColor: e.target.value })}
                    placeholder="#0070f3"
                    className="max-w-[180px]"
                    data-testid="input-vendor-brand-color-hex"
                  />
                </div>
              </div>
              <div>
                <Label>Logo URL</Label>
                <Input
                  value={vendorBranding.logoUrl}
                  onChange={(e) => setVendorBranding({ ...vendorBranding, logoUrl: e.target.value })}
                  placeholder="https://… (paste a URL or skip and upload later)"
                  data-testid="input-vendor-logo-url"
                />
                <p className="text-xs text-gray-500 mt-1">If you don't have a hosted logo handy, skip this and upload one from the dashboard.</p>
              </div>
            </div>
          )}

          {currentStep.key === "first-employee" && (
            <div className="space-y-4" data-testid="step-first-employee-body">
              <h2 className="text-lg font-semibold text-gray-900">Add your first field employee</h2>
              <p className="text-sm text-gray-500">Once you finish setup, we'll send them an invite to set up their own account and profile photo.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>First name *</Label>
                  <Input value={firstEmp.firstName} onChange={(e) => setFirstEmp({ ...firstEmp, firstName: e.target.value })} data-testid="input-emp-first" />
                </div>
                <div>
                  <Label>Last name *</Label>
                  <Input value={firstEmp.lastName} onChange={(e) => setFirstEmp({ ...firstEmp, lastName: e.target.value })} data-testid="input-emp-last" />
                </div>
              </div>
              <div>
                <Label>Email *</Label>
                <Input type="email" value={firstEmp.email} onChange={(e) => setFirstEmp({ ...firstEmp, email: e.target.value })} data-testid="input-emp-email" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={firstEmp.phone} onChange={(e) => setFirstEmp({ ...firstEmp, phone: handlePhoneInput(e.target.value) })} data-testid="input-emp-phone" />
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            {/* Back button: from step 2 onwards we render a real pill so it
                visually anchors the row alongside the right-side actions.
                On step 1 (account creation) it stays a quiet ghost link
                pointing back to /signup so the entry path doesn't feel
                like an in-flow action. */}
            {stepIndex === 0 ? (
              <PillButton color="image" onClick={() => navigate("/signup")} disabled={loading} data-testid="button-back">
                ← Back
              </PillButton>
            ) : (
              <OnboardingPillButton
                tone="secondary"
                onClick={prevStep}
                disabled={loading}
                data-testid="button-back"
                className="px-5"
              >
                ← Back
              </OnboardingPillButton>
            )}
            <div className="flex items-center gap-2">
              {stepIndex > 0 && !REQUIRED_STEPS.has(currentStep.key as StepKey) && (
                <OnboardingPillButton
                  tone="secondary"
                  onClick={skipStep}
                  disabled={loading}
                  data-testid="button-skip"
                  className="px-5"
                >
                  {t("onboardingActions.skipForNow")}
                </OnboardingPillButton>
              )}
              {/* Save & Quit — only meaningful once an account exists.
                  Persists the current step's edits then sends the user
                  to the dashboard, where the Finish-setup widget
                  surfaces a Resume CTA. */}
              {stepIndex > 0 && (
                <OnboardingPillButton
                  tone="secondary"
                  onClick={saveAndQuit}
                  disabled={loading}
                  data-testid="button-save-and-quit"
                  className="px-5"
                >
                  {t("onboardingActions.saveAndQuit")}
                </OnboardingPillButton>
              )}
              {stepIndex === 0 ? (
                <OnboardingPillButton
                  onClick={submitBasics}
                  disabled={loading || namePending || !namePassesDuplicateCheck}
                  data-testid="button-create-account"
                  className="px-6"
                >
                  {loading ? "Creating…" : "Create account"}
                </OnboardingPillButton>
              ) : stepIndex === STEPS.length - 1 ? (
                <OnboardingPillButton onClick={finish} disabled={loading} data-testid="button-finish" className="px-6">
                  {loading ? "Finishing…" : "Finish setup"}
                </OnboardingPillButton>
              ) : (
                <OnboardingPillButton onClick={nextStep} disabled={loading} data-testid="button-next" className="px-6">
                  {loading ? "Saving…" : "Continue"}
                </OnboardingPillButton>
              )}
            </div>
          </div>
        </CardContent></Card>

        <p className="text-center text-xs text-gray-500 mt-4">
          Step {stepIndex + 1} of {STEPS.length}. Your progress is saved automatically.
        </p>
      </div>
    </div>
  );
}
