import { CardHeading } from "@/components/ui/card-heading";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Camera, User as UserIcon } from "lucide-react";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";
import { useToast } from "@/hooks/use-toast";
import { PngPillButton } from "@/components/png-pill-rollover";
import { ProfileActionButton, ProfileRow } from "@/components/gate-profile-chrome";
import { cn } from "@/lib/utils";
import { usePortalBase } from "@/lib/portal-base";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FieldMeFull {
  employeeId: number;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  pecExpirationDate: string | null;
  profilePhotoPath: string | null;
  photoUrl?: string | null;
}

function resolveUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.startsWith("/api/")) return `${BASE}${normalized}`;
  return `${BASE}/api/storage${normalized}`;
}

export default function FieldEditProfile({ inline = false, expanded = true, summary, editToggle, onSaved }: {
  inline?: boolean; expanded?: boolean; summary?: ReactNode; editToggle?: ReactNode; onSaved?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const c = (en: string, es: string) => i18n.language.startsWith("es") ? es : en;
  const [, navigate] = useLocation();
  const portalBase = usePortalBase();
  const { toast } = useToast();
  const cache = useQueryClient();
  const ActionButton = inline ? ProfileActionButton : PngPillButton;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [employeeDetails, setEmployeeDetails] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [directPhotoUrl, setDirectPhotoUrl] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [pecDate, setPecDate] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  useEffect(() => {
    fetch(`${BASE}/api/field/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: FieldMeFull | null) => {
        if (!me) return;
        setEmployeeDetails(Boolean(me.employeeId));
        setFirstName(me.firstName ?? "");
        setLastName(me.lastName ?? "");
        setEmail(me.email ?? "");
        setJobTitle(me.jobTitle ?? "");
        setPhone(me.phone ?? "");
        setPecDate(me.pecExpirationDate ?? "");
        setPhotoPath(me.profilePhotoPath);
        setDirectPhotoUrl(me.photoUrl ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function uploadPhotoFromFile(file: File) {
    try {
      const presign = await fetch(`${BASE}/api/storage/upload-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "image/jpeg" }),
      });
      if (!presign.ok) throw new Error("upload_url_failed");
      const { uploadUrl, objectPath } = (await presign.json()) as { uploadUrl: string; objectPath: string };
      const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "image/jpeg" } });
      if (!put.ok) throw new Error("upload_failed");
      const saved = await fetch(`${BASE}/api/field/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profilePhotoPath: objectPath }),
      });
      if (!saved.ok) throw new Error("save_failed");
      void cache.invalidateQueries({ queryKey: ["account-next-steps"] });
      const json = (await saved.json()) as FieldMeFull;
      setPhotoPath(json.profilePhotoPath);
      setDirectPhotoUrl(null);
      onSaved?.();
      toast({ title: t("editProfile.savedTitle"), description: t("editProfile.photoSaved") });
    } catch {
      toast({ title: t("common.error"), description: t("editProfile.couldNotUpload"), variant: "destructive" });
    }
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void uploadPhotoFromFile(f);
    e.target.value = "";
  }

  async function onSave() {
    if (!firstName.trim()) {
      toast({ title: t("common.required"), description: t("editProfile.requiredFirstName"), variant: "destructive" });
      return;
    }
    if (inline && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast({ title: c("Invalid email", "Correo no válido"), description: c("Enter a valid email address.", "Ingresa un correo electrónico válido."), variant: "destructive" });
      return;
    }
    if (!inline && pecDate && !/^\d{4}-\d{2}-\d{2}$/.test(pecDate.trim())) {
      toast({ title: t("editProfile.invalidDateTitle"), description: t("editProfile.invalidDateBody"), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/field/me`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          ...(inline ? { email: email.trim().toLowerCase() } : { pecExpirationDate: pecDate.trim() || null }),
          ...(!inline || employeeDetails ? { jobTitle: jobTitle.trim() || null, phone: phone.trim() || null } : {}),
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      void cache.invalidateQueries({ queryKey: ["account-next-steps"] });
      toast({ title: t("editProfile.savedTitle"), description: t("editProfile.savedBody") });
      if (inline) onSaved?.(); else navigate(`${portalBase}/profile`);
    } catch {
      toast({ title: t("common.error"), description: t("editProfile.couldNotSave"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword() {
    if (!currentPw || !newPw || !confirmPw) {
      toast({ title: t("common.required"), description: t("editProfile.pwRequired"), variant: "destructive" });
      return;
    }
    if (newPw.length < 8) {
      toast({ title: t("editProfile.pwShortTitle"), description: t("editProfile.pwShortBody"), variant: "destructive" });
      return;
    }
    if (newPw !== confirmPw) {
      toast({ title: t("editProfile.pwMismatchTitle"), description: t("editProfile.pwMismatchBody"), variant: "destructive" });
      return;
    }
    setPwSaving(true);
    try {
      const r = await fetch(`${BASE}/api/field/me/password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      toast({ title: t("editProfile.pwUpdatedTitle"), description: t("editProfile.pwUpdatedBody") });
    } catch {
      toast({ title: t("common.error"), description: t("editProfile.couldNotChangePw"), variant: "destructive" });
    } finally {
      setPwSaving(false);
    }
  }

  const url = resolveUrl(directPhotoUrl ?? photoPath);

  return (
    <div className={inline ? "gate-profile-edit" : FIELD_OPS_PAGE_CLASS} data-testid="field-edit-profile">
      {!inline && <div className="flex items-center gap-3 mb-4">
        <ContentPaneBackLink
          href={`${portalBase}/profile`}
          testId="button-back"
          ariaLabel={t("common.back")}
        />
        <h1 className="text-xl font-bold">{t("editProfile.title")}</h1>
      </div>}

      <div className={inline ? "flex items-start justify-between gap-4" : undefined}>
      {summary}
      <div className={inline ? "gate-profile-photo" : "flex flex-col items-center pb-4"}>
        <label className="relative cursor-pointer" data-testid="photo-picker">
          {url ? (
            <img src={url} alt="" className="w-24 h-24 rounded-full object-cover border-2 border-border" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-[var(--brand-primary)] flex items-center justify-center border-2 border-[var(--brand-primary)]">
              <UserIcon className="w-10 h-10 text-muted-foreground" />
            </div>
          )}
          {inline && <Camera className="absolute bottom-0 right-0 h-7 w-7 rounded-full border-2 border-white bg-[var(--brand-primary)] p-1 text-white" />}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickPhoto}
            data-testid="input-photo-file"
            aria-label={t("editProfile.tapToChange")}
          />
        </label>
        <p className="text-xs text-muted-foreground mt-2">{t("editProfile.tapToChange")}</p>
      </div>
      </div>
      {editToggle}

      {expanded && <>
      <section data-card-layout className="rounded-xl border border-border bg-card p-4 mb-4 space-y-3">
        <CardHeading as="h2" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("editProfile.yourDetails")}
        </CardHeading>
        <Field label={t("editProfile.firstName")} value={firstName} onChange={setFirstName} testId="input-first-name" disabled={loading} />
        <Field label={t("editProfile.lastName")} value={lastName} onChange={setLastName} testId="input-last-name" disabled={loading} />
        {inline && <Field label={c("Email", "Correo electrónico")} value={email} onChange={setEmail} type="email" testId="input-email" disabled={loading} />}
        {(!inline || employeeDetails) && <>
          <Field label={t("editProfile.jobTitle")} value={jobTitle} onChange={setJobTitle} placeholder={t("editProfile.jobTitlePlaceholder")} testId="input-job-title" disabled={loading} />
          <Field label={t("editProfile.phone")} value={phone} onChange={setPhone} type="tel" placeholder={t("editProfile.phonePlaceholder")} testId="input-phone" disabled={loading} />
        </>}
        {!inline && <Field label={t("editProfile.pecLabel")} value={pecDate} onChange={setPecDate} placeholder={t("editProfile.pecPlaceholder")} testId="input-pec-date" disabled={loading} />}
        <ActionButton
          color="brand"
          onClick={() => void onSave()}
          disabled={loading || saving}
          className={inline ? "mt-2" : "w-full h-11 text-sm mt-2"}
          data-testid="button-save-profile"
        >
          {saving ? t("common.saving") : t("editProfile.saveChanges")}
        </ActionButton>
      </section>
      {inline && <ProfileRow label={t("editProfile.changePassword")} open={passwordOpen} onClick={() => setPasswordOpen(!passwordOpen)} />}
      {(!inline || passwordOpen) && <section data-card-layout className="rounded-xl border border-border bg-card p-4 space-y-3">
        <CardHeading as="h2" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("editProfile.changePassword")}
        </CardHeading>
        <Field label={t("editProfile.currentPw")} value={currentPw} onChange={setCurrentPw} type="password" testId="input-current-password" />
        <Field label={t("editProfile.newPw")} value={newPw} onChange={setNewPw} type="password" testId="input-new-password" />
        <Field label={t("editProfile.confirmPw")} value={confirmPw} onChange={setConfirmPw} type="password" testId="input-confirm-password" />
        <ActionButton
          color="blue"
          onClick={() => void onChangePassword()}
          disabled={pwSaving}
          className={inline ? "mt-2" : "w-full h-11 text-sm mt-2"}
          data-testid="button-change-password"
        >
          {pwSaving ? t("common.saving") : t("editProfile.updatePw")}
        </ActionButton>
      </section>}
      </>}
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        data-testid={props.testId}
        className={cn(
          "w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm",
          "focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)] focus:border-transparent",
          props.disabled && "opacity-60",
        )}
      />
    </label>
  );
}
