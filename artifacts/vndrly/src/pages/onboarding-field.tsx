import { PngPillButton } from "@/components/png-pill-rollover";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import { VNDRLY_LOGO_SQUARE as vndrlyLogo } from "@/lib/vndrly-brand-assets";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Checkbox } from "@/components/ui/checkbox";
import AmberButton from "@/components/amber-button";
import { useToast } from "@/hooks/use-toast";
import OnboardingStepper, { type StepperStep } from "@/components/onboarding-stepper";
import { onboardingApi } from "@/lib/onboarding-api";
import { handlePhoneInput, stripPhone } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

type StepKey = "personal-info" | "photo-certs" | "set-password";

const STEP_KEYS: StepKey[] = ["personal-info", "photo-certs", "set-password"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function OnboardingField() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/onboarding/field/:token");
  const token = params?.token ?? "";
  const { toast } = useToast();
  const { t, i18n } = useTranslation();

  // Step labels are derived from the active locale so toggling Español
  // re-renders the stepper without a full page reload.
  const STEPS: (StepperStep & { key: StepKey })[] = useMemo(
    () => [
      { key: "personal-info", label: t("fieldOnboarding.steps.personalInfo") },
      { key: "photo-certs", label: t("fieldOnboarding.steps.photoCerts") },
      { key: "set-password", label: t("fieldOnboarding.steps.setPassword") },
    ],
    [t],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const [info, setInfo] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    preferredLanguage: "en" as "en" | "es",
    vendorRole: "field" as "field" | "foreman" | "office" | "both",
  });
  const [photoUrl, setPhotoUrl] = useState<string>("");
  const [pec, setPec] = useState({ certified: false, expirationDate: "" });
  const [creds, setCreds] = useState({ password: "", confirm: "" });

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    (async () => {
      try {
        const resp = await onboardingApi.getFieldByToken(token);
        if (cancelled) return;
        setTokenValid(true);
        setVendorName(resp.vendorName);
        // Mirror the language saved on `vendor_people` so a Spanish
        // invitee who picks Español, then refreshes, still sees the
        // toggle in Spanish (and the assistant still primes in
        // Spanish from the very first turn). Defaults to English
        // when the column is null (toggle has never been touched).
        const lang: "en" | "es" = resp.preferredLanguage === "es" ? "es" : "en";
        // Sync the global i18n language to whatever the invitee saved
        // last so the wizard copy renders in their preferred language
        // immediately on load, not just after they touch the toggle.
        const currentLang = i18n.language?.startsWith("es") ? "es" : "en";
        if (currentLang !== lang) {
          void i18n.changeLanguage(lang);
        }
        setInfo({
          firstName: resp.firstName ?? "",
          lastName: resp.lastName ?? "",
          phone: resp.phone ?? "",
          preferredLanguage: lang,
          // Vendor admin pre-selects "field" when seeding the row;
          // pull whatever was set so the picker reflects it.
          vendorRole: ((resp as { vendorRole?: string }).vendorRole as
            | "field"
            | "foreman"
            | "office"
            | "both") ?? "field",
        });
        if (resp.photoUrl) setPhotoUrl(resp.photoUrl);
        const idx = STEP_KEYS.findIndex((k) => k === resp.progress.currentStep);
        setStepIndex(idx === -1 ? 0 : idx);
        setCompleted(resp.progress.completedSteps ?? []);
        setSkipped(resp.progress.skippedSteps ?? []);
        // Re-hydrate any in-flight wizard state the invitee saved on a
        // previous visit so they resume with all their work intact, not
        // just the metadata about which step they were on.
        const p = (resp.progress.payload ?? {}) as {
          info?: { firstName?: string; lastName?: string; phone?: string; preferredLanguage?: "en" | "es"; vendorRole?: "field" | "foreman" | "office" | "both" };
          photoUrl?: string;
          pec?: { certified?: boolean; expirationDate?: string };
        };
        if (p.info) {
          setInfo((prev) => ({
            firstName: p.info?.firstName ?? prev.firstName,
            lastName: p.info?.lastName ?? prev.lastName,
            phone: p.info?.phone ?? prev.phone,
            preferredLanguage: (p.info?.preferredLanguage ?? prev.preferredLanguage) as "en" | "es",
            vendorRole: (p.info?.vendorRole ?? prev.vendorRole) as "field" | "foreman" | "office" | "both",
          }));
        }
        if (typeof p.photoUrl === "string" && p.photoUrl) setPhotoUrl(p.photoUrl);
        if (p.pec) {
          setPec({ certified: !!p.pec.certified, expirationDate: p.pec.expirationDate ?? "" });
        }
      } catch {
        setTokenValid(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const currentStep = STEPS[stepIndex];

  const uploadPhoto = async (file: File) => {
    if (!token) {
      toast({ title: t("fieldOnboarding.toasts.missingToken"), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      // Token-authenticated upload: anonymous field invitees don't have a
      // session yet, so /api/storage/uploads/* (which requires login) is
      // not callable here. The onboarding router exposes a token-scoped
      // mirror of those two endpoints for exactly this case.
      const r = await fetch(`${BASE}/api/onboarding/field/by-token/${token}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!r.ok) throw new Error(t("fieldOnboarding.toasts.uploadUrlFailed"));
      const { uploadURL, objectPath } = (await r.json()) as { uploadURL: string; objectPath: string };
      const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) throw new Error(t("fieldOnboarding.toasts.uploadFailed"));
      const fin = await fetch(`${BASE}/api/onboarding/field/by-token/${token}/upload-finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectURL: uploadURL }),
      });
      if (!fin.ok) throw new Error(t("fieldOnboarding.toasts.finalizeFailed"));
      const { objectPath: finalPath } = (await fin.json()) as { objectPath: string };
      const path = finalPath || objectPath;
      const finalUrl = path.startsWith("/") ? `${BASE}/api/storage${path}` : path;
      setPhotoUrl(finalUrl);
      toast({ title: t("fieldOnboarding.toasts.photoUploaded") });
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Persist the language toggle to vendor_people the moment it's
  // touched. This is what unlocks Spanish priming for the token-mode
  // assistant *before* the invitee finishes set-password — at which
  // point there is no users row yet, so the canonical
  // users.preferred_language column isn't usable. Best-effort: local
  // state always advances so the toggle still feels responsive even
  // if the persist call fails (the next change will retry). Also
  // flips the global i18n locale so every label, helper text, and
  // button on the wizard re-renders in the chosen language without
  // a full page reload.
  const pickLanguage = async (lang: "en" | "es") => {
    if (info.preferredLanguage === lang) return;
    setInfo((prev) => ({ ...prev, preferredLanguage: lang }));
    void i18n.changeLanguage(lang);
    if (!token) return;
    try {
      await onboardingApi.updateFieldLanguageByToken(token, lang);
    } catch {
      // Silent — the local toggle has already updated, and submit()
      // will re-send the choice via completeFieldByToken at the end.
    }
  };

  const persistProgress = async (next: { currentStep: StepKey; completedKey?: StepKey; skippedKey?: StepKey }) => {
    const newCompleted = next.completedKey ? Array.from(new Set([...completed, next.completedKey])) : completed;
    // Drop the now-completed step from the skipped list so the
    // dashboard's Finish-setup widget doesn't keep nagging the user
    // about a step they've since filled in.
    const skippedAfterRemoval = next.completedKey
      ? skipped.filter((s) => s !== next.completedKey)
      : skipped;
    const newSkipped = next.skippedKey
      ? Array.from(new Set([...skippedAfterRemoval, next.skippedKey]))
      : skippedAfterRemoval;
    setCompleted(newCompleted);
    setSkipped(newSkipped);
    try {
      await onboardingApi.updateFieldProgressByToken(token, {
        currentStep: next.currentStep,
        completedSteps: newCompleted,
        skippedSteps: newSkipped,
        // Persist the full wizard payload so a field invitee can close
        // the tab mid-flow and pick up exactly where they left off on
        // their next visit. Server merges this into onboarding_progress.
        payload: {
          info: {
            firstName: info.firstName,
            lastName: info.lastName,
            phone: info.phone,
            preferredLanguage: info.preferredLanguage,
            vendorRole: info.vendorRole,
          },
          photoUrl,
          pec: { certified: pec.certified, expirationDate: pec.expirationDate },
        },
      });
    } catch {
      // Best-effort — local state already advanced; the user can still
      // finish the wizard even if the persist call failed.
    }
  };

  // Per spec: every field-employee step is required (PEC + photo are
  // must-haves for site access). The wizard never offers Skip; this
  // helper validates the current step before allowing Continue.
  const validateCurrentStep = (): string | null => {
    switch (currentStep.key) {
      case "personal-info":
        if (!info.firstName.trim() || !info.lastName.trim()) return t("fieldOnboarding.toasts.nameRequired");
        if (!info.phone.trim()) return t("fieldOnboarding.toasts.phoneRequired");
        if (!info.vendorRole) return t("fieldOnboarding.toasts.rolePick");
        return null;
      case "photo-certs":
        if (!photoUrl) return t("fieldOnboarding.toasts.photoRequired");
        if (!pec.certified) return t("fieldOnboarding.toasts.pecRequired");
        if (!pec.expirationDate) return t("fieldOnboarding.toasts.pecExpirationRequired");
        return null;
      default:
        return null;
    }
  };

  const goNext = async () => {
    if (stepIndex + 1 >= STEPS.length) return;
    const err = validateCurrentStep();
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    await persistProgress({ currentStep: STEPS[stepIndex + 1].key, completedKey: currentStep.key as StepKey });
    setStepIndex((i) => i + 1);
  };

  const submit = async () => {
    if (!info.firstName.trim() || !info.lastName.trim()) {
      toast({ title: t("fieldOnboarding.toasts.fillFirstLastName"), variant: "destructive" });
      setStepIndex(0);
      return;
    }
    if (creds.password.length < 8) {
      toast({ title: t("fieldOnboarding.toasts.passwordMin"), variant: "destructive" });
      return;
    }
    if (creds.password !== creds.confirm) {
      toast({ title: t("fieldOnboarding.toasts.passwordMismatch"), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await onboardingApi.completeFieldByToken(token, {
        firstName: info.firstName.trim(),
        lastName: info.lastName.trim(),
        phone: stripPhone(info.phone) || null,
        photoUrl: photoUrl || null,
        password: creds.password,
        preferredLanguage: info.preferredLanguage,
        pecCertification: pec.certified,
        pecExpirationDate: pec.expirationDate || null,
        vendorRole: info.vendorRole,
      });
      toast({ title: t("fieldOnboarding.toasts.allSet") });
      // Field employees land in the field-mobile dashboard route.
      navigate("/field");
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (tokenValid === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md text-center bg-white rounded-xl p-8 shadow-sm border border-gray-200" data-testid="invalid-token-card">
          <h1 className="text-xl font-bold text-gray-900 mb-2">{t("fieldOnboarding.invalidTokenTitle")}</h1>
          <p className="text-sm text-gray-600">{t("fieldOnboarding.invalidTokenBody")}</p>
          <PillButton color="image" className="mt-6" onClick={() => navigate("/")}>{t("fieldOnboarding.backToSignIn")}</PillButton>
        </div>
      </div>
    );
  }

  if (tokenValid === null) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">{t("fieldOnboarding.loading")}</div>;
  }

  // Resolve the headline vendor name once: the API returns the real
  // vendor when the token is valid; until then we render a localised
  // placeholder so a Spanish invitee never briefly sees "your employer".
  const headlineVendor = vendorName ?? t("fieldOnboarding.defaultVendorName");

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <img src={vndrlyLogo} alt="VNDRLY" className="w-12 h-12 rounded-lg" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("fieldOnboarding.welcomeTitle", { vendorName: headlineVendor })}</h1>
            <p className="text-sm text-gray-500">{t("fieldOnboarding.welcomeSubtitle")}</p>
          </div>
        </div>

        <Card><CardContent className="p-6 pt-6">
          <OnboardingStepper steps={STEPS} currentIndex={stepIndex} completedKeys={completed} skippedKeys={skipped} className="mb-8" />

          {currentStep.key === "personal-info" && (
            <div className="space-y-4" data-testid="step-personal-info-body">
              <h2 className="text-lg font-semibold text-gray-900">{t("fieldOnboarding.personal.heading")}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("fieldOnboarding.personal.firstName")}</Label>
                  <Input value={info.firstName} onChange={(e) => setInfo({ ...info, firstName: e.target.value })} data-testid="input-first-name" />
                </div>
                <div>
                  <Label>{t("fieldOnboarding.personal.lastName")}</Label>
                  <Input value={info.lastName} onChange={(e) => setInfo({ ...info, lastName: e.target.value })} data-testid="input-last-name" />
                </div>
              </div>
              <div>
                <Label>{t("fieldOnboarding.personal.phone")}</Label>
                <Input value={info.phone} onChange={(e) => setInfo({ ...info, phone: handlePhoneInput(e.target.value) })} placeholder="(555) 123-4567" data-testid="input-phone" />
              </div>
              <div>
                <Label>{t("fieldOnboarding.personal.preferredLanguage")}</Label>
                <div className="flex gap-2">
                  <PillButton type="button" color={info.preferredLanguage === "en" ? "blue" : "image"} onClick={() => pickLanguage("en")} data-testid="lang-en">{t("fieldOnboarding.personal.english")}</PillButton>
                  <PillButton type="button" color={info.preferredLanguage === "es" ? "blue" : "image"} onClick={() => pickLanguage("es")} data-testid="lang-es">{t("fieldOnboarding.personal.spanish")}</PillButton>
                </div>
              </div>
              <div>
                <Label>{t("fieldOnboarding.personal.roleQuestion")}</Label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { value: "field", label: t("fieldOnboarding.personal.roleField") },
                    { value: "foreman", label: t("fieldOnboarding.personal.roleForeman") },
                    { value: "office", label: t("fieldOnboarding.personal.roleOffice") },
                    { value: "both", label: t("fieldOnboarding.personal.roleBoth") },
                  ] as const).map((r) => (
                    <PillButton
                      key={r.value}
                      type="button"
                      color={info.vendorRole === r.value ? "blue" : "image"}
                      onClick={() => setInfo({ ...info, vendorRole: r.value })}
                      data-testid={`role-${r.value}`}
                    >
                      {r.label}
                    </PillButton>
                  ))}
                </div>
              </div>
            </div>
          )}

          {currentStep.key === "photo-certs" && (
            <div className="space-y-4" data-testid="step-photo-certs-body">
              <h2 className="text-lg font-semibold text-gray-900">{t("fieldOnboarding.photo.heading")}</h2>
              <div>
                <Label>{t("fieldOnboarding.photo.profilePhoto")}</Label>
                <div className="flex items-center gap-3">
                  <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} data-testid="input-photo" className="text-sm" />
                  {photoUrl && <img src={photoUrl} alt="profile preview" className="h-16 w-16 rounded-full object-cover border" />}
                </div>
              </div>
              <label className="flex items-center gap-2 mt-4">
                <Checkbox checked={pec.certified} onCheckedChange={(v) => setPec({ ...pec, certified: v === true })} data-testid="check-pec" />
                <span className="text-sm">{t("fieldOnboarding.photo.pecCheckbox")}</span>
              </label>
              {pec.certified && (
                <div>
                  <Label>{t("fieldOnboarding.photo.pecExpiration")}</Label>
                  <Input type="date" value={pec.expirationDate} onChange={(e) => setPec({ ...pec, expirationDate: e.target.value })} data-testid="input-pec-expiration" />
                </div>
              )}
            </div>
          )}

          {currentStep.key === "set-password" && (
            <div className="space-y-4" data-testid="step-set-password-body">
              <h2 className="text-lg font-semibold text-gray-900">{t("fieldOnboarding.password.heading")}</h2>
              <p className="text-sm text-gray-500">{t("fieldOnboarding.password.subtitle")}</p>
              <div>
                <Label>{t("fieldOnboarding.password.password")}</Label>
                <Input type="password" value={creds.password} onChange={(e) => setCreds({ ...creds, password: e.target.value })} data-testid="input-password" />
              </div>
              <div>
                <Label>{t("fieldOnboarding.password.confirm")}</Label>
                <Input type="password" value={creds.confirm} onChange={(e) => setCreds({ ...creds, confirm: e.target.value })} data-testid="input-password-confirm" />
              </div>
              <p className="text-xs text-gray-500">{t("fieldOnboarding.password.hint")}</p>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            <PillButton color="image" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={loading || stepIndex === 0} data-testid="button-back">
              {t("fieldOnboarding.back")}
            </PillButton>
            <div className="flex items-center gap-2">
              {currentStep.key === "set-password" ? (
                <PngPillButton color="amber" onClick={submit} disabled={loading} data-testid="button-finish" className="px-6 h-10">
                  {loading ? t("fieldOnboarding.finishing") : t("fieldOnboarding.finishSetup")}
                </PngPillButton>
              ) : (
                <PngPillButton color="amber" onClick={goNext} disabled={loading} data-testid="button-next" className="px-6 h-10">{t("fieldOnboarding.continue")}</PngPillButton>
              )}
            </div>
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}
